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

echo "Starting Vite (first start can take 1–2 min on a slow machine)…"
echo "Open: http://${HOST}:${PORT}/"
exec node node_modules/vite/bin/vite.js --host "$HOST" --port "$PORT" --clearScreen false
