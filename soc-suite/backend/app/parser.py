"""
Suricata EVE JSON -> stable SOC event schema.

Design rules (these matter for the honesty of the dashboard):

* Reading is *defensive*. A truncated final line (extremely common: Suricata is
  still writing the file while we read it), a half-written object, a `.gz`
  rotation, a permission error, a missing file -- none of these may raise.
  They are counted and reported instead.
* Normalisation is lossy on purpose: the dashboard gets a fixed set of fields,
  and anything unusual is preserved under `raw_excerpt` for the analyst.
* `action` is inferred ONLY from fields Suricata actually writes
  (`alert.action`, `event_type`, `flow.action`, `drop` sub-objects). If the
  record does not say, the value is `unknown` -- never `allowed` by guesswork.
"""

from __future__ import annotations

import gzip
import hashlib
import io
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

log = logging.getLogger("sentinel.parser")

# Suricata's own alert.severity is 1=high .. 3=low (for the built-in rule sets).
# Custom rules that omit severity default to 3 in Suricata.
SEVERITY_BY_NUMBER = {1: "high", 2: "medium", 3: "low"}
SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2, "unknown": 3}

# EVE record types that carry a security event we care about.
ALERT_EVENT_TYPES = {"alert", "drop", "ips"}

MAX_PAYLOAD_CHARS = 512


# --------------------------------------------------------------------------
# low-level iteration
# --------------------------------------------------------------------------
class FileReadStats:
    """Counters describing how cleanly a file was parsed."""

    def __init__(self, path: Path) -> None:
        self.path = str(path)
        self.exists = False
        self.readable = False
        self.size_bytes = 0
        self.modified_at: str | None = None
        self.lines_total = 0
        self.lines_invalid = 0
        self.lines_trailing_partial = 0
        self.error: str | None = None

    def as_dict(self) -> dict:
        return {
            "path": self.path,
            "exists": self.exists,
            "readable": self.readable,
            "size_bytes": self.size_bytes,
            "modified_at": self.modified_at,
            "lines_total": self.lines_total,
            "lines_invalid": self.lines_invalid,
            "lines_trailing_partial": self.lines_trailing_partial,
            "error": self.error,
        }


def _open_text(path: Path) -> io.TextIOBase:
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8", errors="replace")
    return path.open("r", encoding="utf-8", errors="replace")


def iter_json_lines(path: Path, stats: FileReadStats, max_bytes: int | None = None) -> Iterator[dict]:
    """
    Yield parsed JSON objects from a JSON-Lines file, skipping anything broken.

    `max_bytes` (only used for live logs) reads just the tail of the file; we
    accept that the first line after seeking is usually partial and drop it.
    """
    try:
        st = path.stat()
    except FileNotFoundError:
        stats.error = "file not found"
        return
    except PermissionError:
        stats.exists = True
        stats.error = (
            "permission denied - add the service account to the suricata group "
            "(or set SOC_LIVE_EVE_PATH to a readable copy)"
        )
        return
    except OSError as exc:  # pragma: no cover - filesystem specific
        stats.error = f"stat failed: {exc}"
        return

    stats.exists = True
    stats.readable = True
    stats.size_bytes = st.st_size
    stats.modified_at = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat()

    try:
        handle = _open_text(path)
    except (PermissionError, OSError) as exc:
        stats.readable = False
        stats.error = f"open failed: {exc}"
        return

    with handle as fh:
        truncated_tail = False
        if max_bytes is not None and max_bytes > 0 and path.suffix != ".gz":
            if st.st_size > max_bytes:
                fh.seek(st.st_size - max_bytes)
                truncated_tail = True
                fh.readline()  # discard the partial first line

        for raw_line in fh:
            line = raw_line.strip()
            if not line:
                continue
            stats.lines_total += 1
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                stats.lines_invalid += 1
                continue
            if not isinstance(obj, dict):
                stats.lines_invalid += 1
                continue
            yield obj

        if truncated_tail:
            stats.lines_trailing_partial += 1  # the discarded partial line


# --------------------------------------------------------------------------
# normalisation helpers
# --------------------------------------------------------------------------
def _first_str(*candidates: Any) -> str | None:
    for value in candidates:
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, int):
            return str(value)
    return None


def _as_port(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and 0 <= value <= 65535:
        return value
    if isinstance(value, str) and value.isdigit():
        port = int(value)
        return port if 0 <= port <= 65535 else None
    return None


def _parse_ts(value: Any) -> str | None:
    """Suricata writes `2026-10-12T06:47:00.123456+0000`; normalise to ISO-Z."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        return text
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z"):
            try:
                parsed = datetime.strptime(text, fmt)
                break
            except ValueError:
                continue
        else:
            return text  # keep the original string rather than inventing one
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _severity_of(alert: dict, event_type: str) -> str:
    raw = alert.get("severity")
    if isinstance(raw, int) and raw in SEVERITY_BY_NUMBER:
        return SEVERITY_BY_NUMBER[raw]
    if isinstance(raw, str):
        low = raw.strip().lower()
        if low in SEVERITY_RANK:
            return low
        if low.isdigit() and int(low) in SEVERITY_BY_NUMBER:
            return SEVERITY_BY_NUMBER[int(low)]
    if event_type == "drop":
        return "high"  # an explicit drop event is never "low"
    return "unknown"


def _action_of(record: dict, alert: dict, event_type: str) -> tuple[str, str]:
    """
    Return (action, provenance). Provenance documents *why* we believe an event
    was blocked, so the UI can show the evidence instead of asserting a block.
    """
    candidate = alert.get("action")
    if isinstance(candidate, str) and candidate.strip():
        value = candidate.strip().lower()
        if value in {"blocked", "drop", "dropped"}:
            return "blocked", "alert.action"
        if value in {"allowed", "pass", "accept"}:
            return "allowed", "alert.action"

    if event_type in {"drop", "ips"}:
        return "blocked", f"event_type={event_type}"

    # A drop rule that fires is recorded by Suricata 7/8 under the alert's
    # `action` field, but older builds only expose it in flow/verdict blocks.
    verdict = record.get("flow", {}).get("action") if isinstance(record.get("flow"), dict) else None
    if isinstance(verdict, str) and verdict.strip().lower() in {"drop", "blocked"}:
        return "blocked", "flow.action"

    if "drop" in record and isinstance(record["drop"], dict):
        return "blocked", "drop.reason"

    return "unknown", "not recorded in the EVE event"


def _stable_event_id(record: dict, source_label: str) -> str:
    """
    Deterministic id so the same event keeps the same identity across polls
    (the dashboard can then hold analyst state against it without collisions).
    """
    flow_id = record.get("flow_id")
    timestamp = record.get("timestamp")
    if flow_id is not None and timestamp:
        basis = f"{source_label}|{flow_id}|{timestamp}|{record.get('event_type')}"
    else:
        basis = json.dumps(record, sort_keys=True, default=str)
    return hashlib.sha1(basis.encode("utf-8", "replace")).hexdigest()[:16]


def _truncate(text: Any) -> str | None:
    if not isinstance(text, str) or not text:
        return None
    if len(text) <= MAX_PAYLOAD_CHARS:
        return text
    return text[:MAX_PAYLOAD_CHARS] + f"...[+{len(text) - MAX_PAYLOAD_CHARS} chars]"


# --------------------------------------------------------------------------
# public API
# --------------------------------------------------------------------------
def normalize_event(record: dict, *, source: str, source_file: str) -> dict:
    """Map one raw EVE record onto the dashboard's stable event schema."""
    alert = record.get("alert") if isinstance(record.get("alert"), dict) else {}
    event_type = str(record.get("event_type") or "unknown").lower()
    action, action_source = _action_of(record, alert, event_type)

    timestamp = _parse_ts(record.get("timestamp"))
    src_ip = _first_str(record.get("src_ip"))
    dest_ip = _first_str(record.get("dest_ip"))
    signature = _first_str(alert.get("signature"), "signature")
    sid = alert.get("signature_id") or alert.get("sid")

    return {
        "event_id": _stable_event_id(record, source_file),
        "source": source,  # "live" | "historical"
        "source_file": source_file,
        "event_kind": "suricata-eve",
        "timestamp": timestamp,
        "timestamp_raw": record.get("timestamp"),
        "flow_id": record.get("flow_id"),
        "event_type": event_type,
        "src_ip": src_ip,
        "src_port": _as_port(record.get("src_port")),
        "dest_ip": dest_ip,
        "dest_port": _as_port(record.get("dest_port")),
        "proto": (_first_str(record.get("proto")) or "unknown").upper(),
        "app_proto": _first_str(record.get("app_proto")),
        "signature": signature or "unnamed event",
        "rule_id": int(sid) if isinstance(sid, (int, str)) and str(sid).isdigit() else sid,
        "gid": alert.get("gid", 1),
        "rev": alert.get("rev"),
        "category": _first_str(alert.get("category")),
        "severity": _severity_of(alert, event_type),
        "action": action,
        "action_source": action_source,
        "action_raw": alert.get("action"),
        "host": _first_str(record.get("host")),
        "interface": _first_str(record.get("interface")),
        "community_id": _first_str(record.get("community_id")),
        "flow": record.get("flow") if isinstance(record.get("flow"), dict) else None,
        "packet_info": record.get("packet_info") if isinstance(record.get("packet_info"), dict) else None,
        "payload_printable": _truncate(record.get("payload_printable")),
        "pcap_file": _first_str(record.get("pcap_file")),
        "is_custom_rule": bool(isinstance(sid, (int, str)) and str(sid).isdigit() and int(sid) >= 1_000_000),
        "raw_excerpt": {
            key: record.get(key)
            for key in ("event_type", "timestamp", "flow_id", "in_iface", "src_ip", "dest_ip")
            if key in record
        },
    }


def read_events(
    path: Path,
    *,
    source: str,
    max_bytes: int | None = None,
    max_records: int | None = None,
    include_non_alert: bool = False,
) -> tuple[list[dict], FileReadStats]:
    """
    Read a Suricata EVE file and normalise it. Never raises.

    Returns (events, stats) with events in *file order*; callers sort and
    filter. `max_records` keeps the newest N.
    """
    stats = FileReadStats(path)
    events: list[dict] = []

    for record in iter_json_lines(path, stats, max_bytes=max_bytes):
        event_type = str(record.get("event_type") or "").lower()
        if not include_non_alert and event_type not in ALERT_EVENT_TYPES:
            continue
        events.append(normalize_event(record, source=source, source_file=str(path)))

    if max_records and len(events) > max_records:
        events = events[-max_records:]

    return events, stats


def sort_events(events: list[dict]) -> list[dict]:
    """
    Newest first. Events with no timestamp sort to the bottom rather than
    being dropped -- an event we cannot place in time is still evidence.
    """
    return sorted(
        events,
        key=lambda e: (e.get("timestamp") or "", e.get("event_id") or ""),
        reverse=True,
    )


def severity_rank(severity: str | None) -> int:
    return SEVERITY_RANK.get((severity or "unknown").lower(), 3)
