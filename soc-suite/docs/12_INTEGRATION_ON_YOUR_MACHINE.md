# 12 — Integrating this into your own environment

This is the practical hand-off document: exact commands to move the platform onto
your machines and wire it to **your** sensor, **your** Packet Tracer topology and
**your** evidence folders.

Nothing here rebuilds or overwrites your existing work. Step 0 is a backup of the
two folders named in your brief (`~/soc-backend` and, if it exists,
`~/soc-dashboard-ui`).

---

## Step 0 — Get the files onto your machine

Copy the `soc-suite` folder to your Linux host (Kali VM or the machine that ran
the original backend):

```bash
# from wherever you cloned/downloaded this repository
scp -r soc-suite user@your-host:~/
ssh user@your-host
cd ~/soc-suite
```

Then back up what already exists, so nothing is lost:

```bash
[ -d ~/soc-backend ] && mv ~/soc-backend ~/soc-backend-backup-$(date +%F) && echo "backed up ~/soc-backend"
[ -d ~/soc-dashboard-ui ] && mv ~/soc-dashboard-ui ~/soc-dashboard-ui-backup-$(date +%F) && echo "backed up ~/soc-dashboard-ui"
```

Your `~/project-evidence/phase1-suricata-baseline/` is **not** touched — you will
point the API at it in step 3.

---

## Step 1 — Deploy the backend to `~/soc-backend`

Your brief named `~/soc-backend` as the canonical backend location, so this keeps
that name and extends it rather than creating a parallel copy.

```bash
cp -r ~/soc-suite/backend ~/soc-backend
cd ~/soc-backend

python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Your old parser.py / main.py, if you want to keep them for reference:
#   (the backup at ~/soc-backend-backup-* keeps the originals; do not copy them
#    into the new tree, because app/parser.py and app/main.py are the maintained
#    replacements and the tests import them by path.)
```

### What changed relative to the original backend, and why

| Original | Now | Reason |
|----------|-----|--------|
| `parser.py` at the top level, parsing at import time | `app/parser.py` as a pure function returning `(events, stats)` | The old path raised on a truncated line; the new one counts and continues, and always reports per-file parse statistics |
| `main.py` hard-coding `EVE_PATH` | `app/settings.py`, every value an env var | Live and historical sources must be configured **separately** |
| One data source | `datasource.py` with two labelled sources | Historical evidence must never be presented as live |
| Endpoints only for alerts/stats | + `/api/network/status`, `/api/system/status`, `/api/audit`, `/api/response/*`, `/api/suricata/status` | Completes the dashboard's requirements |
| No write protection | Fail-closed API-key gate | Analyst notes and response actions are state changes |

## Step 2 — Deploy the frontend to `~/soc-dashboard-ui`

```bash
cp -r ~/soc-suite/frontend ~/soc-dashboard-ui
cd ~/soc-dashboard-ui
npm install
npm run typecheck     # must be clean
npm run dev           # http://<host>:5173
```

Keep `VITE_API_BASE_URL` unset: the browser calls `/api/...` on its own origin and
the dev server proxies it to the API. That is what makes it work identically on
localhost, over the LAN, and behind a proxied preview.

## Step 3 — Point the API at your real sensor and evidence

```bash
cd ~/soc-backend
cp .env.example .env
```

Edit `.env`:

```bash
# the sensor's real EVE log
SOC_LIVE_EVE_PATH=/var/log/suricata/eve.json

# YOUR evidence folder (the one from the brief)
SOC_HISTORICAL_EVE_PATHS=/home/<you>/project-evidence/phase1-suricata-baseline/eve-alerts-history.json

# keep the dashboard's origin listed
SOC_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

### Two gotchas worth reading before they bite you

**a) Your baseline file may not be in the format the new parser wants.** The API
reads **JSON Lines** (one JSON object per line). If your
`eve-alerts-history.json` is a JSON *array* (`[ {...}, {...} ]`) or a single pretty
printed object, convert it:

```bash
cd ~/soc-backend
python3 tools/import_eve_evidence.py \
    --source ~/project-evidence/phase1-suricata-baseline/eve-alerts-history.json \
    --out data/historical/eve-alerts-history.json \
    --dry-run
```

The importer accepts arrays, JSON Lines, single objects and `.gz` files, so it
handles whichever shape you have. Drop `--dry-run` to write it. For the genuine
rotated logs (the strongest evidence), import those instead:

```bash
sudo python3 tools/import_eve_evidence.py \
    --source /var/log/suricata/eve.json.1.gz \
    --source /var/log/suricata/eve.json.2.gz \
    --out data/historical/eve-alerts-history.json \
    --label "Suricata IDS+IPS baseline session"
```

**b) The API must be able to read the live log.** Suricata writes it as root.
Do **not** `chmod 777` a security log. Prefer a group or an ACL:

```bash
# option 1 — group (the packaged default on Debian/Kali)
sudo usermod -aG suricata "$USER"
newgrp suricata            # or log out and back in

# option 2 — ACL for a dedicated service account (better for anything long-lived)
sudo useradd --system --no-create-home --shell /usr/sbin/nologin socapi
sudo setfacl -m u:socapi:r /var/log/suricata/eve.json
sudo setfacl -m d:u:socapi:r /var/log/suricata/          # keep it for rotations
```

Never run the API as root. It does not need it: the service only ever reads files
you explicitly configure.

## Step 4 — Pre-flight and start

```bash
cd ~/soc-backend
source venv/bin/activate
python tools/verify_setup.py
```

Expected output on a healthy host: `[PASS]` for the historical source, the evidence
pack, the audit database; `[INFO]` for a live source that is legitimately empty;
and `[INFO]` for the sensor if Suricata is not currently running. Then:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
# docs: http://127.0.0.1:8000/docs
```

## Step 5 — Verify end to end

```bash
# 1. API healthy, sources labelled
curl -s localhost:8000/api/health | python3 -m json.tool

# 2. your evidence, with the real blocked event
curl -s "localhost:8000/api/alerts?action=blocked" | python3 -m json.tool

# 3. the dashboard's own path (through the Vite proxy)
curl -s localhost:5173/api/stats | python3 -m json.tool | head -20
```

Then, for the live half of the demonstration, follow
`docs/05_SURICATA_RULES_AND_SAFE_TESTING.md`: start the sensor **after** checking
the loaded rules and the firewall state, generate one authorised ICMP detection,
and watch the live counter move in the dashboard.

## Step 6 — Optional: run it as a service (no root, no reload)

```ini
# /etc/systemd/system/sentinel-soc.service
[Unit]
Description=SENTINEL SOC API
After=network.target

[Service]
Type=simple
User=socapi
WorkingDirectory=/home/socapi/soc-backend
EnvironmentFile=/home/socapi/soc-backend/.env
ExecStart=/home/socapi/soc-backend/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=on-failure
# harden what the process can touch
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/socapi/soc-backend/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now sentinel-soc
sudo systemctl status sentinel-soc --no-pager
```

Note what is **absent** above: no `CAP_NET_ADMIN`, no root, no writable `/etc`. The
default configuration cannot modify the firewall at all, which is the point.

## Step 7 — Enabling the response feature (only if you want it)

```bash
# .env
SOC_RESPONSE_MODE=dry_run                 # start here: renders commands, executes nothing
SOC_RESPONSE_ALLOWLIST=192.168.61.129     # the lab host you are allowed to manage
SOC_API_KEY=<a long random string>        # generates with: openssl rand -hex 32
SOC_ALLOW_WRITES=true
```

Then, on the host, create the dedicated chain **once, manually** if you intend to
enforce with iptables (the API appends to this chain; it never edits INPUT/OUTPUT):

```bash
sudo iptables -N SENTINEL_SOC 2>/dev/null || true
sudo iptables -C INPUT -j SENTINEL_SOC 2>/dev/null || sudo iptables -I INPUT -j SENTINEL_SOC
sudo iptables -L SENTINEL_SOC -n --line-numbers    # verify before trusting it
```

Move to `SOC_RESPONSE_MODE=enforce` only after a dry run looked correct, and keep
the rollback visible in the audit log. Rollback at any time:

```bash
curl -s localhost:8000/api/audit?limit=10 | python3 -m json.tool   # find the rollback preview
# or in the UI: Response & Audit → action_type = unblock_source_ip
```

## Step 8 — Packet Tracer evidence

Your `.pkt` file stays exactly as it is. To refresh the dashboard's network view
after re-verifying anything in Packet Tracer, edit
`~/soc-backend/data/cisco/network_evidence.json` — the schema is self-describing
and `docs/02_CISCO_TOPOLOGY.md` documents every field. Then:

```bash
curl -s "localhost:8000/api/network/status?force=true" | python3 -m json.tool | head -40
```

---

## Checklist

- [ ] `~/soc-backend` backup taken, new tree deployed, venv created, requirements installed
- [ ] `~/soc-dashboard-ui` deployed, `npm run typecheck` clean, dev server serving
- [ ] `.env` points at the real `/var/log/suricata/eve.json`
- [ ] `SOC_HISTORICAL_EVE_PATHS` points at your evidence file and the importer ran cleanly
- [ ] Read access to `eve.json` granted via group/ACL — **not** `chmod 777`, not root
- [ ] `tools/verify_setup.py` shows no `[FAIL]`
- [ ] `/api/health` shows the correct per-source states
- [ ] Dashboard shows **Live** and **Historical evidence** badges correctly
- [ ] Response mode is `recommend` or `dry_run` unless you deliberately enabled enforcement
- [ ] Suricata startup behaviour understood: rules validated, traffic path known, queue rule history checked
- [ ] The `.pkt` file is unchanged
- [ ] Screenshots captured per `docs/08`
