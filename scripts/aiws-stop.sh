#!/usr/bin/env bash
set -euo pipefail

for port in "${AIWS_PORT:-8765}" 11434; do
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    kill $pids 2>/dev/null || true
  fi
done

pkill -f "/Volumes/kwanhokim/workspace/ai/.venv/bin/aiws run" 2>/dev/null || true
pkill -f "/Volumes/kwanhokim/workspace/ai/.venv/bin/aiws ui start" 2>/dev/null || true

echo "Stopped AIWS local runtime processes."
