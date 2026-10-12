# 02 — Cisco Packet Tracer topology, addressing and verified evidence

> **Data class: SIMULATION EVIDENCE.** Everything on this page comes from the
> operator's own Packet Tracer configuration and CLI verification session. It is
> **not** live telemetry, and Packet Tracer traffic is not visible to Suricata on
> the Kali host. The `.pkt` file is preserved unchanged.

Machine-readable source: `backend/data/cisco/network_evidence.json`.
Rendered by the dashboard: **Network Topology** and **Routing & Firewall Status**.

---

## 1. Sites

| Site | Role |
|------|------|
| Head Office | Primary site — employee LAN (192.168.10.0/24) and server LAN (192.168.20.0/24) |
| Branch Office | Remote site — 192.168.30.0/24, reached over the serial WAN via OSPF |
| Internet Edge | ASA firewall, ISP router, simulated Internet server |

## 2. Addressing plan

| Segment | Prefix | Note |
|---------|--------|------|
| Head Office employee LAN | `192.168.10.0/24` | DHCP served by R1 |
| Head Office server LAN | `192.168.20.0/24` | Static addressing |
| Branch LAN | `192.168.30.0/24` | Learned by R1 over OSPF |
| R1 ↔ ASA transit | `10.0.0.0/30` | Routed link |
| ASA ↔ ISP (public) | `203.0.113.0/30` | DOC-5737-style test range |
| Simulated Internet | `203.0.114.0/24` | ISP Internet-facing segment |
| R1 ↔ R2 WAN | `10.10.10.0/30` | Serial link, verified up/up |

## 3. Devices

| Device | Role | Interfaces / addresses | Evidence status |
|--------|------|------------------------|-----------------|
| **R1** | Head Office edge router | G0/0 `192.168.10.1/24` · G0/1 `192.168.20.1/24` · G0/2 `10.0.0.1/30` · S0/3/0 `10.10.10.1/30` | **verified** |
| **Head Office Switch** | L2 access | — | simulated |
| **PC1** | Employee workstation | NIC `192.168.10.11/24`, GW `192.168.10.1` | **verified** |
| **PC0** | Employee workstation (ACL-restricted) | NIC `192.168.10.13/24`, GW `192.168.10.1` | **verified** |
| **Web/DNS Server** | Internal web + DNS | NIC `192.168.20.10/24`, GW `192.168.20.1` | **verified** |
| **R2** | Branch router | G0/0 `192.168.30.1/24` · G0/1 `192.168.10.254/24` · S0/3/0 `10.10.10.2/30` | **verified** |
| **Branch Switch** | L2 access | — | simulated |
| **PC3** | Branch workstation | NIC `192.168.30.10/24`, GW `192.168.30.1` | **verified** |
| **ASA** | Firewall / NAT boundary | inside `10.0.0.2/30` · outside `203.0.113.1/30` | **verified** |
| **ISP Router** | Simulated Internet edge | G0/0 `203.0.113.2/30` · G0/1 `203.0.114.1/24` | simulated |
| **Internet Server** | External service target | NIC `203.0.114.10/24`, GW `203.0.114.1` | **verified** |

**Evidence-status vocabulary** (identical on the topology page):

* `verified` — confirmed in the operator's CLI/test session.
* `simulated` — present in the saved topology; no CLI capture was taken, so no
  per-port or interface claim is made.
* `unknown` — no evidence either way.
* `unavailable` — required but not achievable in this lab.

## 4. Links

| # | Between | Medium | Addresses | Status |
|---|---------|--------|-----------|--------|
| L1 | R1 ↔ HO Switch | copper | `192.168.10.1/24` | simulated |
| L2 | HO Switch ↔ PC1 | copper | `192.168.10.11/24` | simulated |
| L3 | HO Switch ↔ PC0 | copper | `192.168.10.13/24` | simulated |
| L4 | HO Switch ↔ R2 G0/1 | copper | `192.168.10.254/24` | simulated |
| L5 | R1 ↔ Web/DNS server | copper | `192.168.20.1/24`, `192.168.20.10/24` | **verified** |
| L6 | R1 ↔ ASA | copper | `10.0.0.1/30`, `10.0.0.2/30` | **verified** |
| L7 | ASA ↔ ISP | copper | `203.0.113.1/30`, `203.0.113.2/30` | **verified** |
| L8 | ISP ↔ Internet server | copper | `203.0.114.1/24`, `203.0.114.10/24` | **verified** |
| L9 | R2 ↔ Branch switch | copper | `192.168.30.1/24` | simulated |
| L10 | Branch switch ↔ PC3 | copper | `192.168.30.10/24` | simulated |
| L11 | R1 ↔ R2 | **serial** | `10.10.10.1/30`, `10.10.10.2/30` | **verified** up/up |

Solid lines in the dashboard = verified; dashed = present in the topology without
a CLI capture.

## 5. Verified tests (the evidence table)

| ID | Area | Check | Result | Evidence source |
|----|------|-------|--------|-----------------|
| EV-001 | Routing | OSPF adjacency formed; R1 learned Branch `192.168.30.0/24` | **PASS** | PT CLI: `show ip ospf neighbor`, `show ip route` |
| EV-002 | DHCP | R1 served leases on the employee LAN | **PASS** | PT CLI / client DHCP test |
| EV-003 | DNS/HTTP | `www.securetech.local` → `192.168.20.10`; HTTP **and** HTTPS loaded | **PASS** | Client browser + DNS lookup |
| EV-004 | Firewall/NAT | ASA NAT/PAT; inside→outside permitted; outside→inside denied | **PASS** | ASA CLI + connectivity tests |
| EV-005 | ACL | `BLOCK_PC0` denies `192.168.10.13` → `203.0.114.10`; everything else unaffected | **PASS** | R1 CLI + PC0 test |
| EV-006 | WAN | Serial0/3/0 up/up on both routers (`10.10.10.0/30`) | **PASS** | `show ip interface brief` |
| EV-007 | VPN | Site-to-site VPN | **NOT COMPLETED** | Packet Tracer device/image limitations |
| EV-008 | Boundary | Packet Tracer traffic is not visible to Suricata/Wireshark | INFORMATIONAL | Architecture rule |

### Verification timestamps

The original CLI session did not record dates, so the evidence pack stores
`verified_at: null` and the dashboard prints **"not recorded"** rather than
today's date. Fill them in as you re-verify:

```bash
cd backend
python3 - <<'PY'
import json, pathlib, datetime
p = pathlib.Path("data/cisco/network_evidence.json")
pack = json.loads(p.read_text())
stamp = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
for item in pack["evidence"]:
    if item["result"] == "PASS":
        item["verified_at"] = stamp
pack["generated_at"] = stamp
p.write_text(json.dumps(pack, indent=2) + "\n")
print("stamped", len(pack["evidence"]), "evidence items")
PY
```

## 6. EV-005 in detail — why it is the strongest piece of evidence

```
access-list BLOCK_PC0 deny ip host 192.168.10.13 host 203.0.114.10
```

A deny rule on its own proves nothing: if the whole path were broken, PC0 would
fail to reach the server anyway and the "block" would be indistinguishable from a
misconfiguration. The test is only meaningful because it includes a **positive
control**:

| Test | Expected | Observed |
|------|----------|----------|
| PC0 `192.168.10.13` → `203.0.114.10` | denied | denied ✔ |
| PC1 `192.168.10.11` → `203.0.114.10` | permitted | permitted ✔ |
| PC0 `192.168.10.13` → other destinations | permitted | permitted ✔ |

That is the difference between "a rule exists" and "a rule has the intended
effect", and it is the same rigour the Suricata IDS/IPS tests apply with their
`allowed` vs `blocked` pair.

## 7. Why there is no live collection for this topology

Cisco Packet Tracer is a simulator: its devices do not expose SSH/SNMP/Telnet
management planes to an external collector in a way this dashboard could use, and
its "packets" never leave the application.

The provider therefore ships two planes:

1. **Evidence plane (default, useful today)** — the JSON pack above, labelled
   `simulation evidence` everywhere it appears.
2. **Live plane (opt-in, honest about failure)** — `SOC_CISCO_LIVE_ENABLED=true`
   plus `SOC_CISCO_LIVE_HOSTS=host:port,…` performs a **TCP reachability probe
   only**. It never logs in, never runs a command, and reports "reachable" as
   exactly what it is — a socket that accepted a connection. It is included so
   that the same dashboard would work against real hardware or CML/GNS3 images
   once access is secured.

## 8. Reproducing the evidence on your own machine

```text
1. Open the existing .pkt in Packet Tracer (do not rebuild the topology).
2. Re-run each CLI check and paste the output into the pack (or a new file):
     show ip interface brief        | show ip route       | show ip ospf neighbor
     show access-lists              | show ip dhcp binding
     (ASA) show nat | show xlate    | show running-config interface
3. Re-run the client tests:
     PC1/PC0 ping + browser to www.securetech.local  (HTTP and HTTPS)
     PC0 vs PC1 to 203.0.114.10                      (the ACL positive control)
     Branch PC3 -> Head Office server                (OSPF path)
4. Point SOC_CISCO_EVIDENCE_PATH at your updated JSON and refresh the dashboard.
```
