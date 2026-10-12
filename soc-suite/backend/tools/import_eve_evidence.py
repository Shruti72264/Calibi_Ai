#!/usr/bin/env python3
"""
Import your real Suricata evidence into the dashboard's historical baseline.

Run this ON THE KALI VM (or anywhere the logs are readable). It reads your real
rotated EVE log(s), keeps only genuine alert records, and writes a JSON-Lines
baseline that the dashboard labels as HISTORICAL EVIDENCE.

It is read-only with respect to your logs and never fabricates a record: if a
file has no alert events, the output says so.

Examples
--------
  # From the compressed rotations that hold the earlier IDS/IPS test events:
  sudo python3 tools/import_eve_evidence.py \
      --source /var/log/suricata/eve.json.1.gz \
      --source /var/log/suricata/eve.json.2.gz \
      --out data/historical/eve-alerts-history.json \
      --label "Suricata baseline session (rotated logs)"

  # Straight from your existing evidence folder:
  python3 tools/import_eve_evidence.py \
      --source ~/project-evidence/phase1-suricata-baseline/eve-alerts-history.json \
      --out data/historical/eve-alerts-history.json

Then copy the result to the machine running the API, or point the API at it:
  SOC_HISTORICAL_EVE_PATHS=/path/to/eve-alerts-history.json
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ALERT_EVENT_TYPES = {"alert", "drop", "ips"}


def iter_records(path: Path):
    """Yield (record, error) pairs from a plain or gzipped JSON-Lines file."""
    opener = gzip.open if path.suffix == ".gz" else open
    try:
        with opener(path, "rt", encoding="utf-8", errors="replace") as fh:
            for number, line in enumerate(fh, start=1):
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError as exc:
                    yield None, f"{path.name}:{number}: invalid JSON ({exc.msg})"
                    continue
                if not isinstance(obj, dict):
                    yield None, f"{path.name}:{number}: not a JSON object"
                    continue
                yield obj, None
    except (OSError, EOFError) as exc:
        yield None, f"{path.name}: could not be read ({exc})"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", action="append", required=True, type=Path,
                        help="EVE JSON / JSON-Lines / .gz file (repeatable)")
    parser.add_argument("--out", type=Path, default=Path("data/historical/eve-alerts-history.json"))
    parser.add_argument("--label", default="Imported Suricata evidence",
                        help="Human-readable label shown in the dashboard")
    parser.add_argument("--include-non-alert", action="store_true",
                        help="Keep flow/dns/http records too (default: alerts only)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Report what would be written without writing it")
    args = parser.parse_args()

    kept: list[dict] = []
    stats: dict[str, dict] = {}
    warnings: list[str] = []

    for source in args.source:
        if not source.exists():
            warnings.append(f"{source}: NOT FOUND")
            continue
        s = stats.setdefault(str(source), {"total": 0, "alerts": 0, "invalid": 0})
        for record, error in iter_records(source):
            if error:
                s["invalid"] += 1
                warnings.append(error)
                continue
            s["total"] += 1
            event_type = str(record.get("event_type") or "").lower()
            if not args.include_non_alert and event_type not in ALERT_EVENT_TYPES:
                continue
            if event_type in {"sentinel.evidence.header"}:
                continue
            s["alerts"] += 1
            record["sentinel_provenance"] = "operator-evidence"
            kept.append(record)

    # Newest last keeps the file append-friendly and human-readable.
    kept.sort(key=lambda r: str(r.get("timestamp") or ""))

    header = {
        "event_type": "sentinel.evidence.header",
        "sentinel_note": (
            "Imported from real Suricata EVE logs. These are HISTORICAL records: they were "
            "written by the sensor at the timestamps shown, and are not live telemetry."
        ),
        "label": args.label,
        "imported_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sources": [str(p) for p in args.source],
        "validated_record_count": len(kept),
        "per_source": stats,
    }

    print(f"records kept : {len(kept)}")
    for name, s in stats.items():
        print(f"  {name}: {s['alerts']} alert(s) of {s['total']} line(s), {s['invalid']} invalid")
    if warnings:
        print(f"warnings ({len(warnings)}):")
        for warning in warnings[:20]:
            print(f"  - {warning}")

    if not kept:
        print(
            "\nNOTHING IMPORTED. No alert records were found in the supplied file(s).\n"
            "Double-check with:  zgrep -c 'event_type\":\"alert' <file>\n"
            "The previous baseline has NOT been overwritten.",
            file=sys.stderr,
        )
        return 2

    if args.dry_run:
        print(f"\nDry run: would write {len(kept)} record(s) to {args.out}")
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as fh:
        fh.write(json.dumps(header) + "\n")
        for record in kept:
            fh.write(json.dumps(record) + "\n")
    print(f"\nWrote {args.out}")
    print("Next: set SOC_HISTORICAL_EVE_PATHS to this path (or copy it to the API host).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
