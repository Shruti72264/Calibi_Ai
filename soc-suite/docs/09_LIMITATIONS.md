# 09 — Limitations, stated honestly

Every project has boundaries. Stating them precisely is what separates an
engineering submission from a marketing page — and in a security role, "what this
does not cover" is the question a hiring manager actually asks.

---

## 1. Packet Tracer telemetry (the big one)

**Limitation.** Cisco Packet Tracer runs a discrete-event *simulation*. Its
devices do not serve SSH/SNMP/Telnet management to an external collector, and its
frames are never placed on a host interface. Consequently:

* No live interface counters, uptime, CPU or port state can be collected.
* **Simulated packets are not visible to Suricata or Wireshark on the Kali host.**
  There is no bridge in this project, and this project does not claim one.

**What the dashboard does instead.** It renders a *verified evidence pack*: the
operator's own CLI outputs and test results, each labelled `verified`,
`simulated`, `unknown` or `unavailable`, with the evidence source and (where
recorded) the verification time. Every device card says where the claim came from.

**How to remove the limitation, honestly.**

1. **Real capture path** — GNS3/CML/real hardware with an interface the sensor can
   see, then use the live adapter (already present, currently reachability-only).
2. **Replay, not bridging** — export a PCAP from the simulation and replay it
   through the sensor with `tcpreplay`. Records must then be labelled *replayed
   simulation*, because the traffic never traversed the enterprise network. This
   is the only truthful way to connect the two planes.
3. **Do not** feed the dashboard synthetic "Cisco alerts". That would make every
   number on the screen unverifiable.

## 2. Site-to-site VPN not completed

**Limitation.** A VPN build was attempted and abandoned because the Packet Tracer
device models/images available do not support the required IPsec features for a
site-to-site tunnel.

**How it is represented.** Evidence item `EV-007`, `result: NOT COMPLETED`,
`status: unavailable`, surfaced as a red card on *Routing & Firewall*. It is never
counted as a pass, and no untested configuration is pasted into the report as if
it had been applied.

**What to say in an interview.** "VPN was scoped and attempted; Packet Tracer's
ASA image does not support site-to-site IPsec, so it is documented as not
completed. The design is in the report: IKEv2, pre-shared key, the 10.0.0.0/30
transit as the peer, and protected prefixes 192.168.10.0/23 and 192.168.30.0/24. It
would need real hardware or CML to implement." That answer is stronger than a
half-verified tunnel.

## 3. IPS verification depends on the queue path

The `drop` rule (sid 1000002) had its effect **only** while the temporary NFQUEUE
rule existed. That rule was removed after testing, so today the drop rule is
loaded but inert. This is correct and safe, but it means:

* "The rule is loaded" ≠ "the rule is blocking". The dashboard's IDS/IPS page
  states the queue dependency explicitly for exactly this reason.
* Any future claim of IPS blocking must be re-verified with the queue rule in
  place **and** corroborated by an EVE record with `alert.action: blocked`.

## 4. Single-host sensor, no HA, no distributed collection

Suricata runs on one Kali VM reading one interface. There is no sensor fleet, no
central log shipper, no failover, and the API reads a local file. At scale you
would want: a log shipper (Filebeat/Fluent Bit → Kafka/Redis), multiple sensors,
and the API reading from that pipeline rather than from a file on one host.

**Consequence in practice:** if the sensor's VM is off, live telemetry stops —
visible as a red banner and a source state of `missing`, not as stale numbers.

The API is also designed for a single process (in-process cache, SQLite). Running
multiple uvicorn workers is fine for reading, but analyst state and audit entries
are per-database-file; a real deployment would move those to PostgreSQL.

## 5. Polling, not streaming

The dashboard polls (5 s – 1 m). For SOC volumes in the thousands of events per
minute, that becomes wasteful and adds latency. The upgrade path is SSE or a
WebSocket feeding from a tail-following reader, keeping the same JSON contract —
a change to `datasource.py` and `hooks/useApi.ts`, not to the pages.

## 6. Automated response is deliberately narrow

| Capability | Status |
|------------|--------|
| Classification, priority, recommendation | Implemented |
| Analyst notes and triage status | Implemented (behind write protection) |
| Dry-run command rendering | Implemented |
| Local firewall action on allow-listed targets | Implemented, off by default |
| Remote device blocking (ASA/router/switch ACLs) | **Not implemented by design** — no device credentials, no write path, no automatic configuration change |
| Flow quarantine | **Refused by design** — would need the sensor's own inline path |
| Automatic (unconfirmed) blocking | **Not implemented by design** — a human confirms and authorises |

A dashboard status change is never described as a network block. Only an audit
entry with `status: executed` claims that something happened.

## 7. Other known gaps

| Gap | Impact | Note |
|-----|--------|------|
| No authentication on read endpoints | Anyone who can reach the API can read events | Acceptable for a localhost lab; add OIDC or an API gateway before exposing it |
| No HTTPS | Dev server is plain HTTP | Terminate TLS at a reverse proxy |
| No retention policy | The live window is the tail of one file | Historical imports are manual; a real system wants a searchable store (Elastic/OpenSearch) |
| ATT&CK mapping is rule-of-thumb | Category/technique strings are heuristic | Documented as such in `response/actions.py`; not a compliance-grade mapping |
| Frontend has no automated tests | UI regressions rely on typecheck + review | The API contract is tested; adding Vitest/Testing-Library is the next step |
| No screenshot automation | Evidence images are captured manually | See `docs/08` for the procedure and the checklist |
| The demo baseline contains 10 clearly-labelled generated records | Until you import real logs, the historical set is only partly real | `generated-for-demo` is printed on every one of those records; importing real logs reduces the count to zero |

## 8. What is *not* a limitation (worth saying out loud)

* **The IDS/IPS detection logic is real.** The rules, the EVE records, the
  `allowed` vs `blocked` verdicts and the rule ids all come from an actual
  Suricata session on real traffic.
* **The parsing, filtering, correlation, audit and response-policy code paths are
  real and tested** — 47 automated tests, including the negative cases.
* **The honesty of the networking claims is deliberate engineering**, not a
  shortfall: the evidence pack exists precisely because simulated telemetry would
  have been fiction.
