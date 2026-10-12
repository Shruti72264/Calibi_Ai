# 06 — Security-event data flow, end to end

## 1. The intended demonstration

```
 1. Authorised test traffic        ping -c 2 8.8.8.8        (Kali, eth0)
        │
 2. Suricata observes it           local.rules sid 1000001 / 1000002
        │
 3. Alert written to EVE           /var/log/suricata/eve.json  (JSON Lines)
        │
 4. FastAPI reads + parses         parser.read_events() → normalize_event()
        │                          • alert events only
        │                          • invalid lines skipped and counted
        │                          • action from alert.action / drop
        │                          • tail-window read (8 MB)
        │
 5. API serves a stable schema     GET /api/alerts | /api/stats | /api/health
        │
 6. React fetches and renders      typed client → hooks → page
        │
 7. Verdict displayed              allowed → green | blocked → red | unknown → amber
        │
 8. Analyst investigates           /investigation/<id>: timeline, correlation,
                                   raw EVE excerpt, verdict provenance
        │
 9. Response workflow              classify → recommend → (dry-run) → (enforce,
                                   allow-listed, local host only) → audit
```

## 2. Stage-by-stage contract

| # | Stage | Input | Output | Failure behaviour |
|---|-------|-------|--------|-------------------|
| 1 | Test traffic | Operator decision | ICMP / TCP probes | The operator is responsible for authorisation; the platform never generates traffic |
| 2 | Detection | Packets on `eth0` | Rule verdict | Rule not loaded → nothing happens, and that is visible as zero events rather than a false negative being hidden |
| 3 | Logging | Verdict | One JSON object per line | An empty file is reported as `empty`, never substituted |
| 4 | Parsing | EVE file | Normalised event dict | Truncated last line (file being written) skipped; malformed line skipped + counted; permission error reported with a fix |
| 5 | Serving | Event dicts | JSON + aggregations | Zero events → `total: 0` and an explanatory source state, `200` not `500` |
| 6 | Rendering | JSON | Table / cards / charts | Network error → red banner + the API's own message; last good snapshot kept and marked stale |
| 7 | Verdict | `action` field | Badge + label | Field absent → `unknown` with the reason surfaced in the UI |
| 8 | Investigation | `event_id` | Timeline + correlation | Unknown id → `404` with "logs rotate" guidance |
| 9 | Response | Analysed event | Audit entry (+ rule only if enforce) | Any policy violation → refusal, recorded in the audit log |

## 3. Why each design decision exists

**Tail-window read, not a full read.** A busy sensor's `eve.json` reaches
gigabytes. `SOC_LIVE_MAX_TAIL_BYTES` (8 MB default) keeps a dashboard poll cheap
and bounded. The cost — the partial first line after seeking — is handled
explicitly and counted as `lines_trailing_partial`.

**Deterministic `event_id`.** `sha1(source_file|flow_id|timestamp|event_type)[:16]`.
Analyst notes and triage state must attach to *the same* event across polls,
restarts and cache reloads, so the id cannot be a counter or a random value.

**Verdict provenance, not just a verdict.** `action_source` records *why* the
platform believes an event was blocked (`alert.action`, `event_type=drop`,
`flow.action`, `drop.reason`) or states that it does not know. This makes the
difference between evidence and inference auditable in the UI itself.

**Two sources, never merged silently.** Events from the live file and the
historical evidence file are concatenated but each keeps `source: live|historical`,
and the API reports per-source health separately. The dashboard banner and every
row badge are driven by that field, so mislabelling would require changing the
data rather than forgetting a UI string.

**Same-origin requests.** The browser calls `/api/...` on its own origin; the dev
server proxies to the API. No API host in the bundle, no CORS in the browser path,
and it works unchanged behind the sandbox preview.

**Polling, with visible freshness.** `lastUpdated` is rendered on every panel
("updated 4s ago"). The operator can always tell whether the screen is 4 seconds
or 4 minutes old — which is the actual requirement, not "is it websockets".

## 4. The Cisco plane is deliberately *not* in this flow

```text
Packet Tracer (.pkt)  ──X──▶  Kali eth0  ──▶  Suricata
      │                        ▲
      │                        └─ the capture path Suricata actually reads
      └──▶ CLI verification session ──▶ evidence pack (JSON) ──▶ dashboard
           (topology, OSPF, NAT, ACL tests, timestamps, sources)
```

Packet Tracer runs its own discrete-event simulation and does not emit frames onto
any host interface. There is therefore **no** configuration in this project that
makes simulated packets visible to Suricata, and the dashboard does not imply one:
the network pages are labelled *simulation evidence*, and the Cisco provider's
`disclosure` string says so on the page itself.

If a future version is required to bridge the two planes, the honest options are:

1. **GNS3 / CML / real hardware** with a real capture interface the sensor can
   see — then enable the live Cisco adapter (reachability probing today; read-only
   collection only after access is verified and secured).
2. **Replay**, not bridging: export a PCAP from the simulation and replay it
   through the sensor (`tcpreplay`) so Suricata genuinely processes those packets.
   Records produced this way must be labelled *replayed simulation*, because the
   traffic did not traverse the enterprise network.

Option 2 is the only way to connect the two planes without lying about it, and it
belongs in a future release rather than being faked in this one.
