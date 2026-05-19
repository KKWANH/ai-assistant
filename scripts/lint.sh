#!/usr/bin/env bash
set -euo pipefail

PYTHON_BIN="${PYTHON_BIN:-.venv/bin/python}"

"$PYTHON_BIN" -m ruff check src tests
"$PYTHON_BIN" -m mypy src

if [ -d web/node_modules ]; then
  npm --prefix web run typecheck
else
  echo "Skipping frontend typecheck; run npm --prefix web install first."
fi
