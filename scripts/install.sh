#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required." >&2
  exit 1
fi

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"

if command -v npm >/dev/null 2>&1; then
  (cd web && npm install && npm run build)
else
  echo "npm not found; skipping web build. Install Node.js, then run: cd web && npm install && npm run build" >&2
fi

if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Set AIWS_SERVER_PASSWORD before server/tunnel mode."
fi

echo "AIWS install complete."
