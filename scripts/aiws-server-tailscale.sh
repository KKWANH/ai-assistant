#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib-env.sh
source "$REPO_ROOT/scripts/lib-env.sh"
aiws_load_env "$REPO_ROOT"
WORKSPACE_ROOT="${AIWS_ROOT:-$HOME/.ai-workspace}"
PORT="${AIWS_PORT:-8765}"

cd "$REPO_ROOT"
source "$REPO_ROOT/.venv/bin/activate"
args=(
  aiws run
  --root "$WORKSPACE_ROOT" \
  --mode server \
  --port "$PORT" \
  --models "${AIWS_MODELS:-ollama}" \
  --idle-timeout "${AIWS_MODEL_IDLE_TIMEOUT:-1800}" \
  --status-path "${AIWS_STATUS_PATH:-$WORKSPACE_ROOT/runtime-status.json}"
)

if [[ -n "${AIWS_SERVER_PASSWORD:-}" ]]; then
  args+=(--password "$AIWS_SERVER_PASSWORD")
fi

exec "${args[@]}"
