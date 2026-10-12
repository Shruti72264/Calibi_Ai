# SENTINEL SOC — Network Security Operations Center

**Project:** *Design and Implementation of a Network Intrusion Detection and
Automated Response System using Secure Enterprise Networking.*

An integrated SOC platform that puts three things in one place, and is explicit
about which is which:

| Evidence plane | What it is | What it is **not** |
|----------------|-----------|--------------------|
| **Live sensor telemetry** | Suricata EVE JSON alerts read from the sensor's real log file, right now | never simulated, never cached-over |
| **Historical baseline evidence** | Recorded IDS/IPS test events replayed from an evidence file, with their original timestamps | never presented as current traffic |
| **Cisco network evidence** | Verified Packet Tracer CLI/test results, stored as a timestamped evidence pack | never presented as live device telemetry |

That separation is the core design decision of the project. A SOC dashboard is
only worth trusting if it is honest about what it does *not* know.

---

## 1. What is in this folder

```
soc-suite/
├── README.md                     ← you are here
├── start-demo.sh                 one command to run API + dashboard
├── backend/                      FastAPI service (canonical backend)
│   ├── app/
│   │   ├── main.py               routes, validation, error envelope
│   │   ├── settings.py           every env var, safe defaults
│   │   ├── datasource.py         live vs historical sources, cached reads
│   │   ├── parser.py             Suricata EVE → stable event schema
│   │   ├── schemas.py            Pydantic contract
│   │   ├── suricata_status.py    read-only sensor/host probes
│   │   ├── audit.py              SQLite audit + analyst notes
│   │   ├── providers/cisco.py    Packet Tracer evidence provider (+ live stub)
│   │   └── response/actions.py   classify → recommend → dry-run → enforce
│   ├── data/
│   │   ├── historical/           the baseline EVE evidence file
│   │   └── cisco/                the verified network evidence pack
│   ├── tests/test_api.py         47 tests, all passing
│   ├── tools/
│   │   ├── verify_setup.py       pre-flight check (run this first)
│   │   ├── import_eve_evidence.py  import YOUR rotated logs
│   │   └── make_demo_history.py  regenerate the labelled demo baseline
│   ├── run-backend.sh
│   └── .env.example              documented configuration
├── frontend/                     React + TypeScript + Vite dashboard
│   ├── src/pages/                Overview, Alerts, Investigation, Topology,
│   │                             Routing & Firewall, IDS/IPS, Response & Audit,
│   │                             System Health
│   ├── src/components/           layout + design-system components
│   ├── src/api/                  typed API client mirroring the Pydantic schemas
│   ├── src/context/              one polling cadence, one time window, app-wide
│   ├── vite.config.ts            binds 0.0.0.0, proxies /api to the backend
│   └── run-frontend.sh
├── docs/                         01…13 — architecture through LinkedIn summary
└── evidence/phase1-suricata-baseline/   baseline evidence + provenance headers
```

---

## 2. Quick start (this machine / any Linux box)

```bash
cd soc-suite

# Option A — one command, both processes, logs in ./logs
./start-demo.sh

# Option B — two terminals
cd backend  && ./run-backend.sh          # or: ./run-backend.sh --no-reload
cd frontend && ./run-frontend.sh
```

Then open **http://127.0.0.1:5173** for the dashboard and
**http://127.0.0.1:8000/docs** for the API documentation.

First run creates `backend/.venv`, installs Python dependencies and
`npm install`s the frontend. Nothing in the startup path touches Suricata,
iptables or any network device.

### What you will see immediately

The dashboard loads with **12 historical evidence events** (2 of them real,
operator-reported records: the `allowed` IDS detection and the `blocked` IPS
drop) and **0 live events**, because there is no sensor on this machine. That is
the correct, honest state — and the header banner says so in words:

> *Showing historical evidence only. The live EVE file has no alerts right now
> (`missing`), so every event below is a recorded test event, not current traffic.*

Every row carries a **Live** or **Historical evidence** badge. There is no code
path that can relabel one as the other.

---

## 3. Connecting it to your own environment

Full instructions: **`docs/12_INTEGRATION_ON_YOUR_MACHINE.md`**. The short version:

```bash
# 1. put the baseline backend where you want it (your ~/soc-backend)
mv ~/soc-backend ~/soc-backend-backup-$(date +%F)     # keep the original
cp -r soc-suite/backend ~/soc-backend
cd ~/soc-backend && python3 -m venv venv && . venv/bin/activate
pip install -r requirements.txt

# 2. point it at the real sensor logs
export SOC_LIVE_EVE_PATH=/var/log/suricata/eve.json
export SOC_HISTORICAL_EVE_PATHS=~/project-evidence/phase1-suricata-baseline/eve-alerts-history.json

# 3. pre-flight, then run
python tools/verify_setup.py
uvicorn app.main:app --host 0.0.0.0 --port 8000

# 4. dashboard
cp -r soc-suite/frontend ~/soc-dashboard-ui
cd ~/soc-dashboard-ui && npm install && npm run dev
```

If the API runs as a different user than Suricata writes `eve.json` as, add the
service account to the `suricata` group (`sudo usermod -aG suricata $USER`) rather
than chmod-ing the log world-readable, and never run the API as root:

```bash
sudo setfacl -m u:socapi:r /var/log/suricata/eve.json     # preferred
```

---

## 4. The 12 acceptance criteria, and where each one is satisfied

| # | Requirement | Where it lives | Status in this workspace |
|---|-------------|----------------|--------------------------|
| 1 | Existing Packet Tracer network preserved | `data/cisco/network_evidence.json` (your addressing, verbatim) | Preserved as a data pack; the `.pkt` file is untouched and stays on your machine |
| 2 | Suricata IDS + IPS evidence preserved | `evidence/…`, and the 2 real records in the historical baseline | Preserved and displayed |
| 3 | FastAPI backend kept and extended | `backend/` (canonical location, not duplicated) | Implemented; 47/47 tests pass |
| 4 | React + TypeScript + Vite dashboard | `frontend/` | Implemented, typechecks clean, builds |
| 5 | Real historical events with correct labels | Overview / Alerts / IDS-IPS pages | 12 records, source-labelled, verdicts from the EVE data |
| 6 | Filters, sorting, pagination | `pages/Alerts.tsx` ↔ `GET /api/alerts` | Server-side; covered by tests |
| 7 | Network topology with honest labels | `pages/Topology.tsx` ↔ `GET /api/network/status` | 11 devices, 11 links, per-item evidence status |
| 8 | Routing/firewall evidence | `pages/RoutingFirewall.tsx` | 8 evidence items incl. the documented VPN limitation |
| 9 | IDS/IPS monitoring | `pages/IdsIps.tsx` | Real service probe + the safe enablement procedure |
| 10 | Controlled response + audit | `pages/ResponseAudit.tsx`, `app/response/actions.py` | Recommend/dry-run/enforce, allow-list, rate limit, rollback, audit |
| 11 | Test plan with real results | `docs/07_TEST_PLAN.md` | Executed; failures honestly documented |
| 12 | Docs, diagram, demo script, LinkedIn summary | `docs/` | 13 documents |

---

## 5. What I could and could not verify here

This is the section to read before you quote anything as tested.

**Verified in this workspace, by execution:**

* Backend imports, starts and serves on `0.0.0.0:8000`; `/docs` renders.
* All 47 backend tests pass (`pytest tests/ -q` → `47 passed`).
* The historical evidence file parses to exactly **12 events, 4 blocked,
  8 allowed**, rule ids 1000001/1000002, severity high for the drops.
* Filters, sorting, pagination, 404s, 422 validation and the write-protection
  403s all behave as documented (asserted in tests).
* The Cisco evidence pack loads: **11 devices, 11 links, 8 evidence items**, and
  every address you supplied is present (asserted in tests).
* The frontend typechecks clean and serves through the Vite proxy; a request to
  `/api/health` from the dashboard origin returns real JSON, including with a
  preview-style `Host` header.
* `tools/verify_setup.py` reports ready, with the live source correctly reported
  as `missing` on a machine that has no sensor.

**Not verified here, because it is not physically present:**

* Suricata itself, Kali, VMware, your `.pkt` topology, and your real rotated EVE
  logs. There is no Suricata binary and no `/var/log/suricata` on this machine,
  so the sensor probes honestly report *not found* instead of a green tick.
* Anything about your live devices. Packet Tracer exposes no management plane to
  a dashboard like this one, and no live collector was configured.
* IPS blocking end-to-end. That is a deliberate test you run yourself with the
  procedure in `docs/05_SURICATA_RULES_AND_SAFE_TESTING.md`.

**Known limitation, stated honestly:** a site-to-site VPN was attempted and not
completed because of Packet Tracer device/image feature limits. It is recorded as
`NOT COMPLETED` in the evidence pack and rendered as a documented limitation —
not papered over with an untested configuration.

---

## 6. Safety posture of the response feature

The automated-response component is built so that the dangerous version is not
reachable by accident.

| Mode | `SOC_RESPONSE_MODE` | Effect |
|------|--------------------|--------|
| Recommend | `recommend` *(default)* | Classifies the event, records a recommendation. **Executes nothing.** |
| Dry run | `dry_run` | Full validation plus the exact command that *would* run. **Executes nothing.** |
| Enforce | `enforce` | Executes one firewall rule, on **this host only**, only for allow-listed targets, only with `confirm=true` + a recorded authorisation statement, rate-limited per hour. |

Guarantees enforced in code (and covered by tests):

* There is **no endpoint that accepts a command, a path or a filename.**
  `subprocess` is called with an argv list and `shell=False`; nothing from a
  request is ever interpolated into a command.
* An IP that is not on `SOC_RESPONSE_ALLOWLIST` **cannot** produce an executable
  plan — the engine returns blockers and refuses to build the command.
* Cisco devices, the ASA, routers and Packet Tracer are **out of scope by
  construction**: enforcement only ever touches the local host's firewall.
* Every attempt — including every refusal — is written to the audit log with its
  reason, and every planned action records its rollback command *before*
  execution.
* A response mode of `enforce` with an empty allow list is structurally
  incapable of doing anything.

---

## 7. Everyday commands

```bash
cd soc-suite/backend

./.venv/bin/python tools/verify_setup.py                  # pre-flight: is everything wired up?
./.venv/bin/python -m pytest tests/ -q                    # 47 tests
./.venv/bin/python tools/import_eve_evidence.py --help    # import your real logs
./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000

curl -s localhost:8000/api/health       | python3 -m json.tool
curl -s localhost:8000/api/stats        | python3 -m json.tool
curl -s "localhost:8000/api/alerts?signature=IPS&page_size=5" | python3 -m json.tool
curl -s localhost:8000/api/network/status | python3 -m json.tool
curl -s localhost:8000/api/system/status  | python3 -m json.tool

cd ../frontend
npm run typecheck        # tsc --noEmit
npm run build            # production bundle in dist/
npm run dev              # http://0.0.0.0:5173
```

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Banner: *Backend unreachable* | API not started, or wrong port | `cd backend && ./run-backend.sh`; check `VITE_PROXY_TARGET` |
| Zero live events, but the sensor is running | Suricata writes to a different path, or no alert has fired yet | `sudo ls -l /var/log/suricata/`; set `SOC_LIVE_EVE_PATH`; generate one authorised test detection |
| Live source state is `unreadable` | The API user cannot read `eve.json` | `sudo usermod -aG suricata <api-user>`, or `setfacl -m u:<api-user>:r /var/log/suricata/eve.json` — do not chmod 777 |
| Live source state is `empty` | The file exists with 0 bytes: no alert since Suricata last started | This is a real answer, not a bug. Check the rotated logs for the earlier test events |
| Historical source state is `missing` | The evidence file is not where `SOC_HISTORICAL_EVE_PATHS` points | Import it with `tools/import_eve_evidence.py`, or fix the env var |
| `413`/timeouts on a huge EVE file | A multi-gigabyte live log | The API only tails the last `SOC_LIVE_MAX_TAIL_BYTES` (8 MB default) — lower it if needed |
| Notes and actions return `403` | Write protection is on by default | Set `SOC_API_KEY` **and** `SOC_ALLOW_WRITES=true`, then reload the UI |
| `Loading PostCSS Plugin failed: tailwindcss` | Vite walked up into an unrelated project's config | Already fixed in `vite.config.ts` (`css.postcss` empty + pinned `root`); keep those lines |
| Port 5173 already in use | Another dev server | `npm run dev -- --port 5174` and add that origin to `SOC_CORS_ORIGINS` |

---

## 9. Documentation index

| Doc | Contents |
|-----|----------|
| `docs/01_ARCHITECTURE.md` | Components, trust boundaries, why the data classes are separated |
| `docs/02_CISCO_TOPOLOGY.md` | Every device, interface, address, link and the test that proves it |
| `docs/03_BACKEND_API.md` | Full API reference with curl examples and status codes |
| `docs/04_FRONTEND.md` | Dashboard setup, page-by-page guide, design tokens |
| `docs/05_SURICATA_RULES_AND_SAFE_TESTING.md` | Rules, safe IDS enablement, isolated IPS test, revert procedure |
| `docs/06_DATA_FLOW.md` | Event lifecycle from packet to pixel, with failure modes |
| `docs/07_TEST_PLAN.md` | 12 test categories, actual results, what could not be tested |
| `docs/08_EVIDENCE_AND_SCREENSHOTS.md` | Evidence capture and how to take the screenshots for the report |
| `docs/09_LIMITATIONS.md` | Packet Tracer telemetry, VPN, single-host sensor, and the rest |
| `docs/10_DEMO_SCRIPT.md` | A 6-minute interview demonstration script, with the questions it answers |
| `docs/11_LINKEDIN_SUMMARY.md` | Short, medium and long project summaries |
| `docs/12_INTEGRATION_ON_YOUR_MACHINE.md` | Step-by-step deployment onto your Kali VM and Windows host |
| `docs/13_LEARNING_MODULES.md` | Linux permissions/processes, troubleshooting commands, Wireshark, BGP, proxy, VPN |
