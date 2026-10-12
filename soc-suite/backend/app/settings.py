"""
Central configuration for the SENTINEL SOC backend.

Every tunable is an environment variable with a safe default, so the service
starts (degrades gracefully) on a machine that has no Suricata installed and
no log files at all -- which is exactly what the dashboard's "System Health"
view is designed to report honestly.

No user input ever reaches these values: paths, allow-lists and modes are
read once at import time from the process environment.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_ROOT / "data"

API_VERSION = "1.0.0"


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_list(name: str, default: list[str] | None = None) -> list[str]:
    raw = os.getenv(name)
    if raw is None:
        return list(default or [])
    return [item.strip() for item in raw.replace(",", ":").split(":") if item.strip()]


@dataclass(frozen=True)
class Settings:
    """Immutable snapshot of the process configuration."""

    # --- identity -------------------------------------------------------
    env: str = field(default_factory=lambda: os.getenv("SOC_ENV", "development"))
    api_title: str = "SENTINEL SOC API"
    api_version: str = API_VERSION

    # --- live Suricata EVE JSON ----------------------------------------
    live_enabled: bool = field(default_factory=lambda: _env_bool("SOC_LIVE_ENABLED", True))
    live_eve_path: Path = field(
        default_factory=lambda: Path(os.getenv("SOC_LIVE_EVE_PATH", "/var/log/suricata/eve.json"))
    )
    # Only ever read the tail of a very large live file: an EVE log on a busy
    # link can be gigabytes, and a dashboard never needs the whole thing.
    live_max_tail_bytes: int = field(
        default_factory=lambda: _env_int("SOC_LIVE_MAX_TAIL_BYTES", 8_000_000)
    )
    live_max_records: int = field(default_factory=lambda: _env_int("SOC_LIVE_MAX_RECORDS", 2000))

    # --- historical evidence -------------------------------------------
    # Deliberately a *separate* source: historical baseline evidence must stay
    # visually and structurally distinct from live telemetry.
    historical_enabled: bool = field(
        default_factory=lambda: _env_bool("SOC_HISTORICAL_ENABLED", True)
    )
    historical_eve_paths: tuple[Path, ...] = field(
        default_factory=lambda: tuple(
            Path(p)
            for p in _env_list(
                "SOC_HISTORICAL_EVE_PATHS",
                [str(DATA_DIR / "historical" / "eve-alerts-history.json")],
            )
        )
    )
    historical_max_records: int = field(
        default_factory=lambda: _env_int("SOC_HISTORICAL_MAX_RECORDS", 5000)
    )

    # --- cache ----------------------------------------------------------
    cache_ttl_seconds: int = field(default_factory=lambda: _env_int("SOC_CACHE_TTL_SECONDS", 5))

    # --- HTTP / CORS ----------------------------------------------------
    # The dashboard runs on a fixed dev origin locally, plus the ephemeral
    # sandbox preview host. Nothing else is allowed through.
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            _env_list(
                "SOC_CORS_ORIGINS",
                ["http://localhost:5173", "http://127.0.0.1:5173"],
            )
        )
    )
    cors_origin_regex: str = field(
        default_factory=lambda: os.getenv(
            "SOC_CORS_ORIGIN_REGEX", r"^https://[a-z0-9-]+\.e2b\.app$"
        )
    )

    # --- write protection ----------------------------------------------
    # Mutating endpoints stay closed until an API key is configured AND
    # writes are explicitly enabled. This is fail-closed by design.
    api_key: str | None = field(default_factory=lambda: os.getenv("SOC_API_KEY") or None)
    allow_writes: bool = field(default_factory=lambda: _env_bool("SOC_ALLOW_WRITES", False))

    # --- controlled response -------------------------------------------
    # recommend -> only suggests an action (never executes)
    # dry_run   -> validates and renders the exact command, executes nothing
    # enforce   -> executes on the local host, only for allow-listed targets
    response_mode: str = field(
        default_factory=lambda: os.getenv("SOC_RESPONSE_MODE", "recommend").strip().lower()
    )
    response_allowlist: tuple[str, ...] = field(
        default_factory=lambda: tuple(_env_list("SOC_RESPONSE_ALLOWLIST", []))
    )
    response_max_actions_per_hour: int = field(
        default_factory=lambda: _env_int("SOC_RESPONSE_MAX_ACTIONS_PER_HOUR", 10)
    )
    audit_db_path: Path = field(
        default_factory=lambda: Path(
            os.getenv("SOC_AUDIT_DB", str(DATA_DIR / "audit" / "soc-audit.sqlite3"))
        )
    )

    # --- Cisco / Packet Tracer -----------------------------------------
    cisco_evidence_path: Path = field(
        default_factory=lambda: Path(
            os.getenv(
                "SOC_CISCO_EVIDENCE_PATH",
                str(DATA_DIR / "cisco" / "network_evidence.json"),
            )
        )
    )
    # Off by default and *independent* of the evidence provider: Packet Tracer
    # devices mostly do not expose SSH/SNMP, so live collection is opt-in and
    # reports its own failure reasons rather than pretending to succeed.
    cisco_live_enabled: bool = field(
        default_factory=lambda: _env_bool("SOC_CISCO_LIVE_ENABLED", False)
    )
    cisco_live_hosts: tuple[str, ...] = field(
        default_factory=lambda: tuple(_env_list("SOC_CISCO_LIVE_HOSTS", []))
    )

    # --- system probes --------------------------------------------------
    suricata_binary: str = field(default_factory=lambda: os.getenv("SOC_SURICATA_BINARY", "suricata"))
    suricata_fast_log: Path = field(
        default_factory=lambda: Path(
            os.getenv("SOC_SURICATA_FAST_LOG", "/var/log/suricata/fast.log")
        )
    )
    suricata_stats_log: Path = field(
        default_factory=lambda: Path(
            os.getenv("SOC_SURICATA_STATS_LOG", "/var/log/suricata/stats.log")
        )
    )
    # `systemctl is-active suricata` is a fixed argv probe with no user input.
    systemctl_probe: bool = field(default_factory=lambda: _env_bool("SOC_SYSTEMCTL_PROBE", True))

    def as_public_dict(self) -> dict:
        """Configuration surfaced to the dashboard (no secrets, ever)."""
        return {
            "env": self.env,
            "api_version": self.api_version,
            "live_enabled": self.live_enabled,
            "live_eve_path": str(self.live_eve_path),
            "historical_eve_paths": [str(p) for p in self.historical_eve_paths],
            "response_mode": self.response_mode,
            "response_allowlist_size": len(self.response_allowlist),
            "writes_enabled": self.writes_are_enabled,
            "cisco_live_enabled": self.cisco_live_enabled,
            "systemctl_probe": self.systemctl_probe,
        }

    @property
    def writes_are_enabled(self) -> bool:
        """Mutating endpoints require BOTH a key and an explicit opt-in."""
        return bool(self.api_key) and self.allow_writes

    @property
    def has_live_source(self) -> bool:
        return self.live_enabled and bool(str(self.live_eve_path))


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
