# 04 — SENTINEL SOC dashboard (React + TypeScript + Vite)

**Name:** SENTINEL SOC — Network Security Operations Center
**Stack:** React 18 · TypeScript 5 (strict) · Vite 5 · React Router 6 · hand-rolled CSS + SVG charts (no chart library)
**Location:** `soc-suite/frontend` — mapping to your original target of `~/soc-dashboard-ui`

---

## 1. Run it

```bash
cd soc-suite/frontend
npm install
npm run dev          # → http://0.0.0.0:5173   (binds all interfaces on purpose)
```

| Script | What it does |
|--------|--------------|
| `npm run dev` | Dev server on `0.0.0.0:5173`, `/api` proxied to `VITE_PROXY_TARGET` (default `http://127.0.0.1:8000`) |
| `npm run typecheck` | `tsc --noEmit` — must stay clean |
| `npm run build` | Production bundle into `dist/` |
| `npm run preview` | Serve the built bundle on `0.0.0.0:4173` |

### Configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `VITE_PROXY_TARGET` | `http://127.0.0.1:8000` | Where the dev/preview server proxies `/api` |
| `VITE_API_BASE_URL` | *(empty)* | Only set this if the browser must call the API **directly** (different origin). Remember to add that origin to `SOC_CORS_ORIGINS`. |

Leaving `VITE_API_BASE_URL` empty is the recommended configuration: requests are
same-origin, so there is no CORS negotiation and no host baked into the bundle.

### Two config details you must not "clean up"

```ts
root: __dirname,                            // keeps Vite inside this project
css: { postcss: { plugins: [] } },          // stops PostCSS config discovery
```

This repository also contains an unrelated Next.js project with a
`postcss.config.js` that requires Tailwind. Without these two lines, Vite walks up
the directory tree, loads that config, and the dev server dies with
`Loading PostCSS Plugin failed: Cannot find module 'tailwindcss'`.

---

## 2. Pages

### A. Overview (`/`)
Total alerts, blocked, allowed, high severity, unknown verdicts, custom-rule hits,
distinct sources, triaged count · alert volume over time · severity donut ·
action donut · protocol bars · top signatures · top sources · top destinations ·
triage distribution · recent events · Cisco evidence summary · data-pipeline
status · a "how to read this dashboard" panel stating the labelling rules.

### B. Security Alerts (`/alerts`)
Server-side filtering (search, source IP, destination IP, signature, rule id,
protocol, severity chips, action chips, data source, time window), sortable
columns, pagination with page-size control, per-row **Raw** expander showing the
EVE excerpt and the verdict provenance, CSV export of the current page.

### C. Network Topology (`/topology`)
SVG diagram built from the evidence pack, grouped into site bands, with solid
lines for verified links and dashed for unverified. Node stripe colour = evidence
status. Clicking a device opens a detail drawer: interfaces, addresses, masks,
roles, services and the evidence ids that back each claim. Below: the addressing
plan, the link table, and the live-collection attempt with its honest result.

### D. Routing & Firewall (`/routing`)
One card per verified check (OSPF, DHCP, DNS/HTTP, ASA NAT, ACL, WAN), each
showing result, evidence source, expected vs observed and verification time —
printed as *"not recorded"* where the original session did not capture one.
A "what was actually proven" panel and a "known limitations" panel including the
unfinished VPN.

### E. IDS/IPS Monitoring (`/ids-ips`)
Live sensor probe (state, version, process count, EVE/fast/stats file facts, rule
files visible to the process), the custom-rule registry with the exact rule text,
action counts, the real custom-rule events table with per-row source labels, and
the full **safe enablement + isolated IPS test** procedure with its rules of
engagement.

### F. Event Investigation (`/investigation/:eventId`)
Event header, four key/value panels (detection, flow, sensor, provenance),
correlation timeline (focal vs correlated, with the correlation key shown),
verdict provenance with the raw EVE excerpt, payload when recorded, the rule-based
recommendation with its basis, the response workflow, analyst notes, and four
related-event lists (flow id, source, destination, signature).

### G. Response & Audit (`/response`)
Response-mode banner, safety envelope (capabilities + explicit out-of-scope
list), the submit form (in enforce mode it grows the confirmation checkbox and the
authorisation field), the rollback procedure, and the full audit trail with
per-entry rollback commands.

### H. System Health (`/system`)
Backend health, uptime, event counts, last refresh, write protection, audit store,
per-source cards with file facts (size, lines, invalid lines, modified, error),
file-level probes, Suricata probe, non-secret configuration dump, Cisco provider
summary, and a "how this dashboard fails" panel that documents the error
behaviour the UI actually implements.

---

## 3. Data-layer design

```
src/api/types.ts      TypeScript mirror of the Pydantic schemas
src/api/client.ts     fetch wrapper → typed ApiError(status, message, isNetworkError)
src/hooks/useApi.ts   { data, error, loading, lastUpdated, refreshing, refresh }
src/context/SocContext.tsx  app-wide polling cadence + time window + health/system
```

* **One** polling cadence for the whole app (Off / 5s / 15s / 30s / 1m), chosen in
  the topbar, so every page reports the same freshness.
* Polling pauses when the tab is hidden (`document.visibilityState`) — a
  dashboard left open in a background tab costs nothing.
* Every request is `AbortController`-cancelled on unmount; a superseded response
  cannot overwrite a newer one.
* The dashboard never re-aggregates: totals, distributions and pages come from
  the API, so the UI cannot silently diverge from what the API would return to
  `curl`.
* A failed poll keeps the last good payload and marks the header stale. There is
  no code path that presents cached data as current.

---

## 4. Design system

Tokens live in one place (`src/styles.css`, `:root`):

| Token | Value | Meaning |
|-------|-------|---------|
| `--ok` | `#22c55e` | healthy · allowed · verified |
| `--warn` | `#f59e0b` | warning · simulated · needs attention |
| `--danger` | `#ef4444` | blocked · high priority · unavailable |
| `--info` | `#38bdf8` | informational · live telemetry |
| `--accent` | `#3b82f6` | interactive elements |
| `--bg` / `--bg-panel` | `#070a10` / `#0d1420` | canvas / surfaces |

Rules followed throughout:

* Colour carries **meaning**, never decoration. Severity and action are the only
  things allowed to paint a row.
* No fake data, no decorative gauges, no animated counters. The only animation is
  a reduced-motion-aware skeleton for loading.
* Numbers are monospace and right-aligned; IPs, timestamps and ids are always
  monospace, because they get compared character by character during an incident.
* Unknown values render as `—` or as the literal word `unknown`; nothing
  plausible is invented to fill a cell.
* Desktop-first and responsive: the sidebar becomes a wrapping top nav below
  940 px, and grids collapse via `auto-fit` rather than hand-written breakpoints.

Charts are plain SVG (donut, bars, sparkline-with-blocked-markers) so the bundle
stays small and every pixel is auditable.

---

## 5. State and accessibility

* No global store: server state lives in the hooks, UI state (filters, expanded
  row, selection) lives in the page that owns it.
* Interactive diagram nodes are `role="button"` with `tabIndex` and an
  `onKeyDown` Enter handler.
* Loading regions use `aria-busy` / `aria-live`; form inputs are explicitly
  labelled; charts carry `role="img"` with an `aria-label`.
* Colour is never the only signal: severity and action are always rendered as
  text as well as colour.

---

## 6. Verifying the frontend against the API

```bash
# 1. the API is up and honest
curl -s localhost:8000/api/health | python3 -m json.tool | head -20

# 2. the browser's own path works (through the Vite proxy)
curl -s localhost:5173/api/stats | python3 -m json.tool | head -20

# 3. typecheck before you commit
npm run typecheck

# 4. production build
npm run build && ls -la dist/
```

Expected, on a machine with no sensor: `counts_by_source.live = 0`, the header
banner reads *"Showing historical evidence only"*, and the 12 historical events
render with their `Historical evidence` badges. If you ever see the number 12 with
no badges and no banner, something has been relabelled — stop and investigate.
