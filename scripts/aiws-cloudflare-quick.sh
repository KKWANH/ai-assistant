#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib-env.sh
source "$REPO_ROOT/scripts/lib-env.sh"
aiws_load_env "$REPO_ROOT"
WORKSPACE_ROOT="${AIWS_ROOT:-$HOME/.ai-workspace}"
PORT="${AIWS_PORT:-8765}"
LOG_DIR="$WORKSPACE_ROOT/logs"
AIWS_LOG="$LOG_DIR/aiws-cloudflare-server.log"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed. Run: brew install cloudflared" >&2
  exit 1
fi

if [[ -z "${AIWS_SERVER_PASSWORD:-}" ]]; then
  echo "AIWS_SERVER_PASSWORD is required before exposing AIWS through Cloudflare." >&2
  echo "Set it with:" >&2
  echo "  export AIWS_SERVER_PASSWORD='choose-a-long-password'" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"

"$REPO_ROOT/scripts/aiws-stop.sh" >/dev/null 2>&1 || true

(
  cd "$REPO_ROOT"
  source "$REPO_ROOT/.venv/bin/activate"
  exec aiws run \
    --root "$WORKSPACE_ROOT" \
    --mode server \
    --port "$PORT" \
    --password "$AIWS_SERVER_PASSWORD" \
    --models "${AIWS_MODELS:-ollama}" \
    --idle-timeout "${AIWS_MODEL_IDLE_TIMEOUT:-1800}" \
    --status-path "${AIWS_STATUS_PATH:-$WORKSPACE_ROOT/runtime-status.json}"
) >"$AIWS_LOG" 2>&1 &

echo "Starting AIWS server on port $PORT..."
for _ in {1..40}; do
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

if ! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "AIWS did not start. Log: $AIWS_LOG" >&2
  tail -n 80 "$AIWS_LOG" >&2 || true
  exit 1
fi

echo "AIWS is running with password auth."
echo "Opening a temporary Cloudflare URL for http://127.0.0.1:$PORT"
echo "Keep this terminal open while using the public URL."
exec cloudflared tunnel --protocol "${AIWS_CLOUDFLARED_PROTOCOL:-http2}" --url "http://127.0.0.1:$PORT"
