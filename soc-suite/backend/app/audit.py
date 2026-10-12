"""
Audit store for the SOC: analyst notes, event triage state and every action
taken (or merely proposed) through the response workflow.

SQLite with WAL, one connection per call, no ORM. The database is the single
source of truth for "what did the platform do", which is what makes the
dashboard's claimed actions auditable rather than cosmetic.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from .settings import get_settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id    TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    author      TEXT NOT NULL,
    note        TEXT NOT NULL,
    status      TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_event ON notes(event_id);

CREATE TABLE IF NOT EXISTS event_state (
    event_id    TEXT PRIMARY KEY,
    status      TEXT NOT NULL DEFAULT 'new',
    updated_at  TEXT NOT NULL,
    updated_by  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL,
    actor       TEXT NOT NULL,
    kind        TEXT NOT NULL,
    event_id    TEXT,
    action_type TEXT,
    target      TEXT,
    mode        TEXT,
    status      TEXT NOT NULL,
    detail      TEXT,
    rollback    TEXT,
    result      TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit(event_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit(created_at);
"""

VALID_STATUSES = {"new", "investigating", "resolved", "false_positive"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class AuditStore:
    def __init__(self, path: Path | None = None) -> None:
        self._path = path or get_settings().audit_db_path
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_db()

    # -- internals -------------------------------------------------------
    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._path, timeout=5.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init_db(self) -> None:
        with self._lock, self._connect() as conn:
            conn.executescript(_SCHEMA)

    def health(self) -> dict:
        try:
            with self._connect() as conn:
                notes = conn.execute("SELECT COUNT(*) AS c FROM notes").fetchone()["c"]
                audit = conn.execute("SELECT COUNT(*) AS c FROM audit").fetchone()["c"]
            return {
                "available": True,
                "path": str(self._path),
                "notes": notes,
                "audit_entries": audit,
                "error": None,
            }
        except sqlite3.Error as exc:
            return {"available": False, "path": str(self._path), "error": str(exc)}

    # -- analyst notes ---------------------------------------------------
    def add_note(
        self, event_id: str, note: str, author: str = "analyst", status: str | None = None
    ) -> dict:
        if status is not None and status not in VALID_STATUSES:
            raise ValueError(f"status must be one of {sorted(VALID_STATUSES)}")
        created = _now()
        with self._lock, self._connect() as conn:
            cur = conn.execute(
                "INSERT INTO notes (event_id, created_at, author, note, status) VALUES (?,?,?,?,?)",
                (event_id, created, author, note, status),
            )
            note_id = cur.lastrowid
            if status is not None:
                self._set_status(conn, event_id, status, author)
            conn.execute(
                "INSERT INTO audit (created_at, actor, kind, event_id, status, detail) "
                "VALUES (?,?,?,?,?,?)",
                (
                    created,
                    author,
                    "analyst_note",
                    event_id,
                    "recorded",
                    (note[:200] + "...") if len(note) > 200 else note,
                ),
            )
        return {
            "id": note_id,
            "event_id": event_id,
            "created_at": created,
            "author": author,
            "note": note,
            "status": status,
        }

    @staticmethod
    def _set_status(conn: sqlite3.Connection, event_id: str, status: str, actor: str) -> None:
        conn.execute(
            "INSERT INTO event_state (event_id, status, updated_at, updated_by) VALUES (?,?,?,?) "
            "ON CONFLICT(event_id) DO UPDATE SET status=excluded.status, "
            "updated_at=excluded.updated_at, updated_by=excluded.updated_by",
            (event_id, status, _now(), actor),
        )

    def set_status(self, event_id: str, status: str, actor: str = "analyst") -> dict:
        if status not in VALID_STATUSES:
            raise ValueError(f"status must be one of {sorted(VALID_STATUSES)}")
        with self._lock, self._connect() as conn:
            self._set_status(conn, event_id, status, actor)
            conn.execute(
                "INSERT INTO audit (created_at, actor, kind, event_id, status, detail) "
                "VALUES (?,?,?,?,?,?)",
                (_now(), actor, "status_change", event_id, status, f"status set to {status}"),
            )
        return {"event_id": event_id, "status": status, "updated_at": _now(), "updated_by": actor}

    def notes_for(self, event_id: str) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, event_id, created_at, author, note, status FROM notes "
                "WHERE event_id = ? ORDER BY id ASC",
                (event_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def state_map(self) -> dict[str, dict]:
        """event_id -> {status, note_count}. Used to decorate alert lists."""
        out: dict[str, dict] = {}
        with self._connect() as conn:
            for row in conn.execute("SELECT event_id, status, updated_at FROM event_state"):
                out[row["event_id"]] = {"status": row["status"], "updated_at": row["updated_at"]}
            for row in conn.execute(
                "SELECT event_id, COUNT(*) AS c FROM notes GROUP BY event_id"
            ):
                out.setdefault(row["event_id"], {})["note_count"] = row["c"]
        for value in out.values():
            value.setdefault("status", "new")
            value.setdefault("note_count", 0)
        return out

    def status_distribution(self) -> dict[str, int]:
        dist = {status: 0 for status in sorted(VALID_STATUSES)}
        with self._connect() as conn:
            for row in conn.execute("SELECT status, COUNT(*) AS c FROM event_state GROUP BY status"):
                dist[row["status"]] = row["c"]
        return dist

    # -- audit -----------------------------------------------------------
    def record_audit(
        self,
        *,
        kind: str,
        actor: str,
        status: str,
        event_id: str | None = None,
        action_type: str | None = None,
        target: str | None = None,
        mode: str | None = None,
        detail: str | None = None,
        rollback: str | None = None,
        result: dict | None = None,
    ) -> int:
        with self._lock, self._connect() as conn:
            cur = conn.execute(
                "INSERT INTO audit (created_at, actor, kind, event_id, action_type, target, "
                "mode, status, detail, rollback, result) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    _now(),
                    actor,
                    kind,
                    event_id,
                    action_type,
                    target,
                    mode,
                    status,
                    detail,
                    rollback,
                    json.dumps(result, default=str) if result is not None else None,
                ),
            )
            return int(cur.lastrowid)

    def audit_log(self, limit: int = 100, event_id: str | None = None) -> list[dict]:
        query = (
            "SELECT id, created_at, actor, kind, event_id, action_type, target, mode, "
            "status, detail, rollback, result FROM audit"
        )
        params: tuple = ()
        if event_id:
            query += " WHERE event_id = ?"
            params = (event_id,)
        query += " ORDER BY id DESC LIMIT ?"
        params += (max(1, min(limit, 500)),)
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

    def recent_actions_count(self, window_hours: int = 1) -> int:
        """Rate-limit input: how many *executed* actions in the last window."""
        from datetime import timedelta

        cutoff = (datetime.now(timezone.utc) - timedelta(hours=window_hours)).isoformat()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS c FROM audit WHERE kind = 'response_action' "
                "AND status = 'executed' AND created_at >= ?",
                (cutoff.replace("+00:00", "Z"),),
            ).fetchone()
        return int(row["c"])
