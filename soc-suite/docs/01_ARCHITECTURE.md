# 01 — Architecture

## 1. The problem this architecture solves

Building a "SOC dashboard" for a student lab runs into an uncomfortable fact:
the enterprise network is a **simulation** (Cisco Packet Tracer), while the
detection tooling is **real** (Kali + Suricata + Wireshark). Packet Tracer
executes an independent simulation — its frames never reach the Kali host's NIC,
so Suricata cannot see them.

Two dishonest shortcuts are available at that point, and this project rejects
both:

1. **Fake the session** — feed the dashboard sample/synthetic alerts so the
   numbers look healthy. Rejected: the dashboard would be worthless as evidence.
2. **Pretend the simulation is the sensor** — relabel Packet Tracer "events" as
   detections. Rejected: it would collapse the distinction the project is
   supposed to demonstrate.

Instead the architecture carries **three evidence planes** that never blend:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ PLANE A — LIVE SENSOR TELEMETRY                    (real, current, volatile) │
│                                                                              │
│   Kali Linux (VMware)                                                        │
│   ┌──────────────────┐   packet   ┌─────────────────────┐   writes          │
│   │ eth0 192.168.61.x│──────────▶│ Suricata 8.0.6      │──────────▶ /var/log │
│   │ test traffic     │           │ IDS re: local.rules │            /suricata│
│   └──────────────────┘           │ IPS: NFQUEUE path   │            /eve.json│
│                                  └─────────────────────┘                     │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │ tail-read (8 MB window, never the whole file)
┌────────────────────────────────────▼─────────────────────────────────────────┐
│ PLANE B — HISTORICAL BASELINE EVIDENCE          (real, recorded, immutable)  │
│                                                                              │
│   eve-alerts-history.json  ── imported from the sensor's rotated logs        │
│   (keeps original timestamps; labelled "Historical evidence" on every row)   │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼─────────────────────────────────────────┐
│ PLANE C — CISCO SIMULATION EVIDENCE                (real capture of a sim)    │
│                                                                              │
│   Packet Tracer topology (.pkt)  ── CLI verification session ──▶ evidence    │
│   Head Office / Branch / ASA / ISP / Internet server          pack (JSON)    │
│   Used for topology + routing/firewall pages. No live interface state.       │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │
              ┌──────────────────────▼───────────────────────┐
              │  FastAPI service  (soc-suite/backend)        │
              │  • parser.py        EVE → stable schema      │
              │  • datasource.py    live ‖ historical, caches │
              │  • providers/cisco  evidence pack ‖ live stub │
              │  • audit.py         SQLite: notes + audit     │
              │  • response/actions classify → recommend →    │
              │                     dry-run → enforce         │
              └──────────────────────┬───────────────────────┘
                                     │ REST/JSON (same-origin via Vite proxy)
              ┌──────────────────────▼───────────────────────┐
              │  SENTINEL SOC dashboard (React + TS + Vite)  │
              │  8 pages · typed client mirrored from Pydantic│
              │  every row carries its evidence class        │
              └──────────────────────────────────────────────┘
```

## 2. Component responsibilities

| Component | Owns | Explicitly does **not** own |
|-----------|------|-----------------------------|
| `parser.py` | Reading JSON Lines safely, normalising to one stable schema, inferring `action` only from EVE fields | Deciding policy, filtering, or inventing missing values |
| `datasource.py` | Reading both sources, per-source health, TTL cache, de-duplication | Blending sources into one unlabelled stream |
| `providers/cisco.py` | Loading the evidence pack, optional TCP reachability probe | Writing to devices, or claiming telemetry it does not have |
| `suricata_status.py` | Read-only host/sensor probes (`--version`, `systemctl is-active`, file facts) | Starting, stopping, reloading or configuring Suricata |
| `audit.py` | Analyst notes, triage state, append-only audit trail | Judging whether an action is safe |
| `response/actions.py` | Classification, recommendation, dry-run rendering, allow-listed local enforcement, rate limiting | Any remote device, any arbitrary command, any non-allow-listed target |
| `main.py` | HTTP contract, validation, status codes, CORS, error envelope | Business logic (delegated), filesystem paths from user input (never) |

## 3. Why the frontend talks through a proxy

```
Browser ──GET /api/alerts──▶ Vite dev server ──proxy──▶ FastAPI :8000
        (same origin)         :5173
```

* No API host is baked into the bundle, so the same build runs locally, on a LAN
  and behind the sandbox preview.
* No CORS negotiation in the browser during development; CORS is still configured
  for the direct-access case.
* The preview environment proxies the dev server, so browser-facing code never
  calls `localhost` to reach the backend — a requirement of a proxied preview.

`VITE_API_BASE_URL` overrides this when the API genuinely lives elsewhere, and
that origin must then be added to `SOC_CORS_ORIGINS`.

## 4. Trust boundaries

| Boundary | Crossing it requires |
|----------|---------------------|
| Read event data | Nothing — the API is read-only by default |
| Write analyst notes / triage | `SOC_API_KEY` + `SOC_ALLOW_WRITES=true` + `X-API-Key` header (fail-closed) |
| Change local firewall | The above **and** `SOC_RESPONSE_MODE=enforce` **and** an allow-listed target **and** `confirm=true` **and** a recorded authorisation statement **and** being under the hourly action limit |
| Change a Cisco device | Not possible from this codebase — no device credentials, no write path |
| Read a file the operator did not configure | Not possible — no endpoint accepts a path |

## 5. Failure behaviour (designed, not assumed)

| Failure | Behaviour |
|---------|-----------|
| `eve.json` missing / empty / unreadable | Source reports `missing` / `empty` / `unreadable` with the OS reason; live count is 0; banner explains; **no substitution** |
| Truncated final line (file being written) | Skipped and counted, never raises |
| Malformed JSON line | Skipped, counted, reported next to the file name |
| Windows-1252 bytes in a payload | Read with `errors="replace"`; parsing continues |
| Huge live file (GB) | Only the last `SOC_LIVE_MAX_TAIL_BYTES` is read; the partial first line is discarded |
| Backend down | Topbar red banner with the API's own error text; last-good snapshot retained and clearly marked stale |
| Unknown event id | `404` with an explanation that EVE logs rotate |
| Write disabled | `403` with the exact env vars to enable it |
| Missing evidence pack | Network pages show the parse error, not an empty-but-plausible topology |

## 6. Deliberate non-choices

* **No WebSockets/SSE in v1.** Polling with a visible "updated Ns ago" and a
  refresh control is easier to reason about, easier to test, and honest about
  freshness. `docs/09` notes where streaming would be added.
* **No alerting integrations** (email/Slack). Out of scope for a lab and easy to
  demo badly.
* **No external database.** SQLite (WAL) for analyst state and audit is
  sufficient, has zero operational cost, and keeps the project self-contained.
* **No live Cisco telemetry.** Packet Tracer devices do not serve SSH/SNMP; the
  adapter is present and reports its own inability rather than synthesising data.
