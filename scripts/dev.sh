#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source "$REPO_ROOT/.venv/bin/activate"
aiws run --root "${AIWS_ROOT:-$HOME/.ai-workspace}" --mode local --port "${AIWS_PORT:-8765}" --models "${AIWS_MODELS:-ollama}"
