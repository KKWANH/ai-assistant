#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_ROOT="${AIWS_ROOT:-$HOME/.ai-workspace}"

cd "$REPO_ROOT"

echo "AIWS repo: $REPO_ROOT"
echo "AIWS workspace: $WORKSPACE_ROOT"

if [[ -x "$REPO_ROOT/.venv/bin/aiws" ]]; then
  echo "aiws: $REPO_ROOT/.venv/bin/aiws"
else
  echo "aiws: missing. Run: python3 -m venv .venv && source .venv/bin/activate && pip install -e '.[dev]'"
fi

if command -v ollama >/dev/null 2>&1; then
  echo "ollama: $(command -v ollama)"
  if ollama list >/dev/null 2>&1; then
    ollama list
  else
    echo "ollama server is not running. Run: ollama serve"
  fi
else
  echo "ollama: missing. Run: brew install ollama"
fi

if command -v tailscale >/dev/null 2>&1; then
  echo "tailscale: $(command -v tailscale)"
  tailscale status || true
elif [[ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]]; then
  echo "tailscale: /Applications/Tailscale.app/Contents/MacOS/Tailscale"
  /Applications/Tailscale.app/Contents/MacOS/Tailscale status || true
else
  echo "tailscale: missing. Install Tailscale.app and log in."
fi

echo
echo "Model costs:"
"$REPO_ROOT/.venv/bin/aiws" models costs --root "$WORKSPACE_ROOT" || true
