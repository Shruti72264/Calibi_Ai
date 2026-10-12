# 13 — Remaining learning modules, completed with practical evidence

Each module below is short by design: enough theory to explain the commands, then
the **exact commands and the evidence they produce** for this project. Where a
module is better served by a note than by lab time, it says so and explains why.

---

## 1. Linux filesystem — where a SOC's data actually lives

```
/                     root of everything
├── etc/
│   └── suricata/       configuration: suricata.yaml, rules/local.rules
├── var/
│   ├── log/suricata/   eve.json (JSON-Lines), fast.log, stats.log, .gz rotations
│   └── lib/suricata/   engine state, rule caches
├── proc/               live kernel view: /proc/<pid>/comm identifies processes
├── opt/  srv/          third-party / service data
└── home/               your evidence folder, your backend, your venv
```

Container-friendly consequence used in this project: `parser.py` reads
`/proc/<pid>/comm` directly instead of shelling out to `ps`, so process detection
works where `ps` is absent or trimmed.

**Practical exercise (2 min):** find where your sensor writes and prove it.

```bash
sudo ls -l /var/log/suricata/            # note sizes: 0-byte eve.json is meaningful
df -h /var/log                           # is the log volume about to fill?
sudo find /var/log/suricata -name '*.gz' -mtime -7 -printf '%p %s bytes\n'
```

**Evidence:** `/var/log/suricata/` shows a 0-byte `eve.json` (no alerts since the
last start) alongside rotated logs containing the test events — which is exactly
why the dashboard distinguishes `empty` from `missing`.

---

## 2. Linux permissions and processes

The two questions that matter operationally:

**Q: who may read `eve.json`?** Suricata writes it as root, mode 640, group
`suricata`. The API should run as an unprivileged user.

```bash
stat -c '%n %a %U:%G' /var/log/suricata/eve.json      # e.g. … 640 root:suricata
id                                                    # what am I, and which groups?
sudo usermod -aG suricata "$USER"                     # preferred fix (then re-login)
sudo setfacl -m u:socapi:r /var/log/suricata/eve.json # preferred fix for a service account
getfacl /var/log/suricata/eve.json                    # verify the ACL
```

Anti-patterns, and why:

* `chmod 777 /var/log/suricata/eve.json` — turns attack traffic into world-readable
  evidence and lets anyone rewrite the log a detection depends on.
* Running `uvicorn` with `sudo` — gives an internet-facing service root for no
  benefit. Nothing in this codebase needs privilege; enforcement mode uses the
  firewall tool the operator already configured.

**Q: which processes actually matter?**

```bash
ps -eo pid,user,comm,args | grep -i '[s]uricata'
systemctl is-active suricata; systemctl is-enabled suricata
sudo ss -lunp | grep -i suricata      # a listening socket would imply a management/telemetry port
```

The `[s]uricata` bracket trick stops `grep` from matching its own command line —
the same reason this project's probes are argv lists rather than shell strings.

**Evidence:** the API's IDS/IPS page reproduces these facts read-only, and treats
permission failure as a first-class, explained state (`unreadable` + errno), because
"the sensor is silent" and "I cannot read the sensor" are very different incidents.

---

## 3. Network troubleshooting commands (with the RTFM order)

Always diagnose in this order — it matches the OSI stack and stops you guessing:

```bash
# 1. link up?
ip -brief address; ip link show eth0

# 2. path to the target, and where it stops
ip route get 8.8.8.8
traceroute -I 8.8.8.8            # -I uses ICMP, matching this project's test rules

# 3. name resolution
resolvectl query 8.8.8.8 2>/dev/null || dig +short www.securetech.local @192.168.20.10

# 4. reachability, with counted and timed results
ping -c 3 -i 0.4 8.8.8.8

# 5. the port/service layer
ss -ltnp
nc -vz 192.168.20.10 80 443

# 6. DNS/HTTP specifics
curl -sSI http://www.securetech.local          # headers only
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' https://www.securetech.local

# 7. what is the firewall doing?
sudo iptables -L -n -v --line-numbers | head -40
sudo nft list ruleset 2>/dev/null | head -40
sudo conntrack -L 2>/dev/null | head
```

**The lesson this project tries to institutionalise:** in step 4, *packet loss is
not proof of a block*. Packet loss can be caused by a missing route, a wrong
NFQUEUE number, a dead VM NIC, or a real `drop` rule. Only evidence at the
detection layer (`alert.action: "blocked"` in EVE) plus corroboration at the packet
layer (Wireshark showing requests with no replies) supports the claim.

**Evidence:** the IDS/IPS page's "expected vs observed" steps, and the E-10/E-11/E-13
screenshot pair in `docs/08`.

---

## 4. Wireshark investigation

**Capture, filtered to the test so the file stays small:**

```bash
sudo dumpcap -i eth0 -f 'icmp and host 8.8.8.8' -w ~/project-evidence/icmp-test.pcapng -a duration:60
```

Equivalent GUI filter to type in Wireshark:

```
icmp && ip.addr == 8.8.8.8
```

**What to look for, and what each thing proves:**

| Observation | Interpretation |
|-------------|----------------|
| Echo request **and** echo reply | The IDS test: traffic flowed; Suricata should log `allowed` |
| Echo requests with **no replies** | The IPS test window: consistent with the drop rule — but confirm in EVE, see below |
| Reply present while EVE says `blocked` | Contradiction: the "block" was not real (wrong queue, or the rule was not in the loaded set) |
| No requests at all | The test never ran, or the interface is wrong — nothing to conclude |

**Follow the TCP/ICMP stream** to prove ordering; use *Statistics → Conversations*
to prove which host spoke first; use *Analyze → Expert Information* to catch
retransmissions that indicate a black-hole rather than a clean reject.

**The important analytical habit:** correlate the packet capture *with* the
detection log on the same timeline.

```bash
sudo grep 1000002 /var/log/suricata/eve.json | python3 -m json.tool | grep -E 'timestamp|action|signature'
```

Timestamps within milliseconds of each other, on the same 5-tuple, in the same
direction — that is triangulation. Either one alone is an assertion.

**Evidence:** E-13 in `docs/08` (request/reply pair for IDS, request-only for IPS).

---

## 5. BGP routing — why it is *not* in this lab, and what the right answer is

**Verdict: correctly out of scope.** Packet Tracer's BGP support is limited to a
narrow set of models and images, and an enterprise edge lab of this size is
modelled with a static default route toward the ISP. Forcing BGP in would mean
demonstrating something the simulator does not faithfully represent — the same
reasoning that produced the honest VPN limitation.

**What the evidence says the design should be, if BGP is added later:**

| Element | Value for this topology |
|---------|-------------------------|
| AS numbers | `AS 65010` (enterprise, R1) · `AS 65020` (ISP) |
| Peering | eBGP between R1 G0/2 (`10.0.0.1/30`) and the ISP (`203.0.113.2/30`) |
| Advertised | The enterprise summary `192.168.10.0/23` (covering 10.0 and 20.0), not the /24s |
| Received | A default route or the ISP's prefix list, with an inbound prefix filter |
| Safety controls | `maximum-prefix`, an inbound prefix-list/route-map, `bgp log-neighbor-changes`, MD5/TTL-security on the session |
| Why OSPF stays | OSPF remains the interior protocol between R1 and R2 — BGP would be for the *exterior* peering only |

The security-relevant point: **BGP is a trust relationship.** An unfiltered eBGP
session means a neighbour can advertise a more-specific prefix and hijack your
traffic; that is precisely how route leaks become outages. If you add BGP on real
hardware (or CML), advertise aggregates, filter inbound and outbound, cap the
prefix count, and log every adjacency change — and record it in the evidence pack
with the same `verified_at` / `source` discipline used for the OSPF entry.

---

## 6. Proxy configuration and testing

**Where a proxy belongs in this architecture:** in front of the API, never inside
it. The API reads local files and does not make arbitrary outbound requests, so a
forward proxy has nothing to do with its operation. The useful placements are:

**(a) TLS termination + authentication in front of the dashboard/API (reverse proxy).**

```nginx
# /etc/nginx/sites-available/sentinel-soc
server {
    listen 443 ssl;
    server_name soc.lab.local;

    ssl_certificate     /etc/ssl/certs/soc.lab.local.crt;
    ssl_certificate_key /etc/ssl/private/soc.lab.local.key;

    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:5173/;   # or a static build served from /var/www
        proxy_set_header Host $host;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";   # Vite HMR websocket
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -sk https://soc.lab.local/api/health | python3 -m json.tool | head
```

Because the dashboard calls `/api/...` on its own origin, it keeps working behind
the reverse proxy with **no rebuild** — which is the practical payoff of the
same-origin decision. Remember to add `https://soc.lab.local` to `SOC_CORS_ORIGINS`
only if something bypasses the proxy.

**(b) Client-side proxy for outbound testing from the VM.**

```bash
export http_proxy=http://proxy.lab.local:3128 https_proxy=http://proxy.lab.local:3128
export no_proxy=localhost,127.0.0.1,192.168.20.0/24     # keep internal traffic direct
curl -sS -x http://proxy.lab.local:3128 https://example.com -o /dev/null -w '%{http_code}\n'
```

Note the security angle worth mentioning in an interview: a proxy that terminates
TLS sees the plaintext of everything it forwards, and `no_proxy` is what stops your
internal management traffic from being exposed to it. Also note that a
transparent interception proxy breaks TLS validation unless it is trusted —
"install this root CA" is a decision, not a detail.

**Evidence for the module:** `nginx -t` output plus `curl` against the proxied URL,
captured with the same `evidence/` discipline as the other modules.

---

## 7. VPN — the honest limitation and the correct design

**What was attempted, and why it stopped.** A site-to-site IPsec tunnel was scoped
and attempted in Packet Tracer and abandoned: the available ASA/device images in
this Packet Tracer version do not support the required IPsec features. It is
recorded as `EV-007 / NOT COMPLETED / unavailable` in the evidence pack and shown
as a red card on the dashboard, rather than replaced by an untested configuration.

**The design that a real implementation would follow:**

| Parameter | Value for this topology |
|-----------|-------------------------|
| Peering | R1 (`10.0.0.1/30`) ↔ ASA, or R1 ↔ ISP-side peer depending on which end terminates |
| IKE version | IKEv2, AES-256 / SHA-256 / DH group 14+, ~8 h rekey |
| IPsec | ESP, AES-256-GCM, PFS enabled |
| Protected prefixes | `192.168.10.0/23` (Head Office employee + server LANs) ↔ `192.168.30.0/24` (Branch) |
| Authentication | PSK for the lab; certificate-based (PKI) for anything real — PSKs do not scale and cannot be revoked per peer |
| Anti-replay / PFS | On |
| Verification | `show crypto ikev2 sa`, `show crypto ipsec sa` (packet counters non-zero), a ping across the tunnel with `match address` confirmed, and a capture on the outside interface proving **ESP, not cleartext** |

**How to talk about it, and why this answer is better than a fake one:**

> "VPN was attempted and is documented as not completed because Packet Tracer's
> image set does not support site-to-site IPsec. The design is specified — IKEv2,
> AES-256-GCM, PFS, protected prefixes 192.168.10.0/23 and 192.168.30.0/24 — and
> implementing and verifying it needs real hardware or CML. I have not claimed a
> tunnel I could not show you `show crypto ipsec sa` output for."

That sentence demonstrates three things a fabricated configuration cannot:
scoping, verification discipline, and the professional judgement to leave a
requirement open rather than close it falsely.

---

## 8. Where these modules connect back to the dashboard

| Module | Where it shows up in the product |
|--------|----------------------------------|
| Filesystem | System Health file probes (path, size, lines, modified, error) |
| Permissions | `unreadable` source state with the errno and the group/ACL fix |
| Processes | `/proc`-based Suricata process count; `systemctl is-active` probe |
| Troubleshooting order | The IDS/IPS "expected vs observed" test steps |
| Wireshark | The corroboration requirement before believing a "blocked" verdict |
| BGP | Documented out of scope, with the design and its security controls written down |
| Proxy | Reverse-proxy deployment path that needs no rebuild |
| VPN | `EV-007`, rendered as an explicit `unavailable` limitation |
