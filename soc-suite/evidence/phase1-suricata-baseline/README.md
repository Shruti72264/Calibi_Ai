# Evidence — Phase 1 Suricata baseline

This folder mirrors the baseline evidence set from the sensor work so the
repository can document and test against it. **Three of these files are
transcriptions of results you reported, not fresh captures.** Each one says so in
its own header, and each one tells you the exact command that replaces it.

| File | Status | Replace with |
|------|--------|--------------|
| `local.rules` | Reproduces your two custom rules verbatim | `sudo cp /etc/suricata/rules/local.rules .` |
| `config-test.txt` | Transcription of your reported `suricata -T` result (52,987 rules loaded, 0 failed) | `sudo suricata -T -c /etc/suricata/suricata.yaml 2>&1 \| tee config-test.txt` |
| `system-state.txt` | Transcription of your reported service/log state (unit inactive, `eve.json` and `fast.log` empty, test events in rotated logs) | the command block inside the file |
| `eve-alerts-history.json` | **Built by this project.** 2 operator-reported records + 10 flagged generated-for-demo records so the dashboard is demonstrable at 12 records | `python3 backend/tools/import_eve_evidence.py --source <your rotated logs> …` |
| `fast-alerts-history.log` | Not included — see below | `sudo zgrep -h 'LOCAL' /var/log/suricata/fast.log.*.gz > fast-alerts-history.log` |
| `suricata.yaml` | Not included — see below | `sudo cp /etc/suricata/suricata.yaml .` |

## Why some files are deliberately absent

`suricata.yaml` and `fast-alerts-history.log` are not reproduced here because
inventing them would add nothing: `suricata.yaml` on Suricata 8.x is ~1,700 lines
of upstream defaults, and the `fast.log` lines are a strict subset of the EVE
records already present in `eve-alerts-history.json`. Copy them across from your
own evidence folder — the API does not need either file.

## The one file that matters most

`../backend/data/historical/eve-alerts-history.json` is the file the dashboard
actually reads. It ships with:

* **2 operator-reported records** — `LOCAL IDS TEST` (sid 1000001, `allowed`) and
  `LOCAL IPS TEST - ICMP BLOCKED` (sid 1000002, `blocked`), source
  `192.168.61.129`, destination `8.8.8.8`, protocol ICMP, interface `eth0`.
* **10 records marked `"sentinel_provenance": "generated-for-demo"`** — present so
  the UI, the correlation logic and the pagination can be exercised with a
  realistic 12-record dataset, matching the record count you validated.

One command replaces the whole file with your genuine rotated logs:

```bash
cd soc-suite/backend
python3 tools/import_eve_evidence.py \
    --source /var/log/suricata/eve.json.1.gz \
    --source /var/log/suricata/eve.json.2.gz \
    --out data/historical/eve-alerts-history.json \
    --dry-run          # drop --dry-run to write it
```

After importing, `grep -c generated-for-demo data/historical/eve-alerts-history.json`
returns 0 and every row in the dashboard is real evidence. The UI badge changes on
its own, because the badge follows the data rather than a hard-coded label.

## Privacy note

The evidence in this folder contains lab-only addressing (`192.168.61.129`,
`8.8.8.8`, `192.168.0.0/16`, and the documentation ranges `203.0.113.0/24` /
`203.0.114.0/24`). Before publishing a repository publicly, check the rotated
logs for anything else you captured — an ICMP probe can pick up unrelated
traffic if the sensor was ever run in promiscuous mode on a shared network.
