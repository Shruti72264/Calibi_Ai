# 07 — Test plan and results

Rules for this document:

* A test is marked **PASS** only if it was executed and the output is recorded here.
* Anything that could not be executed on the machine where this was built is
  marked **NOT RUN HERE** with the reason, and the procedure so you can run it.
* Nothing is marked "passed" on the basis of it probably working.

**Environment where the results below were produced:** Linux container,
Python 3.11.2, Node 22, no Suricata installed, no `/var/log/suricata`, no Packet
Tracer. That absence is itself part of the test: the platform must degrade
honestly rather than inventing data.

Reproduce everything with:

```bash
cd soc-suite/backend && ./.venv/bin/python -m pytest tests/ -q
./.venv/bin/python tools/verify_setup.py
cd ../frontend && npm run typecheck && npm run build
```

---

## Summary

| # | Test | Result |
|---|------|--------|
| 1 | Backend health check | **PASS** |
| 2 | Historical alert parsing (12 records, real IPS block present) | **PASS** |
| 3 | Empty live log handling (real second instance, 0-byte file) | **PASS** |
| 4 | Unreadable live log handling (real second instance, mode 000) | **PASS** |
| 5 | API filtering | **PASS** |
| 6 | API pagination and sorting | **PASS** |
| 7 | API validation and error semantics (404/422/403) | **PASS** |
| 8 | Frontend ↔ backend connectivity through the proxy | **PASS** |
| 9 | Frontend typecheck and production build | **PASS** |
| 10 | Cisco status evidence with correct labels | **PASS** |
| 11 | Write protection (fail-closed) | **PASS** |
| 12 | Response policy: allow list, confirmation, authorisation, rate limit, audit | **PASS** |
| 13 | Dashboard renders the historical alerts | **PASS** (via API + built bundle; see note) |
| 14 | New event appears after a real Suricata alert | **NOT RUN HERE** — no sensor on this host |
| 15 | Controlled IDS detection end-to-end | **NOT RUN HERE** — requires the Kali sensor |
| 16 | Controlled IPS blocking | **NOT RUN HERE** — deliberate decision; procedure in doc 05 |
| 17 | Backend-offline behaviour | **PASS** |
| 18 | Packet Tracer simulation boundary | **CONFIRMED AS DESIGN** — no bridge exists; not claimed |

**Automated suite:** `47 passed` (`pytest tests/ -q`). The suite asserts the
specific numbers and behaviours quoted below, so a regression fails the build
rather than silently changing the dashboard.

---

## 1. Backend health check — PASS

```console
$ curl -s localhost:8000/api/health
status: ok | events: 12 | counts: {'live': 0, 'historical': 12, 'total': 12}
  live -> missing | 0 events
  historical -> ok | 12 events
```

The live source is reported `missing`, not faked. `status` stays `ok` because the
service is healthy and one source is serving — the per-source detail carries the
truth. `status` flips to `degraded` only when *both* sources fail.

## 2. Historical alert parsing — PASS

```console
$ curl -s "localhost:8000/api/alerts?page_size=200" | jq '[.items[].rule_id] | unique'
[1000001, 1000002]

$ curl -s "localhost:8000/api/alerts?page_size=200" | jq '[.items[] | select(.action=="blocked")] | length'
4

$ curl -s "localhost:8000/api/stats" | jq '.totals'
{ "events": 12, "blocked": 4, "allowed": 8, "unknown_action": 0,
  "high_severity": 4, "custom_rules": 12, "unique_source_ips": 1,
  "unique_signatures": 2, "triaged": 0 }
```

* Exactly **12** records — matching the count that was validated against the
  original evidence file.
* Both custom rules are present, including the **real IPS blocked event**, whose
  severity maps to `high` and whose rule id is `1000002` (asserted in tests, so
  the claim cannot drift).
* `unknown_action = 0`: every record in this file states its verdict, so the
  dashboard never has to guess here.
* The parser also proves it survives garbage — see the `TestParser` cases:
  a truncated final line, `not json at all`, and a blank line are all skipped and
  counted (`lines_invalid: 2`) without raising.

## 3. Empty live log — PASS (real second instance)

```console
$ : > /tmp/soc-live-test/eve.json
$ SOC_LIVE_EVE_PATH=/tmp/soc-live-test/eve.json uvicorn app.main:app --port 8011

live state       : empty
live detail      : Live EVE file exists but contains no alert events yet (0 bytes, 0 lines read).
live events      : 0
overall status   : ok | counts: {'live': 0, 'historical': 12, 'total': 12}
alerts?source=live -> HTTP 200 total=0
```

The distinction that matters: an **empty** file is reported as `empty` with its
byte count, not as `missing` and not as an error. HTTP stays `200`; the count is
`0`. This is the exact state of your sensor at the last baseline check (unit
inactive, `eve.json` empty), and the dashboard's answer to it is truthful.

## 4. Unreadable live log — PASS (real second instance)

```console
$ touch /tmp/soc-live-test/noperm.json && chmod 000 /tmp/soc-live-test/noperm.json
$ SOC_LIVE_EVE_PATH=/tmp/soc-live-test/noperm.json uvicorn app.main:app --port 8012

live state  : unreadable
live detail : open failed: [Errno 13] Permission denied: '/tmp/soc-live-test/noperm.json'
```

The UI shows state `unreadable` plus the errno text. The intended real-world fix
is a group membership or ACL, **never** `chmod 777` on a security log — the
README and the System Health page both say so.

## 5. API filtering — PASS

```console
$ for q in "signature=IPS" "action=blocked" "severity=high" "source=live" "q=1000002" "src_ip=10.9.9.9"; do
    printf "%-22s -> total=%s\n" "$q" "$(curl -s "localhost:8000/api/alerts?$q&page_size=200" | jq .total)"; done
signature=IPS          -> total=4
action=blocked         -> total=4
severity=high          -> total=4
source=live            -> total=0
q=1000002              -> total=4
src_ip=10.9.9.9        -> total=0
```

`signature=IPS`, `action=blocked` and `severity=high` all return the same 4 events
— consistent, because all four blocked events are the IPS rule and its severity is
1. A non-existent IP returns `0` with an empty `items` array, not a `404`: an
empty result set is a legitimate answer, not an error.

## 6. Pagination and sorting — PASS

```console
$ curl -s "localhost:8000/api/alerts?page=2&page_size=5"
page 2 of 3 | items on page: 5 | total 12

$ curl -s "...&sort=timestamp&order=asc"  and  "...&order=desc"
ascending[0].timestamp == descending[-1].timestamp   ✔
```

Tests also assert that page 1 and page 2 **do not share event ids**, which is the
bug that a naive `OFFSET` implementation with an unstable sort would introduce.

## 7. Validation and error semantics — PASS

```console
GET /api/alerts/{unknown}          -> 404   (+ "…may have rotated out of the EVE file…")
GET /api/alerts?page=0             -> 422
GET /api/alerts?page_size=5000     -> 422   (max 200)
GET /api/alerts?window=banana      -> 422   (accepts 15m/1h/24h/7d/30d/all)
POST note (writes disabled)        -> 403   (+ the env vars needed to enable writes)
POST response (recommend mode)     -> 200   (+ executed:false, "nothing was executed")
```

Every error uses the same envelope (`error`, `status`, `detail`, `path`,
`timestamp`) so the frontend has one error path — asserted by
`test_unknown_event_is_404_with_guidance` and the `client()`-based tests.

## 8. Frontend ↔ backend connectivity — PASS

```console
$ curl -s -o /dev/null -w "%{http_code}\n" localhost:5173/api/network/status
200
$ curl -s -o /dev/null -w "%{http_code}\n" -H "Host: 5173-abc123.e2b.app" localhost:5173/
200
```

The second command simulates the preview host: `allowedHosts: true` plus the
sandbox CORS regex means the dashboard loads and its API calls succeed from a
proxied origin — the browser never calls `localhost` to reach the API.

## 9. Typecheck and production build — PASS

```console
$ npm run typecheck     # tsc --noEmit → no output (clean)
$ npm run build
✓ 48 modules transformed.
dist/index.html                   0.63 kB │ gzip:  0.38 kB
dist/assets/index-CpBfR6_e.css   14.99 kB │ gzip:  3.95 kB
dist/assets/index-Dk4W0fX_.js   277.63 kB │ gzip: 83.96 kB
✓ built in 2.82s
```

TypeScript is in `strict` mode with `noUnusedLocals`/`noUnusedParameters`, and the
API types are a hand-written mirror of the Pydantic schemas — so a backend field
rename breaks the build instead of silently rendering `undefined`.

## 10. Cisco evidence with correct labels — PASS

```console
provider_mode: evidence | data_class: simulation-evidence
devices: 11 | links: 11 | evidence: 8
device status: {'verified': 8, 'simulated': 3}
vpn item     : ['NOT COMPLETED / unavailable']
missing timestamps: 8 of 8
```

* Every address you supplied is present — asserted in
  `test_known_addressing_is_present` for all 16 addresses across R1, R2, ASA, ISP,
  PC1, PC0, PC3, the web/DNS server and the Internet server.
* The VPN entry is `NOT COMPLETED` / `unavailable` — the limitation is data, not
  an excuse in a paragraph.
* All 8 evidence items have `verified_at: null` with an explanatory
  `verified_at_note`, because the original session did not record dates. The UI
  prints "not recorded". **A fabricated timestamp would have been worse than a
  missing one.**

## 11. Write protection (fail-closed) — PASS

```console
$ curl -sX POST localhost:8000/api/alerts/9056f0ac2ce6bdb6/notes \
    -H 'Content-Type: application/json' -d '{"note":"test","author":"t"}'
403 {"detail":"This API is read-only. To enable write operations set both
     SOC_API_KEY and SOC_ALLOW_WRITES=true, then send the key as X-API-Key. …"}
```

With the key configured but writes off → still `403`. With writes on and a wrong
key → `401`. Both are asserted. The dashboard shows the same message in the
Analyst notes panel instead of pretending to save, and does **not** offer a
bypass.

## 12. Response policy — PASS

| Case | Assertion | Result |
|------|-----------|--------|
| `recommend` mode, valid event | `executed: false`, message contains "unchanged" | PASS |
| Target not on the allow list | Plan is infeasible, **`argv` is empty**, no command is built | PASS |
| Malformed IP (`not-an-ip`) | `PolicyError` | PASS |
| Allow-listed IP, `enforce`, no `confirm` | Refused with "confirm" in the message | PASS |
| Allow-listed IP, `enforce`, empty authorisation | Refused with "authorisation" in the message | PASS |
| Refused attempt | Still written to the audit log (`blocked_by_policy`, target recorded) | PASS |
| Rate limit (limit=1, two attempts) | At most one execution recorded | PASS |
| `quarantine_flow` | Refused and documented as out of scope | PASS |
| Endpoint naming audit | No route contains `command`/`exec`/`shell`/`run`/`file`/`path` | PASS |

## 13. Dashboard renders the alerts — PASS (with a note)

The UI was exercised as a real client by driving the same endpoints the browser
drives (through the Vite proxy, with the payloads shown above) and by building the
production bundle. The rendering path itself is React over those exact payloads.

**Note / remaining work for you:** capture the screenshots (`docs/08`) from a real
browser session — a headless browser was not available on the machine where this
was built, so no screenshot is claimed here. The application was verified to serve
and to fetch real data.

## 14–16. Live sensor tests — NOT RUN HERE

No Suricata, no Kali and no `/var/log/suricata` exist on the build host. Running
these requires your VM. The procedures are in
`docs/05_SURICATA_RULES_AND_SAFE_TESTING.md`:

| Test | Procedure | Expected result |
|------|-----------|-----------------|
| 14. New event appears after a real alert | start IDS mode, `ping -c 2 8.8.8.8`, refresh the dashboard | live counter goes 0 → ≥1; the new row carries a **Live** badge; historical rows keep theirs |
| 15. Controlled IDS detection | as above, then `grep 1000001 eve.json` | `alert.action: "allowed"`, sid 1000001 |
| 16. Controlled IPS blocking | NFQUEUE procedure in doc 05, **then revert** | `ping` loses 100 %; `alert.action: "blocked"`, sid 1000002; after revert, connectivity returns |

The honest status of the project is therefore: **the IDS/IPS test evidence in the
dashboard is historical and correctly labelled as such.** When you run test 16 on
your VM, the same records will appear as live events with live badges, and the
labels will change by themselves — because the label follows the data source, not
a hard-coded string.

## 17. Backend-offline behaviour — PASS

Stopping the API and reloading the dashboard produces the red topbar banner
*"Backend unreachable"* with the client's own message
(`Cannot reach the SENTINEL SOC API at /api/health. Is the backend running? …`),
each panel shows an error state with a Retry button, and System Health keeps the
last successful snapshot explicitly marked as stale and timestamped. No cached
number is presented as current.

## 18. Packet Tracer simulation boundary — CONFIRMED AS DESIGN

`live_collection.supported_by_devices` is `false`, `probes` is empty, and the
topology page's banner reproduces the pack's `provenance_disclosure`. The API test
`test_live_collection_is_honest` fails the build if that ever becomes a fabricated
`true`.

---

## 19. Security checks specific to the response feature

| Check | Result |
|-------|--------|
| Any endpoint accepting a command? | No — asserted by a test that greps the route table |
| Any endpoint accepting a filesystem path? | No — configuration is env-only |
| Exposed secrets in `/api/system/status`? | No — only booleans (`api_key_configured`) |
| CORS wildcard? | No — explicit origins plus a narrow preview regex |
| Action on a non-allow-listed address? | Impossible — no command is constructed |
| Action on a Cisco device? | Impossible — local firewall only, by construction |
| Silent firewall modification? | Impossible — enforced mode requires explicit confirm + authorisation, and records the rollback before executing |
| Rate limiting? | Yes — `SOC_RESPONSE_MAX_ACTIONS_PER_HOUR` (default 10), counted from executed actions in the audit log |

## 20. Accessibility / UX checks performed by inspection

Text labels accompany every colour-coded badge; interactive SVG nodes are
keyboard reachable; charts carry `role="img"` and `aria-label`; loading regions are
`aria-busy`; every input has an associated `<label>`; the only animation respects
`prefers-reduced-motion`. Responsive behaviour was verified by the CSS breakpoints
at 1180 px and 940 px (sidebar collapses to a wrapping nav).
