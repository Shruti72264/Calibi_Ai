# 08 — Evidence collection and screenshots

Your submission needs visual evidence. This document is the capture plan: what to
photograph or screenshot, what each image must show to be worth anything, and how
to capture it on Windows (Packet Tracer) and Kali (terminal).

> **No screenshots are shipped in this repository.** The machine where the
> platform was built has no browser and no sensor, so any image claiming to be a
> running dashboard would be fabrication. Everything below is reproducible by you
> in about fifteen minutes — and your own screenshots are better evidence than
> mine anyway, because they show your topology and your hostnames.

---

## 1. Evidence inventory to produce

| ID | Image | Must visibly contain | Proves |
|----|-------|----------------------|--------|
| E-01 | Dashboard / Overview | The header banner (*"Showing historical evidence only"*), the source strip (`live 0` / `historical 12`), the severity and action donuts | The dashboard runs and separates the two data classes |
| E-02 | Dashboard / Alerts with a filter | Filter bar with `signature = IPS` typed in, 4 rows, each with a red **blocked** badge and a **Historical evidence** badge | Filtering works and the blocked events are real evidence |
| E-03 | Dashboard / Event Investigation | Timeline, verdict provenance (`alert.action`), raw EVE excerpt, response recommendation | The investigative view and the provenance claim |
| E-04 | Dashboard / IDS-IPS Monitoring | Sensor probe card (binary + service state), custom-rule registry, action split | Sensor state is measured, not assumed |
| E-05 | Dashboard / Network Topology | The three site bands, node stripes, and the *simulation evidence* disclosure | Cisco data is labelled as simulation evidence |
| E-06 | Dashboard / Routing & Firewall | An evidence card with result/source, and the VPN *NOT COMPLETED* card | Verified tests plus the documented limitation |
| E-07 | Dashboard / System Health | Per-source states, file facts (size/lines/modified), write-protection row | Empty/permission states are reported honestly |
| E-08 | Terminal: Suricata config validation | `sudo suricata -T …` and the "rules successfully loaded, 0 failed" line | The engine's rules load cleanly |
| E-09 | Terminal: IDS detection in EVE | `grep 1000001 eve.json \| python3 -m json.tool` showing `"action": "allowed"` | The IDS rule fired on real traffic |
| E-10 | Terminal: IPS block in EVE | `grep 1000002 …` showing `"action": "blocked"` | The IPS rule actually dropped a packet |
| E-11 | Terminal: `ping` with 100 % loss (IPS window) | The ping summary | Corroborating evidence for E-10 |
| E-12 | Terminal: revert proof | `iptables -L OUTPUT -n` with no NFQUEUE rule | The temporary IPS path was removed |
| E-13 | Wireshark | ICMP echo request/reply pair for the IDS test, and a request with no reply for the IPS test | Packet-level corroboration of both verdicts |
| E-14 | Packet Tracer | `show ip route` on R1 showing the OSPF route to 192.168.30.0/24, and `show access-lists` showing BLOCK_PC0 with match counters | The routing and ACL evidence |
| E-15 | Packet Tracer | A successful HTTP/HTTPS load of `www.securetech.local` from a client | The DNS/HTTP/HTTPS test |
| E-16 | Packet Tracer | `show ip interface brief` on R1 and R2 showing Serial0/3/0 up/up | The WAN verification |
| E-17 | Dashboard / API docs | `http://127.0.0.1:8000/docs` with the endpoint list expanded | The API is real and self-documenting |

## 2. How to capture

### Windows (Packet Tracer)
* `Win + Shift + S` (Snipping Tool) for a region, or `PrtScn` for the full screen.
* Crop to the CLI output — a full-desktop screenshot with a blurry CLI proves less.
* Save as PNG into `documentation/screenshots/` with the ID in the filename.

### Kali (terminal)
```bash
sudo apt install -y gnome-screenshot   # or use the desktop's PrtSc key
gnome-screenshot -a -f E-08-suricata-config-test.png

# Or capture text evidence, which is often more useful than a picture:
sudo suricata -T -c /etc/suricata/suricata.yaml 2>&1 | tee ~/project-evidence/E-08.txt
sudo grep 1000001 /var/log/suricata/eve.json | tail -1 | python3 -m json.tool | tee ~/project-evidence/E-09.txt
```

**Prefer text evidence where possible.** A `.txt` transcript can be diffed,
re-verified and pasted into a report; a screenshot cannot. Use images for the
dashboard (where layout matters) and text for CLI checks (where the exact bytes
matter).

### Dashboard
```bash
cd soc-suite
./start-demo.sh                 # API + dashboard
# open http://127.0.0.1:5173 and capture E-01 … E-07 and E-17
```
Set **Auto-refresh** to `Off` in the topbar while you capture, so a poll cannot
repaint the page mid-screenshot and make two images disagree about the totals.

## 3. Turning text evidence into repository evidence

```bash
cd soc-suite/backend

# Replace the labelled demo baseline with your real rotated logs:
python3 tools/import_eve_evidence.py \
    --source /var/log/suricata/eve.json.1.gz \
    --source /var/log/suricata/eve.json.2.gz \
    --out data/historical/eve-alerts-history.json \
    --label "Suricata IDS+IPS baseline session"

# Confirm every remaining record is genuine:
grep -c generated-for-demo data/historical/eve-alerts-history.json   # expect 0
```

Then re-run the API checks and paste the output into your report:

```bash
mkdir -p ~/project-evidence/api

curl -s localhost:8000/api/health  | python3 -m json.tool > ~/project-evidence/api/health.txt
curl -s localhost:8000/api/stats   | python3 -m json.tool > ~/project-evidence/api/stats.txt
curl -s localhost:8000/api/alerts?page_size=200 | python3 -m json.tool > ~/project-evidence/api/alerts.txt
curl -s localhost:8000/api/network/status | python3 -m json.tool > ~/project-evidence/api/network.txt
curl -s localhost:8000/api/system/status  | python3 -m json.tool > ~/project-evidence/api/system.txt

cd ~/soc-backend
./venv/bin/python tools/verify_setup.py        | tee ~/project-evidence/preflight.txt
./venv/bin/python -m pytest tests/ -q          | tee ~/project-evidence/tests.txt
cd ../soc-dashboard-ui && npm run typecheck    | tee ~/project-evidence/frontend-typecheck.txt
```

## 4. Honesty checklist before you submit

Run through this list; each line is something a careful examiner might check.

- [ ] Every dashboard image shows the source banner or per-row source badges —
      nobody can accuse you of presenting historical data as live.
- [ ] The live-event screenshot (if you produce one) is taken **after** starting
      Suricata, and the event carries a **Live** badge.
- [ ] No image shows a "blocked" claim that is not backed by an EVE record with
      `alert.action: "blocked"` (or `event_type: drop`).
- [ ] The VPN is described as **not completed** in the report, the evidence pack
      and the presentation.
- [ ] Any statement about Packet Tracer says *simulation evidence*, and the
      report states that simulated packets are not visible to Suricata.
- [ ] The report never says "the dashboard blocked an IP" unless an **executed**
      audit entry exists — a recommendation is not a block.
- [ ] The `.pkt` file is the original, unmodified topology.
- [ ] Rotated EVE logs in the repository contain nothing confidential beyond your
      lab addresses.

## 5. Suggested repository layout for the final submission

```
documentation/
├── screenshots/          E-01 … E-17 as PNG
├── transcripts/          E-08 … E-12 and the API outputs as .txt
├── REPORT.md             (or .docx / .pdf) — main written report
├── ARCHITECTURE.png      exported from docs/01 (or the ASCII diagram rendered)
└── TOPOLOGY.png          Packet Tracer topology screenshot with labels
```

`docs/10_DEMO_SCRIPT.md` gives you the spoken walkthrough that pairs with these
images; `docs/11_LINKEDIN_SUMMARY.md` gives you the written summary.
