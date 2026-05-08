#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib-env.sh
source "$REPO_ROOT/scripts/lib-env.sh"
aiws_load_env "$REPO_ROOT"

for port in "${AIWS_PORT:-8765}" 11434; do
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    kill $pids 2>/dev/null || true
  fi
done

pkill -f "/Volumes/kwanhokim/workspace/ai/.venv/bin/aiws run" 2>/dev/null || true
pkill -f "/Volumes/kwanhokim/workspace/ai/.venv/bin/aiws ui start" 2>/dev/null || true
pkill -f "cloudflared tunnel --url http://127.0.0.1:${AIWS_PORT:-8765}" 2>/dev/null || true
pkill -f "$REPO_ROOT/scripts/aiws-cloudflare-monitor.sh" 2>/dev/null || true

echo "Stopped AIWS local runtime processes."
