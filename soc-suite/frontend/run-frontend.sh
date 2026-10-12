#!/usr/bin/env bash
#
# Start the SENTINEL SOC dashboard (Vite dev server) on 0.0.0.0:5173.
#
#   ./run-frontend.sh                 # talks to the API via VITE_PROXY_TARGET
#   VITE_PROXY_TARGET=http://10.0.0.5:8000 ./run-frontend.sh
#
# The browser only ever calls /api/... on its own origin; this server proxies
# those requests to the FastAPI process, so no API host is baked into the bundle.

set -euo pipefail
cd "$(dirname "$0")"

export VITE_PROXY_TARGET="${VITE_PROXY_TARGET:-http://127.0.0.1:8000}"

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)…"
  npm install --no-audit --no-fund
fi

echo "Dashboard: http://127.0.0.1:5173   (API proxied to ${VITE_PROXY_TARGET})"
exec npm run dev
