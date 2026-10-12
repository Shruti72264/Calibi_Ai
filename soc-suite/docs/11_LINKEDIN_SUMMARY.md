# 11 — LinkedIn-ready project summaries

Pick the length that fits the post. All three are accurate about scope — do not
drop the honesty clause, it is what makes the post credible to a security reader.

---

## Short (~60 words, good for a photo caption)

> Built **SENTINEL SOC** — an integrated network intrusion detection and response
> platform: a Packet Tracer enterprise network (Head Office, Branch, ASA, ISP),
> Suricata IDS/IPS on Kali with custom rules, and a React + FastAPI SOC dashboard
> that reads real EVE alerts, correlates flows, and runs a controlled, allow-listed
> response workflow with a full audit trail. Simulation evidence and live telemetry
> are labelled separately — never blended.

---

## Medium (~180 words)

> **SENTINEL SOC — Network Intrusion Detection & Automated Response**
>
> I built an end-to-end SOC platform that connects three normally separate pieces:
>
> 🏢 **Enterprise network** — Cisco Packet Tracer: Head Office and Branch sites,
> OSPF, DHCP, DNS, HTTP/HTTPS, ASA firewall with NAT/PAT, a router ACL, and a
> verified serial WAN.
>
> 🛡️ **Detection** — Suricata 8.0.6 on Kali with custom IDS (`alert`) and IPS
> (`drop`) rules, NFQUEUE-based blocking, 52,987 rules loading cleanly, and both
> `allowed` and `blocked` verdicts captured in EVE JSON.
>
> 📊 **SOC dashboard** — React + TypeScript + Vite over a Python FastAPI backend:
> statistics, filtering/pagination, per-event investigation with flow correlation,
> a topology view, routing/firewall evidence, and a response workflow that
> classifies, recommends, dry-runs, and only then — for allow-listed targets on the
> local host, with confirmation — executes, recording its rollback first.
>
> The part I am most deliberate about: **Packet Tracer's simulated packets are not
> visible to Suricata**, so the dashboard labels live telemetry, historical sensor
> evidence, and verified simulation evidence separately. No fabricated telemetry,
> no "blocked" claim without the EVE record to back it.

---

## Long (~350 words)

> **Design and Implementation of a Network Intrusion Detection and Automated
> Response System using Secure Enterprise Networking**
>
> The goal was a SOC dashboard that would survive scrutiny — which meant solving a
> problem most student "SOC" projects quietly ignore: the enterprise network is a
> *simulation* (Packet Tracer) while the detection layer is *real* (Kali +
> Suricata). Those two planes cannot see each other. Rather than fake a bridge or
> feed the UI sample data, I made the separation explicit in the data model.
>
> **What I built**
>
> * **Network (Packet Tracer):** Head Office (`192.168.10.0/24`) and Branch
>   (`192.168.30.0/24`) sites, an internal server LAN, OSPF across a verified serial
>   WAN, DHCP, internal DNS + HTTP/HTTPS, an ASA firewall with NAT/PAT, and a
>   router ACL that blocks one host while leaving everything else working — a
>   negative test *with* its positive control.
> * **Detection (Kali + Suricata 8.0.6):** custom rules `sid 1000001` (IDS `alert`)
>   and `sid 1000002` (IPS `drop`), an NFQUEUE blocking test, Wireshark
>   corroboration, and real EVE JSON verdicts for both.
> * **Backend (FastAPI):** defensive JSON-Lines parsing (truncated writes, malformed
>   lines and empty files all handled and *counted*), a stable normalised event
>   schema, deterministic event ids for correlation, filter/sort/paginate, per-source
>   health, read-only Suricata probes, a SQLite audit store, and a staged response
>   engine: classify → recommend → dry-run → enforce, where enforcement is
>   allow-list-only, confirmation-required, rate-limited, local-host-only and
>   rollback-logged. Write endpoints are fail-closed behind an API key. 47 tests.
> * **Frontend (React + TypeScript + Vite):** eight pages — overview, alerts console,
>   event investigation with correlation timeline, topology, routing/firewall
>   evidence, IDS/IPS monitoring, response & audit, system health — with live vs
>   historical labelling on every row and explicit error states everywhere.
>
> **Engineering choices I would defend in review:** verdict provenance instead of a
> bare "blocked" badge; `unknown` rather than a guessed action; "not recorded"
> rather than an invented verification timestamp; a documented *not completed* VPN
> instead of an untested configuration; and a response feature that would rather
> refuse than act on an unauthorised target.
>
> **Stack:** Cisco Packet Tracer · Suricata · Kali Linux · Wireshark · Python ·
> FastAPI · Pydantic · SQLite · React · TypeScript · Vite · SVG visualisation

---

## Suggested hashtags / groups

`#CyberSecurity` `#SOC` `#Suricata` `#IDS` `#IPS` `#NetworkSecurity` `#PacketTracer`
`#Cisco` `#BlueTeam` `#Python` `#FastAPI` `#React` `#TypeScript` `#Wireshark`
`#KaliLinux` `#DetectionEngineering`

## Good first comment to add (shows depth)

> One design note worth sharing: I deliberately did **not** treat "the ping failed"
> as proof that the IPS blocked something. Packet loss can come from a bad queue
> number, a routing mistake or a VM hiccup just as easily as from a drop rule. The
> only evidence the platform accepts is the EVE record itself —
> `alert.action: "blocked"` — and it prints which field the verdict came from so
> anyone reviewing the dashboard can audit the claim instead of trusting the badge.
