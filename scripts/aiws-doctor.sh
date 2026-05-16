#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib-env.sh
source "$REPO_ROOT/scripts/lib-env.sh"
aiws_load_env "$REPO_ROOT"
WORKSPACE_ROOT="${AIWS_ROOT:-$HOME/.ai-workspace}"

cd "$REPO_ROOT"

echo "AIWS repo: $REPO_ROOT"
echo "AIWS workspace: $WORKSPACE_ROOT"
echo "python3: $(command -v python3 || echo missing)"
echo "node: $(command -v node || echo missing)"
echo "npm: $(command -v npm || echo missing)"

if [[ -w "$(dirname "$WORKSPACE_ROOT")" || -w "$WORKSPACE_ROOT" ]]; then
  echo "workspace parent: writable"
else
  echo "workspace parent: not writable"
fi

if [[ -x "$REPO_ROOT/.venv/bin/aiws" ]]; then
  echo "aiws: $REPO_ROOT/.venv/bin/aiws"
else
  echo "aiws: missing. Run: python3 -m venv .venv && source .venv/bin/activate && pip install -e '.[dev]'"
fi

if [[ -f "$REPO_ROOT/.env" ]]; then
  echo ".env: present"
else
  echo ".env: missing. Run: cp .env.example .env"
fi

if [[ -n "${AIWS_SERVER_PASSWORD:-}" ]]; then
  echo "AIWS_SERVER_PASSWORD: configured"
else
  echo "AIWS_SERVER_PASSWORD: missing (required for server/tunnel mode)"
fi

for key in AIWS_GEMINI_API_KEY AIWS_KIMI_API_KEY MOONSHOT_API_KEY AIWS_OPENAI_API_KEY AIWS_ERNIE_API_KEY; do
  if [[ -n "${!key:-}" ]]; then
    echo "$key: configured"
  else
    echo "$key: missing"
  fi
done

if command -v ollama >/dev/null 2>&1; then
  echo "ollama: $(command -v ollama)"
  if ollama list >/dev/null 2>&1; then
    ollama list
    DEFAULT_MODEL="${AIWS_DEFAULT_MODEL:-qwen3:8b}"
    if ollama list | awk 'NR > 1 {print $1}' | grep -Fxq "$DEFAULT_MODEL"; then
      echo "default local model: $DEFAULT_MODEL present"
    else
      echo "default local model: $DEFAULT_MODEL missing. Run: ollama pull $DEFAULT_MODEL"
    fi
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

if command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared: $(cloudflared --version 2>/dev/null || command -v cloudflared)"
else
  echo "cloudflared: missing (optional). Run: brew install cloudflared"
fi

echo
echo "Model costs:"
if [[ -x "$REPO_ROOT/.venv/bin/aiws" ]]; then
  "$REPO_ROOT/.venv/bin/aiws" models costs --root "$WORKSPACE_ROOT" || true
fi
