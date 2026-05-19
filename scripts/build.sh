#!/usr/bin/env bash
set -euo pipefail

PYTHON_BIN="${PYTHON_BIN:-.venv/bin/python}"

"$PYTHON_BIN" -m compileall -q src

if [ -d web/node_modules ]; then
  npm --prefix web run build
else
  echo "Skipping frontend build; run npm --prefix web install first."
fi
