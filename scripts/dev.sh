#!/usr/bin/env bash
set -euo pipefail

PYTHON_BIN="${PYTHON_BIN:-.venv/bin/python}"
PORT="${PORT:-8787}"

"$PYTHON_BIN" -m uvicorn aiws.api.app:app --host 127.0.0.1 --port "$PORT" --reload
