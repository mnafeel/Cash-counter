#!/bin/bash
# Reliable local dev: free port, sync index.html, start Vite (use from project root).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${VITE_PORT:-5173}"
HOST="${VITE_HOST:-127.0.0.1}"

echo "Stopping anything on port ${PORT}…"
lsof -ti:"$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true

# Stuck background builds from earlier runs can block CPU and delay Vite for minutes.
pkill -f "${ROOT}/node_modules/.bin/vite" 2>/dev/null || true
pkill -f "${ROOT}.*tsc -b" 2>/dev/null || true

cp -f index.vite.html index.html

URL="http://${HOST}:${PORT}/"
echo "Starting Vite…"
echo "First start can take 1–2 minutes while dependencies are optimized."
echo "Do not open the app until you see \"ready\" below."
echo ""

node node_modules/vite/bin/vite.js --host "$HOST" --port "$PORT" --clearScreen false &
VITE_PID=$!

cleanup() {
  kill "$VITE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

READY=0
for _ in $(seq 1 120); do
  if curl -sf -o /dev/null --connect-timeout 1 "$URL" 2>/dev/null; then
    READY=1
    echo ""
    echo "✓ Dev server is up → ${URL}"
    break
  fi
  if ! kill -0 "$VITE_PID" 2>/dev/null; then
    echo "Vite exited before the server was ready. Check errors above."
    exit 1
  fi
  sleep 1
done

if [ "$READY" -eq 0 ]; then
  echo ""
  echo "Still starting… open ${URL} when Vite prints \"ready\" above."
fi

wait "$VITE_PID"
