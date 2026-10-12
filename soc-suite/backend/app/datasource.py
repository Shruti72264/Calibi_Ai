"""
Data-source layer: live Suricata telemetry and historical baseline evidence.

The single most important property of this module is that the two sources are
*never* blended silently. Every event carries `source: "live" | "historical"`,
and the status endpoint reports each source's health separately, so the
dashboard can always answer "where did this row come from?".
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from .parser import FileReadStats, read_events, sort_events
from .settings import Settings, get_settings

log = logging.getLogger("sentinel.datasource")

LIVE = "live"
HISTORICAL = "historical"


@dataclass
class SourceStatus:
    """Honest health report for one configured data source."""

    source: str
    enabled: bool
    configured_paths: list[str]
    files: list[dict] = field(default_factory=list)
    events_available: int = 0
    state: str = "unknown"  # ok | empty | missing | unreadable | disabled | error
    detail: str = ""

    def as_dict(self) -> dict:
        return {
            "source": self.source,
            "enabled": self.enabled,
            "state": self.state,
            "detail": self.detail,
            "configured_paths": self.configured_paths,
            "events_available": self.events_available,
            "files": self.files,
        }


@dataclass
class DataSnapshot:
    """A cached read of every configured source."""

    events: list[dict] = field(default_factory=list)
    statuses: dict[str, SourceStatus] = field(default_factory=dict)
    read_at: float = 0.0
    read_duration_ms: int = 0

    def counts(self) -> dict[str, int]:
        live = sum(1 for e in self.events if e["source"] == LIVE)
        historical = sum(1 for e in self.events if e["source"] == HISTORICAL)
        return {LIVE: live, HISTORICAL: historical, "total": len(self.events)}


class EventStore:
    """
    Thread-safe, mtime-aware cache in front of the EVE files.

    uvicorn runs the app in a single process here, but a lock costs nothing and
    keeps re-reads from stampeding when several dashboard widgets poll at once.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._lock = threading.Lock()
        self._snapshot: DataSnapshot | None = None

    # -- configuration ---------------------------------------------------
    @property
    def settings(self) -> Settings:
        return self._settings

    def reload_settings(self, settings: Settings) -> None:
        """Used by tests / config reload without restarting the process."""
        with self._lock:
            self._settings = settings
            self._snapshot = None

    # -- reading ---------------------------------------------------------
    def _read_live(self) -> tuple[list[dict], SourceStatus]:
        st = self._settings
        status = SourceStatus(
            source=LIVE,
            enabled=st.live_enabled,
            configured_paths=[str(st.live_eve_path)],
        )
        if not st.live_enabled:
            status.state = "disabled"
            status.detail = "Live capture is disabled (SOC_LIVE_ENABLED=false)."
            return [], status

        path = st.live_eve_path
        events, stats = read_events(
            path,
            source=LIVE,
            max_bytes=st.live_max_tail_bytes,
            max_records=st.live_max_records,
        )
        status.files = [stats.as_dict()]
        status.events_available = len(events)

        if not stats.exists:
            status.state = "missing"
            status.detail = (
                f"Live EVE file not found at {path}. Suricata may not be running, or "
                "SOC_LIVE_EVE_PATH needs to point at the real log."
            )
        elif not stats.readable:
            status.state = "unreadable"
            status.detail = stats.error or "Live EVE file could not be read."
        elif not events:
            status.state = "empty"
            status.detail = (
                "Live EVE file exists but contains no alert events yet "
                f"({stats.size_bytes} bytes, {stats.lines_total} lines read)."
            )
        else:
            status.state = "ok"
            status.detail = (
                f"{len(events)} live alert event(s) from the current EVE file."
                + (f" {stats.lines_invalid} unparseable line(s) skipped." if stats.lines_invalid else "")
            )
        return events, status

    def _read_historical(self) -> tuple[list[dict], SourceStatus]:
        st = self._settings
        status = SourceStatus(
            source=HISTORICAL,
            enabled=st.historical_enabled,
            configured_paths=[str(p) for p in st.historical_eve_paths],
        )
        if not st.historical_enabled or not st.historical_eve_paths:
            status.state = "disabled"
            status.detail = "Historical evidence source is disabled."
            return [], status

        collected: list[dict] = []
        seen: set[tuple[str, str]] = set()
        problems: list[str] = []

        for path in st.historical_eve_paths:
            events, stats = read_events(
                path, source=HISTORICAL, max_records=st.historical_max_records
            )
            status.files.append(stats.as_dict())
            if stats.error and not stats.exists:
                problems.append(f"{path.name}: {stats.error}")
            elif stats.error:
                problems.append(f"{path.name}: {stats.error}")
            for event in events:
                # Same evidence file may be reached through two configured
                # paths; de-duplicate so counts stay truthful.
                key = (event["source_file"], event["event_id"])
                if key in seen:
                    continue
                seen.add(key)
                collected.append(event)

        collected = sort_events(collected)[: st.historical_max_records]
        status.events_available = len(collected)

        if collected:
            status.state = "ok"
            status.detail = (
                f"{len(collected)} historical baseline event(s) loaded from "
                f"{len(status.files)} evidence file(s). Label these as recorded "
                "baseline evidence, not live traffic."
            )
        elif problems and all(not f["exists"] for f in status.files):
            status.state = "missing"
            status.detail = "Historical evidence file(s) not found: " + "; ".join(problems)
        else:
            status.state = "empty"
            status.detail = (
                "Historical evidence file(s) exist but contain no alert events."
                + (" " + "; ".join(problems) if problems else "")
            )

        # Report the worst parse quality so a partially corrupt evidence file
        # cannot hide behind a good one.
        for f in status.files:
            if f.get("lines_invalid"):
                status.detail += (
                    f" Note: {f['lines_invalid']} unparseable line(s) skipped in "
                    f"{Path(f['path']).name}."
                )
        return collected, status

    def snapshot(self, force: bool = False) -> DataSnapshot:
        now = time.time()
        cached = self._snapshot
        if (
            not force
            and cached is not None
            and (now - cached.read_at) < self._settings.cache_ttl_seconds
        ):
            return cached

        with self._lock:
            cached = self._snapshot
            if (
                not force
                and cached is not None
                and (time.time() - cached.read_at) < self._settings.cache_ttl_seconds
            ):
                return cached

            started = time.perf_counter()
            live_events, live_status = self._read_live()
            hist_events, hist_status = self._read_historical()

            merged = sort_events(live_events + hist_events)
            snap = DataSnapshot(
                events=merged,
                statuses={LIVE: live_status, HISTORICAL: hist_status},
                read_at=time.time(),
                read_duration_ms=int((time.perf_counter() - started) * 1000),
            )
            self._snapshot = snap
            return snap

    # -- convenience -----------------------------------------------------
    def all_events(self, force: bool = False) -> list[dict]:
        return self.snapshot(force=force).events

    def get_event(self, event_id: str) -> dict | None:
        for event in self.all_events():
            if event["event_id"] == event_id:
                return event
        return None

    def source_status(self, force: bool = False) -> dict:
        snap = self.snapshot(force=force)
        return {
            "sources": [snap.statuses[LIVE].as_dict(), snap.statuses[HISTORICAL].as_dict()],
            "counts": snap.counts(),
            "read_duration_ms": snap.read_duration_ms,
            "cache_ttl_seconds": self._settings.cache_ttl_seconds,
            "read_at": _iso(snap.read_at),
        }

    def empty_file_probe(self) -> list[dict]:
        """
        Small, explicit diagnostic used by /api/system/status: for each
        configured file, report size/mtime/lines without loading everything.
        """
        out: list[dict] = []
        for source, paths in (
            (LIVE, [self._settings.live_eve_path]),
            (HISTORICAL, list(self._settings.historical_eve_paths)),
        ):
            for path in paths:
                probe = FileReadStats(path)
                if not path.exists():
                    probe.error = "file not found"
                else:
                    try:
                        stat = path.stat()
                        probe.exists = True
                        probe.readable = True
                        probe.size_bytes = stat.st_size
                        probe.modified_at = _iso(stat.st_mtime)
                    except OSError as exc:
                        probe.error = str(exc)
                out.append({"source": source, **probe.as_dict()})
        return out


def _iso(epoch: float) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat().replace("+00:00", "Z")
