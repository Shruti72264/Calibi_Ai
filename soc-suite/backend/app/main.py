"""
SENTINEL SOC - backend API.

Run:
    cd soc-suite/backend
    source .venv/bin/activate
    SOC_LIVE_EVE_PATH=/var/log/suricata/eve.json uvicorn app.main:app --reload --port 8000

Docs: http://127.0.0.1:8000/docs

Security posture of this API:
  * read-only by default; mutating routes require SOC_API_KEY **and**
    SOC_ALLOW_WRITES=true, sent as the `X-API-Key` header (fail-closed).
  * no endpoint takes a filesystem path, a command or a shell fragment.
  * CORS allows the configured dev origin(s) plus an optional preview regex.
  * response actions are constrained to allow-listed targets on the local host
    and every attempt is audited.
"""

from __future__ import annotations

import logging
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .audit import VALID_STATUSES, AuditStore
from .datasource import HISTORICAL, LIVE, EventStore
from .parser import severity_rank, sort_events
from .providers import CiscoProvider
from .response import ResponseEngine
from .response.actions import PolicyError, classify
from .schemas import (
    AlertListResponse,
    AuditEntry,
    EventDetail,
    Event,
    HealthResponse,
    NetworkStatusResponse,
    NoteCreate,
    ResponseActionRequest,
    ResponseActionResponse,
    StatsResponse,
    SystemStatusResponse,
)
from .settings import Settings, get_settings
from . import suricata_status

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
)
log = logging.getLogger("sentinel.api")

STARTED_AT = time.time()

settings: Settings = get_settings()
store = EventStore(settings)
audit = AuditStore(settings.audit_db_path)
cisco = CiscoProvider(settings)
responder = ResponseEngine(settings, audit)

app = FastAPI(
    title=settings.api_title,
    version=settings.api_version,
    description=(
        "SENTINEL SOC API - Suricata detection evidence, Cisco simulation evidence and a "
        "controlled response workflow. Live and historical data are always labelled "
        "separately; nothing is presented as live unless it was actually read just now."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key"],
)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def require_write_access(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> str:
    """
    Gate for every mutating endpoint. Fail-closed:
      403 while writes are disabled (which is the default),
      401 when a key is configured but missing/incorrect.
    """
    if not settings.writes_are_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "This API is read-only. To enable write operations set both "
                "SOC_API_KEY and SOC_ALLOW_WRITES=true, then send the key as X-API-Key. "
                "Keep it disabled for demos where no state should change."
            ),
        )
    if not x_api_key or x_api_key != settings.api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid X-API-Key header is required for write operations.",
        )
    return "api-key-client"


def _parse_time(value: str) -> datetime:
    text = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"invalid time value '{value}'") from exc
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _cutoff(window: str) -> datetime | None:
    """Accept 'all', '15m', '1h', '24h', '7d', '30d'."""
    if not window or window.lower() == "all":
        return None
    text = window.strip().lower()
    unit = text[-1]
    amount = text[:-1]
    if not amount.isdigit():
        raise HTTPException(status_code=422, detail=f"invalid window '{window}' (use e.g. 24h, 7d, all)")
    value = int(amount)
    delta = {
        "m": timedelta(minutes=value),
        "h": timedelta(hours=value),
        "d": timedelta(days=value),
    }.get(unit)
    if delta is None:
        raise HTTPException(status_code=422, detail=f"invalid window unit in '{window}'")
    return datetime.now(timezone.utc) - delta


def _event_time(event: dict) -> datetime | None:
    ts = event.get("timestamp")
    if not ts:
        return None
    try:
        parsed = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _filter_events(
    events: list[dict],
    *,
    q: str | None,
    src_ip: str | None,
    dest_ip: str | None,
    signature: str | None,
    severity: list[str] | None,
    action: list[str] | None,
    proto: str | None,
    source: str | None,
    rule_id: str | None,
    event_type: str | None,
    since: str | None,
    until: str | None,
    window: str | None,
) -> list[dict]:
    out = events

    if source and source != "all":
        out = [e for e in out if e["source"] == source]
    if q:
        needle = q.lower()

        def matches(event: dict) -> bool:
            haystack = " ".join(
                str(event.get(key) or "")
                for key in (
                    "signature", "src_ip", "dest_ip", "proto", "action", "severity",
                    "category", "rule_id", "event_type", "source", "app_proto",
                )
            ).lower()
            return needle in haystack

        out = [e for e in out if matches(e)]
    if src_ip:
        out = [e for e in out if (e.get("src_ip") or "") == src_ip]
    if dest_ip:
        out = [e for e in out if (e.get("dest_ip") or "") == dest_ip]
    if signature:
        needle = signature.lower()
        out = [e for e in out if needle in (e.get("signature") or "").lower()]
    if severity:
        wanted = {s.lower() for s in severity}
        out = [e for e in out if (e.get("severity") or "unknown").lower() in wanted]
    if action:
        wanted = {a.lower() for a in action}
        out = [e for e in out if (e.get("action") or "unknown").lower() in wanted]
    if proto:
        out = [e for e in out if (e.get("proto") or "").upper() == proto.upper()]
    if rule_id:
        out = [e for e in out if str(e.get("rule_id")) == rule_id]
    if event_type:
        out = [e for e in out if (e.get("event_type") or "").lower() == event_type.lower()]

    if since:
        start = _parse_time(since)
        out = [e for e in out if (_event_time(e) or start) >= start]
    if until:
        end = _parse_time(until)
        out = [e for e in out if (_event_time(e) or end) <= end]
    cutoff = _cutoff(window) if window else None
    if cutoff is not None:
        out = [e for e in out if (_event_time(e) or cutoff) >= cutoff]

    return out


_SORT_KEYS = {
    "timestamp": lambda e: (e.get("timestamp") or "", e.get("event_id") or ""),
    "severity": lambda e: (-severity_rank(e.get("severity")), e.get("timestamp") or ""),
    "signature": lambda e: ((e.get("signature") or "").lower(), e.get("timestamp") or ""),
    "src_ip": lambda e: (e.get("src_ip") or "", e.get("timestamp") or ""),
    "dest_ip": lambda e: (e.get("dest_ip") or "", e.get("timestamp") or ""),
    "action": lambda e: ((e.get("action") or ""), e.get("timestamp") or ""),
    "proto": lambda e: ((e.get("proto") or ""), e.get("timestamp") or ""),
    "source": lambda e: ((e.get("source") or ""), e.get("timestamp") or ""),
}


def _decorate(events: list[dict]) -> list[dict]:
    """Attach analyst triage state (status + note count) to raw events."""
    states = audit.state_map()
    decorated = []
    for event in events:
        copy = dict(event)
        state = states.get(event["event_id"]) or {}
        copy["analyst_status"] = state.get("status", "new")
        copy["analyst_note_count"] = state.get("note_count", 0)
        decorated.append(copy)
    return decorated


def _distribution(values: list[str], limit: int | None = None) -> list[dict]:
    total = len(values) or 1
    counter = Counter(values)
    items = [
        {"key": key, "count": count, "percent": round(count * 100.0 / total, 2)}
        for key, count in counter.most_common()
    ]
    return items[:limit] if limit else items


# --------------------------------------------------------------------------
# routes: meta
# --------------------------------------------------------------------------
@app.get("/", include_in_schema=False)
def root() -> dict:
    return {
        "service": settings.api_title,
        "version": settings.api_version,
        "docs": "/docs",
        "endpoints": [
            "GET /api/health",
            "GET /api/alerts",
            "GET /api/alerts/{event_id}",
            "GET /api/stats",
            "GET /api/network/status",
            "GET /api/system/status",
            "GET /api/suricata/status",
            "GET /api/audit",
            "GET /api/response/status",
            "POST /api/alerts/{event_id}/notes",
            "POST /api/alerts/{event_id}/status",
            "POST /api/response/actions",
        ],
    }


@app.get("/api/health", response_model=HealthResponse, tags=["health"])
def health(force: bool = Query(False, description="Bypass the cache and re-read the log files")) -> dict:
    """
    200 always when the process is serving; `status` distinguishes ok from
    degraded so the dashboard can show a connection *and* a data-quality state.
    """
    snapshot = store.snapshot(force=force)
    counts = snapshot.counts()
    sources = [snapshot.statuses[LIVE].as_dict(), snapshot.statuses[HISTORICAL].as_dict()]
    reads_ok = any(s["state"] == "ok" for s in sources)
    return {
        "status": "ok" if reads_ok else "degraded",
        "service": settings.api_title,
        "version": settings.api_version,
        "env": settings.env,
        "uptime_seconds": round(time.time() - STARTED_AT, 1),
        "server_time": _now(),
        "data_sources": sources,
        "events_available": counts["total"],
        "counts_by_source": counts,
        "cache_age_seconds": round(time.time() - snapshot.read_at, 2),
        "reads_ok": reads_ok,
    }


# --------------------------------------------------------------------------
# routes: alerts
# --------------------------------------------------------------------------
@app.get("/api/alerts", response_model=AlertListResponse, tags=["alerts"])
def list_alerts(
    q: str | None = Query(None, max_length=200, description="Free-text search"),
    src_ip: str | None = Query(None, max_length=64),
    dest_ip: str | None = Query(None, max_length=64),
    signature: str | None = Query(None, max_length=200),
    severity: list[str] | None = Query(None, description="high|medium|low|unknown (repeatable)"),
    action: list[str] | None = Query(None, description="allowed|blocked|unknown (repeatable)"),
    proto: str | None = Query(None, max_length=16),
    source: Literal["live", "historical", "all"] = Query("all"),
    rule_id: str | None = Query(None, max_length=32),
    event_type: str | None = Query(None, max_length=32),
    since: str | None = Query(None),
    until: str | None = Query(None),
    window: str | None = Query(None, description="15m | 1h | 24h | 7d | 30d | all"),
    sort: Literal["timestamp", "severity", "signature", "src_ip", "dest_ip", "action", "proto", "source"] = "timestamp",
    order: Literal["asc", "desc"] = "desc",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
) -> dict:
    events = store.all_events()
    filtered = _filter_events(
        events, q=q, src_ip=src_ip, dest_ip=dest_ip, signature=signature, severity=severity,
        action=action, proto=proto, source=source, rule_id=rule_id, event_type=event_type,
        since=since, until=until, window=window,
    )

    key = _SORT_KEYS[sort]
    filtered = sorted(filtered, key=key, reverse=(order == "desc"))

    total = len(filtered)
    pages = max(1, (total + page_size - 1) // page_size)
    start = (page - 1) * page_size
    window_slice = filtered[start : start + page_size]

    return {
        "items": _decorate(window_slice),
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": pages,
        "sort": sort,
        "order": order,
        "counts_by_source": {
            "live": sum(1 for e in filtered if e["source"] == LIVE),
            "historical": sum(1 for e in filtered if e["source"] == HISTORICAL),
            "returned": len(window_slice),
        },
        "applied_filters": {
            "q": q, "src_ip": src_ip, "dest_ip": dest_ip, "signature": signature,
            "severity": severity, "action": action, "proto": proto, "source": source,
            "rule_id": rule_id, "event_type": event_type, "since": since, "until": until,
            "window": window,
        },
        "generated_at": _now(),
    }


@app.get("/api/alerts/{event_id}", response_model=EventDetail, tags=["alerts"])
def alert_detail(event_id: str) -> dict:
    raw = store.get_event(event_id)
    if raw is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No event with id '{event_id}' in the current live+historical window. "
                "It may have rotated out of the EVE file, or the id may be stale."
            ),
        )

    event = _decorate([raw])[0]
    all_events = store.all_events()

    def others(predicate, limit: int = 25) -> list[dict]:
        found = [e for e in all_events if e["event_id"] != event_id and predicate(e)]
        return _decorate(sort_events(found)[:limit])

    related = {
        "by_flow_id": others(lambda e: raw.get("flow_id") is not None and e.get("flow_id") == raw.get("flow_id")),
        "by_source_ip": others(lambda e: e.get("src_ip") and e.get("src_ip") == raw.get("src_ip")),
        "by_destination_ip": others(lambda e: e.get("dest_ip") and e.get("dest_ip") == raw.get("dest_ip")),
        "by_signature": others(lambda e: e.get("signature") == raw.get("signature")),
    }

    # A timeline is a *story*, not a second alert list: the focal event plus its
    # strongest correlation (same flow, else same source+signature).
    timeline: list[dict] = []
    for candidate in sorted(
        related["by_flow_id"] or related["by_source_ip"],
        key=lambda e: e.get("timestamp") or "",
    ):
        timeline.append(
            {
                "timestamp": candidate.get("timestamp"),
                "kind": "correlated",
                "label": f"{candidate.get('event_type')} - {candidate.get('signature')}",
                "detail": (
                    f"{candidate.get('src_ip')}:{candidate.get('src_port')} -> "
                    f"{candidate.get('dest_ip')}:{candidate.get('dest_port')} "
                    f"[{candidate.get('action')}]"
                ),
                "event_id": candidate.get("event_id"),
                "correlation": "flow_id" if candidate in related["by_flow_id"] else "source_ip",
            }
        )
    timeline.append(
        {
            "timestamp": raw.get("timestamp"),
            "kind": "focal",
            "label": f"{raw.get('event_type')} - {raw.get('signature')}",
            "detail": (
                f"Recorded action: {raw.get('action')} "
                f"(basis: {raw.get('action_source')})"
            ),
            "event_id": event_id,
            "correlation": "this event",
        }
    )
    timeline.sort(key=lambda item: item.get("timestamp") or "")

    return {
        "event": event,
        "related": related,
        "timeline": timeline,
        "notes": audit.notes_for(event_id),
        "response_recommendation": classify(raw),
    }


@app.post(
    "/api/alerts/{event_id}/notes",
    status_code=status.HTTP_201_CREATED,
    tags=["analyst"],
    dependencies=[Depends(require_write_access)],
)
def add_note(event_id: str, payload: NoteCreate) -> dict:
    """
    Analyst note / triage update.

    This is the *first* stage of the response workflow: it classifies and
    records. It never changes network state, and the API says so explicitly so
    the dashboard can never imply that a note blocked traffic.
    """
    if store.get_event(event_id) is None:
        raise HTTPException(status_code=404, detail=f"Unknown event id '{event_id}'")
    if payload.status is not None and payload.status not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {sorted(VALID_STATUSES)}")
    note = audit.add_note(event_id, payload.note, payload.author, payload.status)
    return {
        "note": note,
        "network_state_changed": False,
        "disclosure": "Recording analyst state. No device or firewall configuration was modified.",
    }


@app.post(
    "/api/alerts/{event_id}/status",
    tags=["analyst"],
    dependencies=[Depends(require_write_access)],
)
def set_status(event_id: str, new_status: str = Query(..., alias="status")) -> dict:
    if store.get_event(event_id) is None:
        raise HTTPException(status_code=404, detail=f"Unknown event id '{event_id}'")
    try:
        updated = audit.set_status(event_id, new_status)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "state": updated,
        "network_state_changed": False,
        "disclosure": "Triage status only - this is not a network block.",
    }


# --------------------------------------------------------------------------
# routes: stats
# --------------------------------------------------------------------------
@app.get("/api/stats", response_model=StatsResponse, tags=["analytics"])
def stats(
    window: str | None = Query(None, description="15m | 1h | 24h | 7d | 30d | all"),
    source: Literal["live", "historical", "all"] = Query("all"),
) -> dict:
    events = _filter_events(
        store.all_events(), q=None, src_ip=None, dest_ip=None, signature=None,
        severity=None, action=None, proto=None, source=source, rule_id=None,
        event_type=None, since=None, until=None, window=window,
    )

    timestamps = [t for t in (_event_time(e) for e in events) if t]
    cutoff = _cutoff(window) if window else None

    # Bucket automatically: minutes for short windows, hours for days, days for long.
    span = None
    if timestamps:
        span = max(timestamps) - min(timestamps)
    bucket = "hour"
    if span is not None and span <= timedelta(hours=6):
        bucket = "minute"
    elif span is not None and span > timedelta(days=14):
        bucket = "day"

    buckets: dict[str, dict] = {}
    for event in events:
        moment = _event_time(event)
        if moment is None:
            continue
        if bucket == "minute":
            key = moment.replace(second=0, microsecond=0)
        elif bucket == "hour":
            key = moment.replace(minute=0, second=0, microsecond=0)
        else:
            key = moment.replace(hour=0, minute=0, second=0, microsecond=0)
        label = key.isoformat().replace("+00:00", "Z")
        entry = buckets.setdefault(label, {"bucket": label, "total": 0, "blocked": 0, "allowed": 0, "unknown": 0})
        entry["total"] += 1
        action = event.get("action") or "unknown"
        entry[action if action in {"blocked", "allowed"} else "unknown"] += 1

    timeline = [buckets[key] for key in sorted(buckets)]

    statuses = audit.status_distribution()
    counts = {
        "live": sum(1 for e in events if e["source"] == LIVE),
        "historical": sum(1 for e in events if e["source"] == HISTORICAL),
    }
    return {
        "generated_at": _now(),
        "window": {
            "requested": window or "all",
            "source_filter": source,
            "since": cutoff.isoformat().replace("+00:00", "Z") if cutoff else None,
            "bucket": bucket,
            "events_considered": len(events),
        },
        "totals": {
            "events": len(events),
            "blocked": sum(1 for e in events if e.get("action") == "blocked"),
            "allowed": sum(1 for e in events if e.get("action") == "allowed"),
            "unknown_action": sum(1 for e in events if (e.get("action") or "unknown") == "unknown"),
            "high_severity": sum(1 for e in events if e.get("severity") == "high"),
            "custom_rules": sum(1 for e in events if e.get("is_custom_rule")),
            "unique_source_ips": len({e.get("src_ip") for e in events if e.get("src_ip")}),
            "unique_signatures": len({e.get("signature") for e in events if e.get("signature")}),
            "triaged": sum(statuses.values()),
        },
        "counts_by_source": counts,
        "severity_distribution": _distribution([e.get("severity") or "unknown" for e in events]),
        "protocol_distribution": _distribution([e.get("proto") or "unknown" for e in events], limit=12),
        "action_distribution": _distribution([e.get("action") or "unknown" for e in events]),
        "event_type_distribution": _distribution([e.get("event_type") or "unknown" for e in events]),
        "top_signatures": _distribution([e.get("signature") or "unnamed" for e in events], limit=8),
        "top_source_ips": _distribution([e.get("src_ip") or "unknown" for e in events], limit=8),
        "top_destination_ips": _distribution([e.get("dest_ip") or "unknown" for e in events], limit=8),
        "timeline": timeline,
        "custom_rule_events": sum(1 for e in events if e.get("is_custom_rule")),
        "analyst_status_distribution": [
            {"key": key, "count": value, "percent": round(value * 100.0 / (sum(statuses.values()) or 1), 2)}
            for key, value in statuses.items()
        ],
    }


# --------------------------------------------------------------------------
# routes: system + suricata
# --------------------------------------------------------------------------
def _system_status_payload() -> dict:
    snapshot = store.snapshot()
    suricata = suricata_status.collect(settings, settings.live_eve_path)
    return {
        "generated_at": _now(),
        "backend": {
            "service": settings.api_title,
            "version": settings.api_version,
            "env": settings.env,
            "uptime_seconds": round(time.time() - STARTED_AT, 1),
            "server_time": _now(),
            "write_protection": {
                "writes_enabled": settings.writes_are_enabled,
                "api_key_configured": bool(settings.api_key),
                "allow_writes": settings.allow_writes,
            },
            "audit_store": audit.health(),
        },
        "config": settings.as_public_dict(),
        "suricata": suricata,
        "data_sources": [s.as_dict() for s in snapshot.statuses.values()],
        "files": store.empty_file_probe(),
        "cisco": cisco.summary(),
        "response": responder.status(),
    }


@app.get("/api/system/status", response_model=SystemStatusResponse, tags=["system"])
def system_status() -> dict:
    """Everything the System Health page needs, in one honest payload."""
    return _system_status_payload()


@app.get("/api/suricata/status", tags=["system"])
def suricata_only() -> dict:
    return suricata_status.collect(settings, settings.live_eve_path)


@app.post("/api/system/reload-data", tags=["system"], dependencies=[Depends(require_write_access)])
def reload_data() -> dict:
    """Force a cache-busting re-read of the EVE files (never restarts Suricata)."""
    snapshot = store.snapshot(force=True)
    return {
        "reloaded_at": _now(),
        "counts": snapshot.counts(),
        "read_duration_ms": snapshot.read_duration_ms,
        "note": "Log files were re-read. The Suricata service itself was not touched.",
    }


# --------------------------------------------------------------------------
# routes: network (Cisco)
# --------------------------------------------------------------------------
@app.get("/api/network/status", response_model=NetworkStatusResponse, tags=["network"])
def network_status(force: bool = Query(False)) -> dict:
    return cisco.network_status(force=force)


# --------------------------------------------------------------------------
# routes: response workflow + audit
# --------------------------------------------------------------------------
@app.get("/api/response/status", tags=["response"])
def response_status() -> dict:
    return responder.status()


@app.post("/api/response/actions", response_model=ResponseActionResponse, tags=["response"])
def response_action(payload: ResponseActionRequest) -> dict:
    """
    Controlled response.

    In the default `recommend` mode this records a recommendation and changes
    nothing. It cannot be made to block an arbitrary IP: the target must be on
    SOC_RESPONSE_ALLOWLIST and enforcement only ever touches the local host.
    """
    event = store.get_event(payload.event_id)
    try:
        result = responder.submit(
            event=event,
            event_id=payload.event_id,
            action_type=payload.action_type,
            target_ip=payload.target_ip or (event.get("src_ip") if event else None),
            reason=payload.reason,
            confirm=payload.confirm,
            authorization=payload.authorization,
        )
    except PolicyError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    if not result["executed"]:
        result["message"] += (
            " Network state on any Cisco device or remote host is unchanged."
        )
    return result


@app.get("/api/audit", response_model=list[AuditEntry], tags=["response"])
def audit_log(
    limit: int = Query(100, ge=1, le=500),
    event_id: str | None = Query(None, max_length=64),
) -> list[dict]:
    return audit.audit_log(limit=limit, event_id=event_id)


# --------------------------------------------------------------------------
# error handlers: keep the envelope consistent for the frontend
# --------------------------------------------------------------------------
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": True,
            "status": exc.status_code,
            "detail": exc.detail,
            "path": request.url.path,
            "timestamp": _now(),
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:  # pragma: no cover
    log.exception("unhandled error on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "error": True,
            "status": 500,
            "detail": "Internal server error. See backend logs - no partial data is returned.",
            "path": request.url.path,
            "timestamp": _now(),
        },
    )
