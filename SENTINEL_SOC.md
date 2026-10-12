# SENTINEL SOC — see `soc-suite/`

This repository also contains **SENTINEL SOC**, a self-contained cybersecurity
deliverable (Suricata IDS/IPS evidence + Cisco Packet Tracer network evidence +
FastAPI backend + React SOC dashboard). It is an independent project tree and does
not interact with the Next.js application at the repository root.

* **Start here:** [`soc-suite/README.md`](soc-suite/README.md)
* **Run it:** `cd soc-suite && ./start-demo.sh` → dashboard on
  `http://127.0.0.1:5173`, API docs on `http://127.0.0.1:8000/docs`
* **Backend:** `soc-suite/backend` (FastAPI, 47 tests — `./.venv/bin/python -m pytest tests/ -q`)
* **Frontend:** `soc-suite/frontend` (React + TypeScript + Vite, 8 pages)
* **Documentation:** `soc-suite/docs/01…13` — architecture, Cisco topology, API
  reference, frontend guide, Suricata rules and safe testing, data flow, test plan
  and results, evidence/screenshots, limitations, demo script, LinkedIn summary,
  integration onto your own machine, and the learning modules
* **Evidence baseline:** `soc-suite/evidence/phase1-suricata-baseline/`

The design rule the whole project follows: live sensor telemetry, historical
sensor evidence, and Packet Tracer simulation evidence are labelled separately
everywhere they appear, and are never blended.
