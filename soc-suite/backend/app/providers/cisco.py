"""
Cisco / Packet Tracer provider.

Two clearly separated planes:

1. **Evidence plane** (always available) - a JSON evidence pack that records the
   operator's own verified CLI outputs, addressing plan and test results. It is
   labelled `simulation evidence` everywhere it surfaces.
2. **Live plane** (opt-in, off by default) - a deliberately minimal TCP
   reachability probe. Packet Tracer devices generally expose no SSH/SNMP, so the
   adapter's job is to *report that honestly* rather than invent interface
   counters. It never logs in, never runs commands, never writes configuration.

Nothing in this module can modify a network device.
"""

from __future__ import annotations

import json
import logging
import socket
from datetime import datetime, timezone
from pathlib import Path

from ..settings import Settings, get_settings

log = logging.getLogger("sentinel.cisco")

PROBE_TIMEOUT = 2.0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class CiscoProvider:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._cache: dict | None = None
        self._cache_error: str | None = None

    # -- evidence pack ---------------------------------------------------
    def _load_pack(self) -> tuple[dict | None, str | None]:
        path: Path = self._settings.cisco_evidence_path
        try:
            with path.open("r", encoding="utf-8") as fh:
                pack = json.load(fh)
        except FileNotFoundError:
            return None, f"evidence pack not found at {path}"
        except PermissionError:
            return None, f"evidence pack not readable at {path} (permission denied)"
        except json.JSONDecodeError as exc:
            return None, f"evidence pack is not valid JSON: {exc}"
        except OSError as exc:
            return None, f"evidence pack could not be opened: {exc}"

        if not isinstance(pack, dict) or "devices" not in pack:
            return None, "evidence pack is missing the required 'devices' array"
        return pack, None

    # -- live plane ------------------------------------------------------
    def _probe_host(self, target: str) -> dict:
        host, _, port = target.partition(":")
        port_num = int(port) if port.isdigit() else 22
        result = {
            "target": target,
            "host": host,
            "port": port_num,
            "reachable": False,
            "error": None,
            "checked_at": _now(),
        }
        try:
            with socket.create_connection((host, port_num), timeout=PROBE_TIMEOUT):
                result["reachable"] = True
        except socket.timeout:
            result["error"] = "connection timed out"
        except (socket.gaierror, OSError) as exc:
            result["error"] = str(exc)
        return result

    def live_status(self) -> dict:
        st = self._settings
        state: dict = {
            "enabled": st.cisco_live_enabled,
            "supported_by_devices": False,
            "adapter": "cisco-live-reachability",
            "probes": [],
            "note": "",
            "checked_at": _now(),
        }
        if not st.cisco_live_enabled:
            state["note"] = (
                "Live Cisco collection is disabled. The dashboard is showing verified "
                "Packet Tracer evidence only. Enable with SOC_CISCO_LIVE_ENABLED=true "
                "only after confirming your exact devices accept management connections."
            )
            return state

        if not st.cisco_live_hosts:
            state["note"] = (
                "Explicitly enabled, but SOC_CISCO_LIVE_HOSTS is empty, so there is "
                "nothing to probe. No telemetry is shown rather than fabricating it."
            )
            return state

        state["probes"] = [self._probe_host(target) for target in st.cisco_live_hosts]
        reachable = [p for p in state["probes"] if p["reachable"]]
        state["supported_by_devices"] = bool(reachable)
        state["note"] = (
            f"{len(reachable)} of {len(state['probes'])} management endpoint(s) accepted a "
            "TCP connection. Reachability alone is NOT device telemetry: no login was "
            "performed and no interface counters are claimed."
            if reachable
            else "No management endpoint accepted a connection. Packet Tracer devices "
            "typically cannot serve external collectors - evidence mode is the correct answer."
        )
        return state

    # -- composed view ---------------------------------------------------
    def network_status(self, force: bool = False) -> dict:
        if self._cache is not None and not force:
            pack = self._cache
            error = self._cache_error
        else:
            pack, error = self._load_pack()
            self._cache, self._cache_error = pack, error

        live = self.live_status()
        mode = "live" if live.get("supported_by_devices") else "evidence"

        if pack is None:
            return {
                "generated_at": _now(),
                "provider": "cisco-packet-tracer",
                "provider_mode": "evidence",
                "data_class": "unavailable",
                "disclosure": f"Network evidence unavailable: {error}",
                "evidence_pack": {"available": False, "error": error},
                "sites": [],
                "devices": [],
                "links": [],
                "evidence": [],
                "live_collection": live,
            }

        return {
            "generated_at": _now(),
            "provider": "cisco-packet-tracer",
            "provider_mode": mode,
            "data_class": "simulation-evidence",
            "disclosure": pack.get("provenance_disclosure", ""),
            "evidence_pack": {
                "available": True,
                "pack_id": pack.get("pack_id"),
                "title": pack.get("title"),
                "source_system": pack.get("source_system"),
                "version": pack.get("pack_version"),
                "generated_at": pack.get("generated_at"),
                "generated_at_note": pack.get("generated_at_note"),
                "path": str(self._settings.cisco_evidence_path),
                "addressing_plan": pack.get("addressing_plan", []),
            },
            "sites": pack.get("sites", []),
            "devices": pack.get("devices", []),
            "links": pack.get("links", []),
            "evidence": pack.get("evidence", []),
            "live_collection": live,
        }

    def summary(self) -> dict:
        """Compact form embedded in /api/system/status."""
        status = self.network_status()
        devices = status.get("devices", [])
        by_status: dict[str, int] = {}
        for device in devices:
            key = device.get("evidence_status", "unknown")
            by_status[key] = by_status.get(key, 0) + 1
        return {
            "provider": status["provider"],
            "provider_mode": status["provider_mode"],
            "data_class": status["data_class"],
            "evidence_pack_available": status["evidence_pack"].get("available", False),
            "devices_total": len(devices),
            "devices_by_evidence_status": by_status,
            "links_total": len(status.get("links", [])),
            "evidence_items": len(status.get("evidence", [])),
            "live_collection": status["live_collection"],
        }
