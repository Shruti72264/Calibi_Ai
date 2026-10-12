#!/usr/bin/env bash
#
# Start the whole SENTINEL SOC demonstration: API + dashboard.
#
#   ./start-demo.sh
#
# Prints the two URLs, streams both logs to ./logs, and stops both processes on
# Ctrl+C. Nothing here modifies Suricata, iptables or any Cisco device.

set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"

BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

cleanup() {
  echo
  echo "Stopping…"
  [ -n "${BACKEND_PID:-}" ] && kill "$BACKEND_PID" 2>/dev/null || true
  [ -n "${FRONTEND_PID:-}" ] && kill "$FRONTEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  echo "Stopped. Logs are in $LOG_DIR"
}
trap cleanup EXIT INT TERM

echo "=== SENTINEL SOC ==="
echo "backend : http://127.0.0.1:${BACKEND_PORT}  (docs: /docs)"
echo "frontend: http://127.0.0.1:${FRONTEND_PORT}"
echo

# --- backend ----------------------------------------------------------------
cd "$ROOT/backend"
if [ ! -d .venv ]; then
  echo "Creating backend virtual environment…"
  python3 -m venv .venv
  ./.venv/bin/pip install --quiet --upgrade pip
  ./.venv/bin/pip install --quiet -r requirements.txt
fi

echo "Starting API…"
(
  cd "$ROOT/backend"
  set -a
  [ -f .env ] && . ./.env
  set +a
  exec ./.venv/bin/uvicorn app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT"
) >"$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

# Wait for the API to answer before starting the UI, so the first page load is
# already showing real data rather than an error state.
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/health" >/dev/null 2>&1; then
    echo "  API is answering /api/health"
    break
  fi
  sleep 0.5
done

# --- frontend ---------------------------------------------------------------
cd "$ROOT/frontend"
if [ ! -d node_modules ]; then
  echo "Installing frontend dependencies (first run only)…"
  npm install --no-audit --no-fund
fi

echo "Starting dashboard…"
VITE_PROXY_TARGET="http://127.0.0.1:${BACKEND_PORT}" npm run dev -- --port "$FRONTEND_PORT" \
  >"$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${FRONTEND_PORT}/" >/dev/null 2>&1; then
    echo "  dashboard is serving on port ${FRONTEND_PORT}"
    break
  fi
  sleep 0.5
done

echo
echo "Open:  http://127.0.0.1:${FRONTEND_PORT}"
echo "API:   http://127.0.0.1:${BACKEND_PORT}/docs"
echo "Logs:  tail -f $LOG_DIR/backend.log $LOG_DIR/frontend.log"
echo
echo "Press Ctrl+C to stop both."
wait
