#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib-env.sh
source "$REPO_ROOT/scripts/lib-env.sh"
aiws_load_env "$REPO_ROOT"

WORKSPACE_ROOT="${AIWS_ROOT:-$HOME/.ai-workspace}"
RUN_DIR="${AIWS_RUN_DIR:-$WORKSPACE_ROOT/run}"
LOG_DIR="${AIWS_LOG_DIR:-$WORKSPACE_ROOT/logs}"
PORT="${AIWS_ADMIN_PORT:-8790}"
PID_FILE="$RUN_DIR/aiws-admin-dashboard.pid"
LOG_FILE="$LOG_DIR/aiws-admin-dashboard.log"

mkdir -p "$RUN_DIR" "$LOG_DIR"

is_running() {
  [[ -s "$PID_FILE" ]] || return 1
  kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

start() {
  if is_running; then
    echo "AIWS admin dashboard is already running: http://127.0.0.1:$PORT"
    return 0
  fi
  "$REPO_ROOT/.venv/bin/python" - "$REPO_ROOT" "$WORKSPACE_ROOT" "$PORT" "$LOG_FILE" "$PID_FILE" <<'PY'
import subprocess
import sys
from pathlib import Path

repo = Path(sys.argv[1])
workspace = sys.argv[2]
port = sys.argv[3]
log_path = Path(sys.argv[4])
pid_path = Path(sys.argv[5])
log_path.parent.mkdir(parents=True, exist_ok=True)
log = log_path.open("ab", buffering=0)
process = subprocess.Popen(
    [str(repo / ".venv" / "bin" / "python"), "-m", "aiws.admin_monitor", "--root", workspace, "--port", port],
    cwd=str(repo),
    stdout=log,
    stderr=subprocess.STDOUT,
    stdin=subprocess.DEVNULL,
    start_new_session=True,
    close_fds=True,
)
pid_path.write_text(str(process.pid) + "\n", encoding="utf-8")
PY
  echo "Started AIWS admin dashboard: http://127.0.0.1:$PORT"
}

stop() {
  if is_running; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  echo "Stopped AIWS admin dashboard."
}

status() {
  if is_running; then
    echo "running pid $(cat "$PID_FILE")"
    echo "url http://127.0.0.1:$PORT"
  else
    echo "stopped"
  fi
}

snapshot() {
  (
    cd "$REPO_ROOT"
    exec "$REPO_ROOT/.venv/bin/python" -m aiws.admin_monitor --root "$WORKSPACE_ROOT" --snapshot
  )
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  url) echo "http://127.0.0.1:$PORT" ;;
  snapshot) snapshot ;;
  *)
    echo "Usage: aiws-admin-dashboard [start|stop|restart|status|url|snapshot]" >&2
    exit 2
    ;;
esac
