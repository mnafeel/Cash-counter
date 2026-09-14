#!/bin/bash
# Keeps the Vite dev server running — restarts if it stops.
cd "$(dirname "$0")/.."
cp -f index.vite.html index.html

PORT=5173
while true; do
  lsof -ti:"$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
  pkill -f "$(pwd)/node_modules/.bin/vite" 2>/dev/null || true
  echo "Starting dev server on http://127.0.0.1:${PORT}/"
  node node_modules/vite/bin/vite.js --host 127.0.0.1 --port "$PORT" --clearScreen false || true
  echo "Dev server stopped. Restarting in 2s..."
  sleep 2
  # Free port if something is stuck
  lsof -ti:"$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 1
done
