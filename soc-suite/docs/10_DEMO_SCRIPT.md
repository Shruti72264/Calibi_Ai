# 10 — Demonstration script (interview / viva)

**Total time:** 6 minutes if you are tight, 12 if you take questions. Practise the
2-minute version first — that is the one you will actually get.

Before you start: `cd soc-suite && ./start-demo.sh`, set auto-refresh to 15 s, and
have `docs/07_TEST_PLAN.md` open in another tab for the numbers.

---

## The 30-second setup (say this before touching the screen)

> "This is SENTINEL SOC. It integrates three things: an enterprise network built in
> Packet Tracer, a Suricata IDS/IPS sensor running on Kali, and a SOC dashboard
> that reads the sensor's real alert log.
>
> One thing I was strict about: the Packet Tracer network and the Suricata sensor
> are **two separate evidence planes**. Packet Tracer is a simulation — its packets
> never reach the sensor's interface. So the dashboard shows live sensor telemetry,
> recorded sensor evidence, and verified Packet Tracer evidence, and it labels
> which is which on every single row. It never blends them."

That framing tells the interviewer you understand your own system's limits. It is
usually the first thing they probe.

---

## 1. Overview — the estate at a glance (~60 s)

**Screen:** `/`

* "The header banner says it plainly: there is no live sensor attached to this
  machine right now, so everything here is historical evidence — recorded test
  events, not current traffic."
* "Twelve alerts — and notice I am not hiding the 'unknown verdict' tile. If
  Suricata did not write an action into the record, the dashboard says *unknown*.
  It never guesses 'allowed'."
* "The severity donut: 4 high, 8 low. The four high ones are the IPS drops."
* Point at the two counters: **live 0 / historical 12**.

\[If your VM's sensor is running, do this instead: start Suricata, `ping -c 2 8.8.8.8`,
hit Refresh, and let them watch the live counter go from 0 to 1 with a **Live**
badge. That single moment is the strongest 20 seconds of the demo.]

## 2. Security Alerts — filtering and the real blocked event (~60 s)

**Screen:** `/alerts` → type `IPS` in *Signature contains*

* "Four events, rule id 1000002, all **blocked**, all severity high. This is the
  IPS drop rule from the test session — the record says `alert.action: blocked`,
  and the row shows the badge."
* "Every filter here is a documented API parameter, and filtering happens
  server-side. So this view is reproducible with curl — it is not a client-side
  filter over a partial page."
* Click **Raw** on a row: "The raw EVE excerpt, the flow id, and *where the verdict
  came from* — `alert.action`. If the record had not stated an action, this field
  would say so and the badge would be amber."
* Switch the filter to **Live telemetry only**: "Empty, and that is correct — no
  sensor, no live events. I would rather show you an honest zero than a full page
  of something I cannot justify."

## 3. Event Investigation — the analyst workflow (~75 s)

**Screen:** click **Investigate** on a blocked row

* "Timestamp, flow, protocol, rule, record id. The record id is deterministic —
  a hash of the file, flow id and timestamp — so analyst state sticks to the same
  event across polls and restarts."
* Point at the **timeline**: "The focal event in red, correlated events above it —
  correlated by flow id when available, otherwise by source or destination."
* Point at **Verdict provenance**: "And here is why I believe it was blocked:
  `alert.action` from the module, plus the raw EVE excerpt."
* Point at **Response recommendation**: "Rule-based, explainable: the signature, the
  protocol, the recorded action and the severity produce a category, a priority and
  a recommendation. For an event already blocked the recommendation is 'no further
  action — preserve evidence'."
* Click **Record recommendation**: "Note the message: *nothing was executed*; mode
  is `recommend`. A dashboard status change is not a network block, and the platform
  refuses to imply otherwise."

## 4. Network Topology and Routing — the simulation, labelled (~60 s)

**Screen:** `/topology`

* "Head Office, Branch, Internet edge — the addressing from my Packet Tracer build.
  R1's four interfaces, R2's three, the ASA inside/outside pair, the ISP, and the
  internal web/DNS server."
* Point at **stripe colours and the legend**: "Green = verified in my CLI session.
  Blue = present in the saved topology, no CLI capture taken. I do not have a
  category for 'probably fine'."
* "No interface counters, no uptime bars — because Packet Tracer exposes no
  management plane. Fabricating that data would be the easy dishonest move; putting
  a gauge on the screen that means nothing is worse than having no gauge."
* Click **R1** → addresses, roles, services, and the evidence ids that back each
  claim. Then switch to `/routing`: "Each check with its result, its evidence source,
  and expected vs observed. And here — the VPN is recorded as **NOT COMPLETED**,
  because the Packet Tracer images did not support site-to-site IPsec."

## 5. IDS/IPS Monitoring — the sensor and the safety procedure (~60 s)

**Screen:** `/ids-ips`

* "The probe card is a real measurement made just now: binary present or not,
  `systemctl is-active`, the EVE file's existence, size and readability, the rule
  files visible to the process. It never reports a state it did not measure."
* "The custom rule registry: sid 1000001 `alert` and sid 1000002 `drop`, with the
  rule text and what each one proved. Then the action split — 8 allowed from the
  detection rule, 4 blocked from the drop rule."
* Scroll to the **safe enablement** panel: "This part matters operationally. A `drop`
  rule does nothing without a queue path. And I flagged the failure mode explicitly:
  if you add a broad iptables rule to test IPS and forget to remove it, you can lock
  yourself out of the VM and you cannot tell a working block from a dead network.
  So the procedure is: validate with `-T`, prove detection first, scope the queue
  rule to one protocol and direction, test, then revert *in the same session* and
  prove the revert."

## 6. Response & Audit — the controlled-response design (~60 s)

**Screen:** `/response`

* "The response workflow is staged: classify → recommend → dry-run → enforce. The
  default is recommend: it records a recommendation and executes nothing."
* "Enforcement is constrained by construction, not by convention: the target must be
  on `SOC_RESPONSE_ALLOWLIST`, so an arbitrary IP cannot produce a command at all —
  the engine returns a blocker and never builds the argv. It requires `confirm=true`
  plus a recorded authorisation statement. It is rate-limited per hour as a circuit
  breaker. It only ever touches **this host's** firewall — never the ASA, never a
  router, never Packet Tracer."
* "And every attempt is audited, including refusals, with the rollback command
  recorded before execution. That is the row you are looking at."
* If asked *"why not just block automatically?"* — "Because the cost of a false
  positive on an inline block is an outage, and because a tool that silently
  rewrites firewall state with no approval trail is unauditable. Recommendation plus
  one confirmed, logged, reversible action is the right first version."

## 7. Close (~30 s)

> "Three things I would point at as the engineering content: first, the data-class
> separation — live, historical and simulated evidence never blend, and it is
> enforced in the API rather than in the UI. Second, the failure behaviour — empty
> logs, permission errors, malformed JSON, an unreachable backend, an unknown event
> id: each one has a defined, visible behaviour, and 47 tests assert them. Third,
> the honesty about scope: the VPN is not completed, Packet Tracer cannot be polled,
> and the response feature is deliberately narrow. I would rather hand you a system
> whose claims I can defend one by one."

---

## Questions you should be ready for

| Question | Short answer |
|----------|--------------|
| "Is this data real?" | "Yes — with labels. The two baseline records are from a real Suricata session (source 192.168.61.129, dest 8.8.8.8, ICMP, sids 1000001/1000002). Ten more are machine-generated and flagged `generated-for-demo` on every record so the dashboard is demonstrable; one command replaces the whole file with my rotated logs and that flag count drops to zero." |
| "Can Suricata see Packet Tracer traffic?" | "No, and the platform says so on the topology page. Packet Tracer is a standalone simulation. Bridging would mean GNS3/real hardware, or replaying an exported PCAP — and replayed traffic must be labelled as replayed." |
| "What happens when Suricata is down?" | "The live source reports `missing` or `empty` with the file size, the live count is 0, a banner explains, and historical evidence still renders with its own label. Status only flips to `degraded` if both sources fail." |
| "How do you prevent the API from being used to run commands?" | "No endpoint accepts a command, a path or a filename. `subprocess` is called with an argv list and `shell=False`, and the only variable ever interpolated is a validated IP that must appear on an allow list. There is a test that fails the build if a route name ever contains `command`, `exec`, `shell`, `run`, `file` or `path`." |
| "How do you know 'blocked' really means blocked?" | "The verdict comes only from the EVE record — `alert.action`, a `drop` event type, or a drop block. The UI prints the field it used, in `action_source`. Packet loss alone is never treated as proof, because that could just as easily be a broken path." |
| "What would you do next?" | "Three things: import the real rotated logs so 100 % of the historical set is genuine; add a screenshot-capture step to the repo's CI so UI evidence is reproducible; and replace polling with an SSE stream fed by a tail-following reader behind the same JSON contract. After that, move analyst state to PostgreSQL and add OIDC before it ever leaves localhost." |
| "Why is there no site-to-site VPN?" | "Packet Tracer's ASA image in this version does not support the required IPsec features. It is documented as not completed with the design in the report — IKEv2, PSK, the 10.0.0.0/30 transit, protected prefixes 192.168.10.0/23 and 192.168.30.0/24. Implementing it needs real hardware or CML and I would not claim it otherwise." |
| "How does the dashboard know a source is live vs historical?" | "The source is a property of the read, not of the event: `datasource.py` labels every event at read time from the file it came from, and the API reports per-source health separately. The UI badge reads that field, so mislabelling would require changing the data, not forgetting a string." |

## If something breaks mid-demo

1. **Dashboard blank / API error:** the banner tells you which endpoint failed and
   why. Restart with `./start-demo.sh`; the first page load already has data.
2. **Port 5173 busy:** `npm run dev -- --port 5174`.
3. **Wrong numbers:** open `/system` — source states, file sizes, line counts and
   parse errors are all there. Say what you see rather than improvising: "the live
   source is `missing`, so those are the recorded baseline events — here is the
   file path." A calm, accurate explanation of a missing sensor is a *better*
   answer than a screen full of fake green.
