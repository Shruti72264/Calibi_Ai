# 05 — Suricata rules, safe enablement and the isolated IPS test

Sensor: **Kali Linux (VMware Workstation)** · interface `eth0` · host `192.168.61.129`
Engine: **Suricata 8.0.6** · capture analysis: **Wireshark 4.6.6**
Rules: `/etc/suricata/rules/local.rules`

> Everything in this document is a procedure, not a claim. The dashboard only
> ever displays what the EVE log actually contains — if you run none of this,
> the dashboard correctly shows zero live events.

---

## 1. The custom rules

```suricata
alert icmp any any -> any any (msg:"LOCAL IDS TEST"; sid:1000001; rev:1;)
drop  icmp any any -> 8.8.8.8 any (msg:"LOCAL IPS TEST - ICMP BLOCKED"; sid:1000002; rev:1;)
```

| | sid 1000001 | sid 1000002 |
|---|---|---|
| Action | `alert` | `drop` |
| Purpose | Prove the sensor sees traffic and the rule engine fires | Prove the IPS path can actually stop a packet |
| Behaviour without an IPS path | Alerts | Alerts, but **cannot** drop (no queue) |
| Expected EVE `alert.action` | `allowed` | `blocked` |
| Dashboard badge | green *allowed* | red *blocked*, severity high |

Two design points worth defending in an interview:

1. Both rules use **ICMP against an approved public resolver**. ICMP is the
   smallest possible test surface: no application layer, no payload, one packet
   in and one out, trivially verifiable in Wireshark as well as Suricata.
2. The rules are **not** registered in the default `suricata.yaml` rule list by
   accident — they are a separate `local.rules` file, so they can be enabled and
   disabled as a unit without touching the 52,000-rule community set.

---

## 2. Before you change anything — the inspection baseline

Run these on the **sensor** first. They are read-only and they are exactly what
the dashboard's IDS/IPS page reports back to you.

```bash
# Is the unit running? (the dashboard reports "inactive" honestly if it is not)
sudo systemctl status suricata --no-pager

# Is there a process even without systemd?
ps -ef | grep -i '[s]uricata'

# What do the logs look like right now? Note the SIZES: a 0-byte eve.json is a
# real answer ("no alert since last start"), not a broken dashboard.
sudo ls -l /var/log/suricata/

# Do the rules load cleanly? -T validates and exits WITHOUT capturing.
sudo suricata -T -c /etc/suricata/suricata.yaml
#   Reported baseline: configuration loaded successfully, 52,987 rules loaded,
#   0 failed.

# Are the custom rules actually in the loaded set?
sudo grep -n 'LOCAL' /etc/suricata/rules/local.rules
sudo grep -n 'rule-files\|- local.rules' /etc/suricata/suricata.yaml

# If you previously ran the IPS test, PROVE the queue rule is gone:
sudo iptables -L OUTPUT -n --line-numbers | head
```

The last command matters: if the temporary NFQUEUE rule were still in place, the
`drop` rule could still be discarding your ICMP traffic, and a "failed" test
would be impossible to distinguish from a working block.

---

## 3. Step 1 — enable IDS (detection only, cannot break anything)

```bash
sudo systemctl start suricata
# or, to watch it work, run it in the foreground on the capture interface:
sudo suricata -c /etc/suricata/suricata.yaml -i eth0 -v
```

`alert` rules only write logs. In plain interface (IDS) mode Suricata has no
packet-injection path, so **nothing can be dropped** — this is why detection is
always tested first.

Confirm it is writing:

```bash
sudo tail -f /var/log/suricata/eve.json | grep --line-buffered '"event_type":"alert"'
```

Then generate **one authorised detection**:

```bash
ping -c 2 8.8.8.8
```

and look for the matching record:

```bash
sudo grep 1000001 /var/log/suricata/eve.json | tail -1 | python3 -m json.tool
#   "alert": { "action": "allowed", "signature": "LOCAL IDS TEST", "signature_id": 1000001, ... }
```

**Dashboard check:** refresh the dashboard. The **live** counter becomes non-zero,
the event appears with a **Live** badge, and the IDS/IPS page's action split shows
1 allowed / 0 blocked. That single event is the end-to-end proof:
*Suricata → EVE JSON → FastAPI → React*.

---

## 4. Step 2 — the isolated IPS test

### Read this first

* An IPS `drop` rule does nothing on its own. It acts only on packets routed
  through the queue Suricata is reading (`-q <num>` / NFQUEUE).
* A broadly-scoped iptables rule is the fastest way to lose management access to
  the VM. Scope it to **protocol + direction + destination**.
* If Suricata is already running in IPS mode elsewhere, restarting it can start
  dropping traffic that was previously flowing. Do this in a controlled window
  with console access.
* Revert in the same session, whether or not the test succeeded.

### Procedure

```bash
# 0. Stop any IDS-mode instance first, so only one engine binds the queue.
sudo systemctl stop suricata

# 1. Send ONLY the sensor's own outbound ICMP into the queue.
sudo iptables -I OUTPUT -p icmp -j NFQUEUE --queue-num 0

# 2. Run Suricata on that queue, in the foreground so you can see it work.
sudo suricata -c /etc/suricata/suricata.yaml -q 0 -v

# 3. In a second shell, test the block.
ping -c 3 8.8.8.8            # expect: 100% packet loss while sid 1000002 is loaded

# 4. REVERT — do this even if the test failed.
sudo iptables -D OUTPUT -p icmp -j NFQUEUE --queue-num 0

# 5. PROVE the revert.
sudo iptables -L OUTPUT -n --line-numbers | head
ping -c 2 8.8.8.8            # connectivity restored
```

### Confirm the block is real, not just a dead network

```bash
sudo grep 1000002 /var/log/suricata/eve.json | tail -1 | python3 -m json.tool
#   "alert": { "action": "blocked", "signature": "LOCAL IPS TEST - ICMP BLOCKED",
#              "signature_id": 1000002, "severity": 1, ... }
```

The critical distinction: **packet loss alone is not proof of a block.** Packet
loss could be a routing problem, a bad queue number, or a VM network hiccup. The
proof is the EVE record carrying `alert.action: "blocked"` — which is exactly why
the dashboard derives "blocked" from the log and not from "the ping failed".

Corroborate in Wireshark at the same time: you should see the outbound echo
requests with **no replies**, and (in the successful IDS test) a clean
request/reply pair. That pairing of Suricata evidence and packet-level evidence is
the strongest result the project can produce.

---

## 5. What the dashboard shows, and what it refuses to show

| Reality | Dashboard behaviour |
|---------|--------------------|
| Suricata inactive, `eve.json` empty | Live source state `empty`, 0 live events, banner explains, historical evidence still shown and labelled |
| Alert fired, `alert.action: allowed` | Green *allowed* badge; recommendation says detection-only, no action required |
| Drop fired, `alert.action: blocked` | Red *blocked* badge, severity high, priority P1, recommendation "already dropped — preserve evidence, no further blocking needed" |
| EVE says nothing about the verdict | Amber *unknown*, with `action_source: "not recorded in the EVE event"` and an explicit warning not to conclude |
| Operator clicks "record recommendation" | Audit entry `recommended`; message states that nothing was executed and no device changed |
| Enforce mode with a non-allow-listed IP | `422` with the reason; **no command is even built** |

---

## 6. Rolling this into the historical evidence file

After a successful test, fold the new records into the baseline so the dashboard's
historical view reflects your own sensor session rather than the demo placeholder:

```bash
cd soc-suite/backend
python3 tools/import_eve_evidence.py \
    --source /var/log/suricata/eve.json \
    --source /var/log/suricata/eve.json.1.gz \
    --out data/historical/eve-alerts-history.json \
    --label "Suricata IDS+IPS test session"
```

The importer keeps only genuine alert records, stamps each with
`sentinel_provenance: operator-evidence`, refuses to overwrite the file when no
alerts are found, and reports per-file parse statistics so a corrupt rotation
cannot slip through unnoticed.

---

## 7. Turning it back off (and why you should)

```bash
sudo systemctl stop suricata      # stop the engine
sudo iptables -L OUTPUT -n --line-numbers | head   # prove no queue rule remains
```

Leaving a drop rule loaded with a queue rule in place means a **silent** IPS is
running. Leaving a drop rule loaded with **no** queue rule is harmless but
misleading — which is precisely why the dashboard's IDS/IPS page shows the queue
state question explicitly rather than inferring "IPS working" from a loaded rule.
