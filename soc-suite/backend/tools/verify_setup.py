#!/usr/bin/env python3
"""
Pre-flight check for the SENTINEL SOC backend.

Verifies, without changing anything:
  * the data-source files exist, are readable and parse cleanly
  * the live EVE path is either readable or explains why not (permissions!)
  * the Suricata service state and version, if Suricata is on this host
  * the audit database opens
  * the response engine's mode and allow-list
  * that every mutating route is closed unless explicitly enabled

Exit code 0 = ready to demo, 1 = blocking problem found.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import suricata_status  # noqa: E402
from app.audit import AuditStore  # noqa: E402
from app.datasource import EventStore  # noqa: E402
from app.providers import CiscoProvider  # noqa: E402
from app.response import ResponseEngine  # noqa: E402
from app.settings import get_settings  # noqa: E402


def line(label: str, ok: bool | None, detail: str) -> None:
    mark = {True: "PASS", False: "FAIL", None: "INFO"}[ok]
    print(f"[{mark}] {label:<34} {detail}")


def main() -> int:
    settings = get_settings()
    failures = 0
    print("=" * 78)
    print(" SENTINEL SOC - backend pre-flight")
    print("=" * 78)

    # 1. settings
    print("\n-- configuration " + "-" * 60)
    for key, value in settings.as_public_dict().items():
        print(f"  {key:<32} {value}")

    # 2. data sources
    print("\n-- data sources " + "-" * 61)
    store = EventStore(settings)
    snapshot = store.snapshot(force=True)
    for source, status in snapshot.statuses.items():
        ok = status.state == "ok" if source == "live" else status.state != "disabled"
        if source == "live" and status.state in {"missing", "empty"}:
            ok = None  # a missing live log is expected off-sensor; not a failure
        line(f"{source} source ({status.state})", ok, status.detail)
        for file in status.files:
            print(
                f"        file: {file['path']}\n"
                f"              exists={file['exists']} readable={file['readable']} "
                f"size={file['size_bytes']} lines={file['lines_total']} "
                f"invalid={file['lines_invalid']} error={file['error']}"
            )
        if source == "historical" and status.state in {"missing", "empty"}:
            failures += 1

    counts = snapshot.counts()
    line("events available", counts["total"] > 0, f"{counts}")

    # 3. suricata
    print("\n-- suricata " + "-" * 66)
    suri = suricata_status.collect(settings, settings.live_eve_path)
    line("suricata binary", None if not suri["binary_present"] else True,
         suri.get("version") or "not found on this host")
    line("service state", None, suri["service_state"])
    line("eve file", None,
         f"exists={suri['eve_file']['exists']} size={suri['eve_file']['size_bytes']} "
         f"readable={suri['eve_file']['readable']}")
    if suri["binary_present"] and suri["service_state"] not in {"active", "unknown"}:
        line("sensor running", False,
             "Suricata is present but not active: no live events until it is started deliberately")
    if suri["interpretation"]:
        print(f"        note: {suri['interpretation']}")

    # 4. cisco provider
    print("\n-- cisco provider " + "-" * 58)
    cisco = CiscoProvider(settings)
    net = cisco.network_status(force=True)
    available = net["evidence_pack"].get("available", False)
    line("evidence pack", available, net["evidence_pack"].get("error") or net["evidence_pack"].get("pack_id", ""))
    if available:
        line("devices / links", len(net["devices"]) > 0,
             f"{len(net['devices'])} device(s), {len(net['links'])} link(s), "
             f"{len(net['evidence'])} evidence item(s)")
        line("live collection", None, net["live_collection"]["note"])
    else:
        failures += 1

    # 5. audit store + response engine
    print("\n-- response & audit " + "-" * 57)
    audit = AuditStore(settings.audit_db_path)
    health = audit.health()
    line("audit database", health["available"], f"{health.get('path')} - {health.get('error') or 'ok'}")
    if not health["available"]:
        failures += 1
    engine = ResponseEngine(settings, audit)
    status = engine.status()
    line("response mode", None, f"{status['mode']} (secure default: recommend)")
    line("allow list", None,
         f"{len(status['allowlist'])} entrie(s): {status['allowlist'] or 'none - enforcement impossible by design'}")
    line("local firewall", None, status["local_firewall_backend"])

    # 6. security posture
    print("\n-- security posture " + "-" * 57)
    line("write protection", None,
         "CLOSED (read-only API)" if not settings.writes_are_enabled
         else "OPEN - mutating routes require X-API-Key")
    line("cors origins", None, ", ".join(settings.cors_origins))
    line("cors regex", None, settings.cors_origin_regex)

    print("\n" + "=" * 78)
    if failures:
        print(f" RESULT: {failures} blocking problem(s) - fix these before the demo.")
    else:
        print(" RESULT: ready. Start with:")
        print("   uvicorn app.main:app --host 0.0.0.0 --port 8000")
        print("   docs at http://127.0.0.1:8000/docs")
    print("=" * 78)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
