#!/usr/bin/env bash
#
# Start the SENTINEL SOC API.
#
#   ./run-backend.sh                 # development, reload enabled
#   ./run-backend.sh --no-reload     # stable run (recommended for a demo)
#   HOST=0.0.0.0 PORT=8000 ./run-backend.sh
#
# The script never touches Suricata and never writes firewall rules. It only
# starts the read-only API, which reads the configured EVE files.

set -euo pipefail

cd "$(dirname "$0")"

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
RELOAD="--reload"
for arg in "$@"; do
  case "$arg" in
    --no-reload) RELOAD="" ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -12
      exit 0
      ;;
  esac
done

if [ ! -d .venv ]; then
  echo "Creating virtual environment…"
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

echo "Checking dependencies…"
python - <<'PY'
import importlib
missing = [m for m in ("fastapi", "uvicorn", "pydantic") if importlib.util.find_spec(m) is None]
if missing:
    raise SystemExit("missing: " + ", ".join(missing))
print("  fastapi / uvicorn / pydantic present")
PY

# Fail fast with a clear message rather than a traceback mid-demo.
if ! python -c "import sys; sys.path.insert(0,'.'); import app.main" 2>/tmp/sentinel-import-error.log; then
  echo "ERROR: the application failed to import:"
  cat /tmp/sentinel-import-error.log
  exit 1
fi

echo
echo "Pre-flight:"
python tools/verify_setup.py || true
echo
echo "Starting API on http://${HOST}:${PORT}   (docs: http://127.0.0.1:${PORT}/docs)"
echo

exec uvicorn app.main:app --host "$HOST" --port "$PORT" ${RELOAD}
