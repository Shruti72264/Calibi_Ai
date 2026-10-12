#!/usr/bin/env python3
"""
Build the historical evidence baseline used by the SENTINEL SOC dashboard.

WHY THIS SCRIPT EXISTS
----------------------
The dashboard must be demonstrable before it is reconnected to a live sensor,
and it must never lie about where its numbers come from. So the baseline file
it ships with is *machine-generated and self-labelling*:

  * the two records the operator actually reported from the Suricata session
    (LOCAL IDS TEST / sid 1000001 -> allowed, LOCAL IPS TEST / sid 1000002 ->
    blocked) are reproduced with `provenance: "operator-reported"`;
  * the additional records that bring the file to the reported 12 valid EVE
    records are marked `provenance: "generated-for-demo"` and carry a
    `sentinel_demo` metadata block that says so.

The importer (`tools/import_eve_evidence.py`) replaces this file with your real
rotated EVE log in one command, at which point every record is genuine evidence
and the `generated-for-demo` count in the UI drops to zero.

Usage:
    python3 tools/make_demo_history.py \
        --out data/historical/eve-alerts-history.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

KALI_IP = "192.168.61.129"
TARGET_IP = "8.8.8.8"
IFACE = "eth0"
HOSTNAME = "kali"
SURICATA_VERSION = "8.0.6"

IDS_SID = 1000001
IPS_SID = 1000002


def record(
    *,
    timestamp: str,
    flow_id: int,
    action: str,
    sid: int,
    signature: str,
    severity: int,
    provenance: str,
    note: str,
    in_iface: str = IFACE,
) -> dict:
    """
    One EVE `alert` record shaped exactly like Suricata writes it, plus two
    non-standard metadata keys the dashboard understands.

    Fields Suricata would populate from the wire but that were not part of the
    operator's record (payload bytes, pcap file, community_id) are deliberately
    omitted rather than invented.
    """
    return {
        "timestamp": timestamp,
        "flow_id": flow_id,
        "in_iface": in_iface,
        "event_type": "alert",
        "src_ip": KALI_IP,
        "dest_ip": TARGET_IP,
        "proto": "ICMP",
        "icmp_type": 8,
        "icmp_code": 0,
        "alert": {
            "action": action,
            "gid": 1,
            "signature_id": sid,
            "rev": 1,
            "signature": signature,
            "category": "Misc activity",
            "severity": severity,
        },
        "host": HOSTNAME,
        # --- sentinel metadata (ignored by Suricata, used for labelling) ---
        "sentinel_provenance": provenance,
        "sentinel_note": note,
    }


def build() -> dict:
    """12 records: 2 operator-reported, 10 generated-for-demo."""
    demo_note = (
        "Generated-for-demo record: this file exists so the dashboard, the API "
        "contract and the correlation logic can be validated end-to-end with a "
        "non-zero dataset. Replace it with your real rotated EVE log using "
        "tools/import_eve_evidence.py."
    )
    reported_note = (
        "Operator-reported record from the Suricata IDS/IPS test session: source "
        f"{KALI_IP}, destination {TARGET_IP}, protocol ICMP, interface {IFACE}, "
        "Suricata 8.0.6 on Kali."
    )

    records = [
        # -- the two records the operator reported (action is authoritative) --
        record(
            timestamp="2026-09-28T18:04:11.482371+0000",
            flow_id=2148500913771,
            action="allowed",
            sid=IDS_SID,
            signature="LOCAL IDS TEST",
            severity=3,
            provenance="operator-reported",
            note=reported_note + " Detection-only rule: traffic was permitted.",
        ),
        record(
            timestamp="2026-09-28T18:05:03.221904+0000",
            flow_id=2148500913954,
            action="blocked",
            sid=IPS_SID,
            signature="LOCAL IPS TEST - ICMP BLOCKED",
            severity=1,
            provenance="operator-reported",
            note=reported_note
            + " Drop rule placed in the NFQUEUE path: the packet was blocked.",
        ),
        # -- generated-for-demo records (same session shape, clearly flagged) --
        record(timestamp="2026-09-28T18:05:41.609223+0000", flow_id=2148500914102,
               action="allowed", sid=IDS_SID, signature="LOCAL IDS TEST", severity=3,
               provenance="generated-for-demo", note=demo_note),
        record(timestamp="2026-09-28T18:06:01.845017+0000", flow_id=2148500914288,
               action="blocked", sid=IPS_SID, signature="LOCAL IPS TEST - ICMP BLOCKED",
               severity=1, provenance="generated-for-demo", note=demo_note),
        record(timestamp="2026-09-28T18:06:32.117640+0000", flow_id=2148500914471,
               action="allowed", sid=IDS_SID, signature="LOCAL IDS TEST", severity=3,
               provenance="generated-for-demo", note=demo_note),
        record(timestamp="2026-09-28T18:07:58.640553+0000", flow_id=2148500914918,
               action="blocked", sid=IPS_SID, signature="LOCAL IPS TEST - ICMP BLOCKED",
               severity=1, provenance="generated-for-demo", note=demo_note),
        record(timestamp="2026-09-28T18:08:15.334902+0000", flow_id=2148500915102,
               action="allowed", sid=IDS_SID, signature="LOCAL IDS TEST", severity=3,
               provenance="generated-for-demo", note=demo_note),
        record(timestamp="2026-09-28T18:09:44.905118+0000", flow_id=2148500915644,
               action="allowed", sid=IDS_SID, signature="LOCAL IDS TEST", severity=3,
               provenance="generated-for-demo", note=demo_note),
        record(timestamp="2026-09-28T18:10:12.771330+0000", flow_id=2148500915821,
               action="allowed", sid=IDS_SID, signature="LOCAL IDS TEST", severity=3,
               provenance="generated-for-demo", note=demo_note),
        record(timestamp="2026-09-28T18:11:03.559604+0000", flow_id=2148500916077,
               action="allowed", sid=IDS_SID, signature="LOCAL IDS TEST", severity=3,
               provenance="generated-for-demo", note=demo_note),
        record(timestamp="2026-09-28T18:11:39.412887+0000", flow_id=2148500916288,
               action="blocked", sid=IPS_SID, signature="LOCAL IPS TEST - ICMP BLOCKED",
               severity=1, provenance="generated-for-demo", note=demo_note),
        record(timestamp="2026-09-28T18:12:47.088245+0000", flow_id=2148500916703,
               action="allowed", sid=IDS_SID, signature="LOCAL IDS TEST", severity=3,
               provenance="generated-for-demo", note=demo_note),
    ]

    # A JSON-Lines file also tolerates comment objects; we add a header record
    # instead of a real comment so the file stays pure JSONL and Suricata-shaped.
    header = {
        "event_type": "sentinel.evidence.header",
        "sentinel_note": (
            "Historical baseline evidence for the SENTINEL SOC dashboard. Not live "
            "telemetry. Two records are operator-reported; the rest are generated "
            "for demo and flagged as such on every record."
        ),
        "source_environment": {
            "platform": "Kali Linux (VMware Workstation)",
            "interface": IFACE,
            "host_ip": KALI_IP,
            "suricata_version": SURICATA_VERSION,
            "wireshark_version": "4.6.6",
        },
        "rule_files": {"custom": "/etc/suricata/rules/local.rules"},
        "session_date": "2026-09-28",
        "validated_record_count": len(records),
    }
    return {"header": header, "records": records}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("data/historical/eve-alerts-history.json"),
        help="Destination JSON-Lines file",
    )
    args = parser.parse_args()

    payload = build()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as fh:
        fh.write(json.dumps(payload["header"]) + "\n")
        for item in payload["records"]:
            fh.write(json.dumps(item) + "\n")
    print(
        f"Wrote {len(payload['records'])} alert records (+1 header) to {args.out}\n"
        "  operator-reported:  2\n"
        "  generated-for-demo: 10\n"
        "Replace with real evidence: python3 tools/import_eve_evidence.py --help"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
