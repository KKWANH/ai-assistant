#!/usr/bin/env bash
set -euo pipefail

PYTHON_BIN="${PYTHON_BIN:-.venv/bin/python}"

"$PYTHON_BIN" --version
"$PYTHON_BIN" -m pytest --version
"$PYTHON_BIN" -m ruff --version
command -v node || true
command -v npm || true
command -v cloudflared || true
