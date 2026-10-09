#!/usr/bin/env bash
# Run the browser E2E flow against a fresh instance with a real model provider.
# Usage: EXP_LABS_API_KEY=... scripts/e2e.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${EXP_LABS_API_KEY:?EXP_LABS_API_KEY must be set}"
PY="${PYTHON:-python}"
DATA="$(mktemp -d)"
LOG="$DATA/server.log"
PORT="${SCA_E2E_PORT:-8100}"
if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
  echo "port $PORT is already serving something; stop it or set SCA_E2E_PORT" >&2; exit 1
fi
(cd "$ROOT/frontend" && npm run build >/dev/null)
(cd "$ROOT/backend" && exec env -u EXP_LABS_API_KEY SCA_DATA_DIR="$DATA" SCA_INTERNAL_BASE_URL="http://127.0.0.1:$PORT" \
  "$PY" -m uvicorn sca.main:app --host 127.0.0.1 --port "$PORT" >"$LOG" 2>&1) &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true; wait $SERVER 2>/dev/null || true; rm -rf "$DATA"' EXIT
for _ in $(seq 1 60); do curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break; sleep 1; done
cd "$ROOT/frontend"
SCA_E2E_URL="http://127.0.0.1:$PORT" SCA_E2E_LOG="$LOG" npx playwright test "$@"
