# 03 — Backend API reference

* **Service:** SENTINEL SOC API
* **Base URL (dev):** `http://127.0.0.1:8000` · **through the dashboard:** `/api/...` (proxied)
* **Interactive docs:** `http://127.0.0.1:8000/docs` (Swagger UI) · `/redoc` · `/openapi.json`
* **Content type:** `application/json`

---

## 1. Endpoint map

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET | `/` | Service banner + endpoint list | none |
| GET | `/api/health` | Process + data-source health | none |
| GET | `/api/alerts` | Filtered, sorted, paginated event list | none |
| GET | `/api/alerts/{event_id}` | One event + correlation + timeline + notes + recommendation | none |
| GET | `/api/stats` | Aggregates and distributions | none |
| GET | `/api/network/status` | Cisco topology, links, evidence | none |
| GET | `/api/system/status` | Backend, config, files, sensor probes, providers | none |
| GET | `/api/suricata/status` | Sensor probe on its own | none |
| GET | `/api/audit` | Audit trail (+ `?event_id=` filter) | none |
| GET | `/api/response/status` | Response mode, allow list, envelope | none |
| POST | `/api/alerts/{event_id}/notes` | Record an analyst note / triage status | **key + opt-in** |
| POST | `/api/alerts/{event_id}/status` | Triage status only | **key + opt-in** |
| POST | `/api/response/actions` | Controlled response workflow | depends on mode |
| POST | `/api/system/reload-data` | Cache-busting re-read of the EVE files | **key + opt-in** |

> **No endpoint accepts a filesystem path, a filename, a command or a shell
> fragment.** All paths come from environment variables read once at startup.

---

## 2. `GET /api/health`

Always `200` while the process is serving; `status` tells the dashboard whether
the data behind it is healthy.

```json
{
  "status": "ok",
  "service": "SENTINEL SOC API",
  "version": "1.0.0",
  "env": "development",
  "uptime_seconds": 25.0,
  "server_time": "2026-10-12T06:58:49.226805Z",
  "data_sources": [
    {
      "source": "live",
      "enabled": true,
      "state": "missing",
      "detail": "Live EVE file not found at /var/log/suricata/eve.json. Suricata may not be running, or SOC_LIVE_EVE_PATH needs to point at the real log.",
      "configured_paths": ["/var/log/suricata/eve.json"],
      "events_available": 0,
      "files": [
        { "path": "/var/log/suricata/eve.json", "exists": false, "readable": false,
          "size_bytes": 0, "modified_at": null, "lines_total": 0,
          "lines_invalid": 0, "lines_trailing_partial": 0, "error": "file not found" }
      ]
    },
    {
      "source": "historical",
      "enabled": true,
      "state": "ok",
      "detail": "12 historical baseline event(s) loaded from 1 evidence file(s). Label these as recorded baseline evidence, not live traffic.",
      "configured_paths": ["…/data/historical/eve-alerts-history.json"],
      "events_available": 12,
      "files": [{ "path": "…", "exists": true, "readable": true, "size_bytes": 8801,
                  "modified_at": "2026-10-12T06:53:00Z", "lines_total": 13,
                  "lines_invalid": 0, "error": null }]
    }
  ],
  "events_available": 12,
  "counts_by_source": { "live": 0, "historical": 12, "total": 12 },
  "cache_age_seconds": 1.2,
  "reads_ok": true
}
```

`state` vocabulary: `ok` · `empty` · `missing` · `unreadable` · `disabled` · `error`.

`?force=true` bypasses the TTL cache and re-reads the files.

---

## 3. `GET /api/alerts`

### Query parameters

| Parameter | Type | Notes |
|-----------|------|-------|
| `q` | string ≤200 | Free text across signature, IPs, protocol, action, severity, category, rule id, event type, source, app proto |
| `src_ip`, `dest_ip` | string ≤64 | Exact match |
| `signature` | string ≤200 | Case-insensitive substring |
| `severity` | repeatable | `high` · `medium` · `low` · `unknown` |
| `action` | repeatable | `allowed` · `blocked` · `unknown` |
| `proto` | string ≤16 | `ICMP`, `TCP`, `UDP`… |
| `source` | enum | `all` *(default)* · `live` · `historical` |
| `rule_id` | string ≤32 | Exact, e.g. `1000002` |
| `event_type` | string ≤32 | `alert` · `drop` · `ips` |
| `since`, `until` | ISO-8601 | Inclusive bounds |
| `window` | string | `15m` · `1h` · `24h` · `7d` · `30d` · `all` |
| `sort` | enum | `timestamp` *(default)* · `severity` · `signature` · `src_ip` · `dest_ip` · `action` · `proto` · `source` |
| `order` | enum | `desc` *(default)* · `asc` |
| `page` | int ≥1 | default `1` |
| `page_size` | int 1–200 | default `25` |

### Response (trimmed real output)

```json
{
  "items": [
    {
      "event_id": "9056f0ac2ce6bdb6",
      "source": "historical",
      "source_file": "…/data/historical/eve-alerts-history.json",
      "event_kind": "suricata-eve",
      "timestamp": "2026-09-28T18:12:47.088245Z",
      "timestamp_raw": "2026-09-28T18:12:47.088245+0000",
      "flow_id": 2148500916703,
      "event_type": "alert",
      "src_ip": "192.168.61.129",
      "src_port": null,
      "dest_ip": "8.8.8.8",
      "dest_port": null,
      "proto": "ICMP",
      "app_proto": null,
      "signature": "LOCAL IDS TEST",
      "rule_id": 1000001,
      "gid": 1,
      "rev": 1,
      "category": "Misc activity",
      "severity": "low",
      "action": "allowed",
      "action_source": "alert.action",
      "action_raw": "allowed",
      "host": "kali",
      "interface": null,
      "is_custom_rule": true,
      "raw_excerpt": { "event_type": "alert", "timestamp": "2026-09-28T18:12:47.088245+0000",
                       "flow_id": 2148500916703, "in_iface": "eth0",
                       "src_ip": "192.168.61.129", "dest_ip": "8.8.8.8" },
      "analyst_status": "new",
      "analyst_note_count": 0
    }
  ],
  "total": 12, "page": 1, "page_size": 2, "pages": 6,
  "sort": "timestamp", "order": "desc",
  "counts_by_source": { "live": 0, "historical": 12, "returned": 2 },
  "applied_filters": { "source": "all", "…": "…" },
  "generated_at": "2026-10-12T07:00:13.156413Z"
}
```

### Two schema guarantees worth memorising

**a. `action` is never guessed.** It comes only from `alert.action`, an
`event_type` of `drop`/`ips`, or a `drop`/`flow.action` block. Otherwise:

```json
{ "action": "unknown", "action_source": "not recorded in the EVE event" }
```

`action_source` is shown in the UI so an analyst can see *why* a verdict is
claimed — it is the difference between evidence and inference.

**b. `event_id` is deterministic**, derived from `source_file|flow_id|timestamp|event_type`
(SHA-1, first 16 hex chars). The same event keeps the same id across polls and
restarts, which is what allows analyst notes and triage state to stick to it.

### Examples

```bash
# The real IPS drop events
curl -s "localhost:8000/api/alerts?signature=IPS&page_size=5" | python3 -m json.tool

# Everything the sensor blocked, highest severity first
curl -s "localhost:8000/api/alerts?action=blocked&sort=severity&order=asc" | python3 -m json.tool

# One rule id, second page
curl -s "localhost:8000/api/alerts?rule_id=1000001&page=2&page_size=5" | python3 -m json.tool

# Live only — legitimately empty when no sensor is attached
curl -s "localhost:8000/api/alerts?source=live" | python3 -m json.tool

# Free text
curl -s "localhost:8000/api/alerts?q=192.168.61.129" | python3 -m json.tool
```

---

## 4. `GET /api/alerts/{event_id}`

`200` → the event plus everything an analyst needs in one round trip:

```json
{
  "event":  { "…": "the same object as in the list response" },
  "related": {
    "by_flow_id": [],
    "by_source_ip": [ "…other events from 192.168.61.129…" ],
    "by_destination_ip": [ "…" ],
    "by_signature": [ "…" ]
  },
  "timeline": [
    { "timestamp": "2026-09-28T18:04:11.482371Z", "kind": "correlated",
      "label": "alert - LOCAL IDS TEST",
      "detail": "192.168.61.129:None -> 8.8.8.8:None [allowed]",
      "event_id": "…", "correlation": "flow_id" },
    { "timestamp": "2026-09-28T18:08:15.334902Z", "kind": "focal",
      "label": "alert - LOCAL IDS TEST",
      "detail": "Recorded action: allowed (basis: alert.action)",
      "event_id": "…", "correlation": "this event" }
  ],
  "notes": [
    { "id": 1, "event_id": "…", "created_at": "…", "author": "soc-analyst",
      "note": "Confirmed against the sensor session log.", "status": "investigating" }
  ],
  "response_recommendation": {
    "category": "policy-test / ICMP probe",
    "technique": "T1018 / T1095 (host/network discovery)",
    "priority": "P3",
    "recommendation": "Detection-only rule fired and traffic was permitted. …",
    "suggested_action": "block_source_ip",
    "basis": { "signature": "LOCAL IDS TEST", "rule_id": 1000001, "protocol": "ICMP",
               "severity": "low", "recorded_action": "allowed",
               "action_source": "alert.action", "custom_rule": true }
  }
}
```

**404** when the id is unknown, with guidance instead of silence:

```json
{ "error": true, "status": 404,
  "detail": "No event with id 'deadbeefdeadbeef' in the current live+historical window. It may have rotated out of the EVE file, or the id may be stale.",
  "path": "/api/alerts/deadbeefdeadbeef", "timestamp": "…" }
```

---

## 5. `GET /api/stats`

```json
{
  "generated_at": "…",
  "window": { "requested": "all", "source_filter": "all", "since": null,
              "bucket": "minute", "events_considered": 12 },
  "totals": { "events": 12, "blocked": 4, "allowed": 8, "unknown_action": 0,
              "high_severity": 4, "custom_rules": 12, "unique_source_ips": 1,
              "unique_signatures": 2, "triaged": 0 },
  "counts_by_source": { "live": 0, "historical": 12 },
  "severity_distribution": [ { "key": "low", "count": 8, "percent": 66.67 },
                             { "key": "high", "count": 4, "percent": 33.33 } ],
  "protocol_distribution": [ { "key": "ICMP", "count": 12, "percent": 100.0 } ],
  "action_distribution":   [ { "key": "allowed", "count": 8, "percent": 66.67 },
                             { "key": "blocked", "count": 4, "percent": 33.33 } ],
  "event_type_distribution": [ { "key": "alert", "count": 12, "percent": 100.0 } ],
  "top_signatures": [ { "key": "LOCAL IDS TEST", "count": 8, "percent": 66.67 },
                      { "key": "LOCAL IPS TEST - ICMP BLOCKED", "count": 4, "percent": 33.33 } ],
  "top_source_ips": [ { "key": "192.168.61.129", "count": 12, "percent": 100.0 } ],
  "top_destination_ips": [ { "key": "8.8.8.8", "count": 12, "percent": 100.0 } ],
  "timeline": [ { "bucket": "2026-09-28T18:04:00Z", "total": 1, "blocked": 0, "allowed": 1, "unknown": 0 } ],
  "custom_rule_events": 12,
  "analyst_status_distribution": [ { "key": "false_positive", "count": 0, "percent": 0.0 } ]
}
```

`window.bucket` is chosen from the data (`minute` ≤6 h span, `hour` by default,
`day` beyond 14 days) so the chart never renders 4,000 points.

---

## 6. `GET /api/network/status`

See `docs/02_CISCO_TOPOLOGY.md` for the domain content. Shape:

```json
{
  "provider": "cisco-packet-tracer",
  "provider_mode": "evidence",
  "data_class": "simulation-evidence",
  "disclosure": "Every device, address and link below comes from the operator's own Packet Tracer configuration…",
  "evidence_pack": { "available": true, "pack_id": "cisco-pt-headoffice-branch-v1",
                     "generated_at": null, "generated_at_note": "Fill this in with the date of your Packet Tracer evidence session…",
                     "addressing_plan": [ { "segment": "Head Office - employee LAN",
                                            "cidr": "192.168.10.0/24", "note": "DHCP served by R1" } ] },
  "sites":   [ { "id": "head-office", "name": "Head Office", "role": "…" } ],
  "devices": [ { "id": "r1", "name": "R1 (Head Office Edge Router)", "kind": "router",
                 "site": "head-office", "tier": "core", "evidence_status": "verified",
                 "addresses": [ { "interface": "GigabitEthernet0/0", "ip": "192.168.10.1",
                                  "mask": "255.255.255.0", "role": "Employee LAN gateway" } ],
                 "services": ["OSPF", "DHCP server", "NAT/PAT (to ASA)", "ACL: BLOCK_PC0"],
                 "evidence_refs": ["EV-001", "EV-002", "EV-004", "EV-005", "EV-006"] } ],
  "links":   [ { "id": "L11", "a": "r1", "b": "r2", "medium": "serial",
                 "status": "verified", "addresses": ["10.10.10.1/30", "10.10.10.2/30"] } ],
  "evidence": [ { "id": "EV-005", "area": "acl", "title": "Router ACL BLOCK_PC0 …",
                  "result": "PASS", "verified_at": null, "status": "verified",
                  "source": "R1 CLI (show access-lists) + client test" } ],
  "live_collection": { "enabled": false, "supported_by_devices": false,
                       "adapter": "cisco-live-reachability", "probes": [],
                       "note": "Live Cisco collection is disabled. The dashboard is showing verified Packet Tracer evidence only. …" }
}
```

Status codes: `200` always while the service runs; if the pack is missing the
payload reports `evidence_pack.available=false` plus the parse error, and the UI
renders that error instead of an empty topology.

---

## 7. `GET /api/system/status` and `/api/suricata/status`

```json
{
  "backend": {
    "service": "SENTINEL SOC API", "version": "1.0.0", "env": "development",
    "uptime_seconds": 412.3, "server_time": "…",
    "write_protection": { "writes_enabled": false, "api_key_configured": false, "allow_writes": false },
    "audit_store": { "available": true, "path": "data/audit/soc-audit.sqlite3",
                     "notes": 0, "audit_entries": 0, "error": null }
  },
  "config": { "env": "development", "live_enabled": true,
              "live_eve_path": "/var/log/suricata/eve.json",
              "historical_eve_paths": ["…"], "response_mode": "recommend",
              "response_allowlist_size": 0, "writes_enabled": false,
              "cisco_live_enabled": false, "systemctl_probe": true },
  "suricata": {
    "checked_at": "…", "checked": true,
    "note": "Suricata binary not found on this host. Running the API on a different machine than the sensor? …",
    "version": null, "binary_present": false, "binary_path": null,
    "service_state": "unknown", "service_probe": "",
    "process_count": 0,
    "eve_file": { "path": "/var/log/suricata/eve.json", "exists": false, "readable": false,
                  "size_bytes": null, "modified_at": null, "age_seconds": null, "error": "file not found" },
    "fast_log": { "…": "…" }, "stats_log": { "…": "…" },
    "rule_files_visible": [],
    "interpretation": "No EVE log at the configured path."
  },
  "data_sources": [ "…health-shaped objects…" ],
  "files": [ { "source": "live", "path": "…", "exists": false, "readable": false,
               "size_bytes": null, "modified_at": null, "error": "file not found" } ],
  "cisco": { "provider_mode": "evidence", "data_class": "simulation-evidence",
             "evidence_pack_available": true, "devices_total": 11, "links_total": 11,
             "devices_by_evidence_status": { "verified": 8, "simulated": 3 },
             "evidence_items": 8, "live_collection": { "…": "…" } },
  "response": { "mode": "recommend", "allowlist": [], "allowlist_configured": false,
                "local_firewall_backend": "none detected", "max_actions_per_hour": 10,
                "recent_executed_actions": 0,
                "capabilities": [ "…" ], "explicitly_out_of_scope": [ "…" ] }
}
```

`service_state` distinguishes `active` · `inactive` · `failed` · `unknown` ·
`active (process detected, no systemd probe)` — it never reports a state it did
not measure.

---

## 8. Write endpoints

### `POST /api/alerts/{event_id}/notes`

Requires `SOC_API_KEY` **and** `SOC_ALLOW_WRITES=true`; send the key as `X-API-Key`.

```bash
curl -sX POST localhost:8000/api/alerts/9056f0ac2ce6bdb6/notes \
  -H 'Content-Type: application/json' -H "X-API-Key: $SOC_API_KEY" \
  -d '{"note":"Confirmed against the sensor session log.","author":"soc-analyst","status":"investigating"}'
```

```json
{
  "note": { "id": 1, "event_id": "9056f0ac2ce6bdb6", "created_at": "…",
            "author": "soc-analyst", "note": "Confirmed against the sensor session log.",
            "status": "investigating" },
  "network_state_changed": false,
  "disclosure": "Recording analyst state. No device or firewall configuration was modified."
}
```

`403` when writes are off (with instructions), `401` when the key is missing or
wrong, `404` for an unknown event, `422` for an invalid status.

### `POST /api/response/actions`

```bash
curl -sX POST localhost:8000/api/response/actions \
  -H 'Content-Type: application/json' \
  -d '{"event_id":"9056f0ac2ce6bdb6","action_type":"block_source_ip",
       "target_ip":"192.168.61.129","reason":"Analyst review of a recorded detection"}'
```

Default (`recommend`) mode response:

```json
{
  "accepted": true, "executed": false, "mode": "recommend",
  "action_type": "block_source_ip", "target_ip": "192.168.61.129",
  "event_id": "9056f0ac2ce6bdb6", "audit_id": 2,
  "plan": { "feasible": false, "summary": "Append DROP for source 192.168.61.129 to local chain SENTINEL_SOC",
            "blockers": ["192.168.61.129 is not in SOC_RESPONSE_ALLOWLIST. Arbitrary addresses are never acted on …",
                         "no local firewall tool (iptables/nft/ufw) found on this host - nothing to execute"],
            "warnings": ["The rule is applied to THIS host only. It does not touch the Cisco ASA, routers, Packet Tracer or any remote device."],
            "executor": "none (recommendation only)",
            "command_preview": null, "rollback_preview": null },
  "message": "Recommendation recorded. Nothing was executed - the platform is in 'recommend' mode, so no firewall state changed anywhere. Network state on any Cisco device or remote host is unchanged.",
  "warnings": []
}
```

`422` when the request is unenforceable, for example:

```json
{ "error": true, "status": 422,
  "detail": "192.168.61.129 is not in SOC_RESPONSE_ALLOWLIST. Arbitrary addresses are never acted on - add the lab host explicitly if you intend to manage it." }
```

### `GET /api/audit`

```bash
curl -s "localhost:8000/api/audit?limit=20" | python3 -m json.tool
curl -s "localhost:8000/api/audit?event_id=9056f0ac2ce6bdb6" | python3 -m json.tool
```

Every attempt is recorded — `recommended`, `planned`, `dry_run`, `refused`,
`rejected`, `blocked_by_policy`, `rate_limited`, `executed`, `failed` — and every
planned record carries its `rollback` command.

---

## 9. Status codes and error envelope

| Code | When |
|------|------|
| `200` | Normal read |
| `201` | Note created |
| `401` | Write endpoint called without/with a wrong `X-API-Key` |
| `403` | Write endpoint called while `SOC_ALLOW_WRITES` is off |
| `404` | Unknown `event_id` |
| `422` | Invalid query parameter value, invalid status, or an unenforceable response action |
| `500` | Internal error — logged, generic message, **no partial data** |

All errors share one envelope, so the frontend has a single code path:

```json
{ "error": true, "status": 403, "detail": "…", "path": "/api/…", "timestamp": "…" }
```

---

## 10. Security controls implemented

| Control | Implementation |
|---------|----------------|
| No arbitrary file access | Paths come from env vars only; no endpoint takes a path |
| No arbitrary command execution | `subprocess` with argv lists and `shell=False`; no user string is interpolated |
| Write protection | `SOC_API_KEY` **and** `SOC_ALLOW_WRITES=true`; `403`/`401` otherwise |
| Least privilege | The API is designed to run as an unprivileged user with read access to `eve.json` (group/ACL, not world-readable) |
| Constrained CORS | Explicit dev origins + a narrow preview regex — never `*` |
| Bounded input | Every parameter has a max length / enum / numeric bound |
| Bounded output | `page_size ≤ 200`, live tail ≤ 8 MB, ≤ 2,000 live / ≤ 5,000 historical records |
| Safe response actions | Allow list, confirmation + authorisation, rate limit, local host only, rollback recorded |
| No secret leakage | `/api/system/status` exposes whether a key is configured, never the key |
| Auditable actions | Append-only SQLite audit with reasons and results |
