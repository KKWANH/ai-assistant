#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib-env.sh
source "$REPO_ROOT/scripts/lib-env.sh"
aiws_load_env "$REPO_ROOT"

WORKSPACE_ROOT="${AIWS_ROOT:-$HOME/.ai-workspace}"
PORT="${AIWS_PORT:-8765}"
HOSTNAME="${AIWS_PUBLIC_HOSTNAME:-ai.kwanho.dev}"
TUNNEL_NAME="${AIWS_CLOUDFLARE_TUNNEL_NAME:-aiws}"
TUNNEL_CONFIG="${AIWS_CLOUDFLARE_TUNNEL_CONFIG:-$HOME/.cloudflared/aiws.yml}"
TUNNEL_TOKEN="${AIWS_CLOUDFLARE_TUNNEL_TOKEN:-}"
TUNNEL_TOKEN_FILE="${AIWS_CLOUDFLARE_TUNNEL_TOKEN_FILE:-}"
LOG_DIR="${AIWS_LOG_DIR:-$WORKSPACE_ROOT/logs}"
RUN_DIR="${AIWS_RUN_DIR:-$WORKSPACE_ROOT/run}"
GENERATED_TOKEN_FILE="$RUN_DIR/cloudflare-named-token"
SERVER_LOG="$LOG_DIR/aiws-cloudflare-named-server.log"
TUNNEL_LOG="$LOG_DIR/cloudflared-named.log"
SERVER_PID_FILE="$RUN_DIR/aiws-cloudflare-named-server.pid"
TUNNEL_PID_FILE="$RUN_DIR/aiws-cloudflare-named.pid"
URL_FILE="$RUN_DIR/cloudflare-named-url.txt"
STATUS_FILE="${AIWS_STATUS_PATH:-$WORKSPACE_ROOT/runtime-status.json}"
START_ADMIN_DASHBOARD="${AIWS_START_ADMIN_DASHBOARD:-true}"
ADMIN_PORT="${AIWS_ADMIN_PORT:-8790}"

mkdir -p "$LOG_DIR" "$RUN_DIR"

read_pid() {
  local file="$1"
  [[ -s "$file" ]] || return 1
  cat "$file"
}

pid_alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

server_pid() {
  read_pid "$SERVER_PID_FILE" 2>/dev/null || true
}

tunnel_pid() {
  read_pid "$TUNNEL_PID_FILE" 2>/dev/null || true
}

is_running() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && pid_alive "$(tunnel_pid)"
}

write_status() {
  local status="$1"
  local message="${2:-}"
  "$REPO_ROOT/.venv/bin/python" - "$STATUS_FILE" "$status" "$message" "$HOSTNAME" "$PORT" "$WORKSPACE_ROOT" "$(server_pid)" "$(tunnel_pid)" "$SERVER_LOG" "$TUNNEL_LOG" "$ADMIN_PORT" <<'PY'
import json
import sys
import time
from pathlib import Path

path = Path(sys.argv[1]).expanduser()
status, message, hostname, port, workspace = sys.argv[2:7]
server_pid = sys.argv[7] or None
tunnel_pid = sys.argv[8] or None
server_log, tunnel_log, admin_port = sys.argv[9:12]

payload = {
    "status": status,
    "message": message,
    "public_url": f"https://{hostname}",
    "cloudflare_url": f"https://{hostname}",
    "port": int(port),
    "workspace": workspace,
    "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "pids": {
        "server": int(server_pid) if server_pid else None,
        "cloudflared": int(tunnel_pid) if tunnel_pid else None,
    },
    "logs": {
        "server": server_log,
        "cloudflared": tunnel_log,
    },
    "admin_url": f"http://127.0.0.1:{admin_port}",
}
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
PY
}

require_ready() {
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "cloudflared is not installed. Run: brew install cloudflared" >&2
    exit 1
  fi
  if [[ -z "${AIWS_SERVER_PASSWORD:-}" ]]; then
    echo "AIWS_SERVER_PASSWORD is required. Put it in $REPO_ROOT/.env" >&2
    exit 1
  fi
  if [[ -z "$TUNNEL_TOKEN" && -z "$TUNNEL_TOKEN_FILE" && ! -f "$TUNNEL_CONFIG" ]]; then
    echo "Cloudflare tunnel config or token is missing." >&2
    echo "Set AIWS_CLOUDFLARE_TUNNEL_TOKEN in .env, or create: $TUNNEL_CONFIG" >&2
    exit 1
  fi
}

wait_for_port() {
  for _ in {1..80}; do
    if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

start() {
  require_ready
  if is_running; then
    echo "AIWS Cloudflare named tunnel is already running: pid $(tunnel_pid)"
    url
    return 0
  fi

  stop >/dev/null 2>&1 || true
  "$REPO_ROOT/scripts/aiws-stop.sh" >/dev/null 2>&1 || true
  rm -f "$URL_FILE"

  (
    cd "$REPO_ROOT"
    exec "$REPO_ROOT/.venv/bin/python" -m aiws.cli run \
      --root "$WORKSPACE_ROOT" \
      --mode server \
      --port "$PORT" \
      --password "$AIWS_SERVER_PASSWORD" \
      --models "${AIWS_MODELS:-ollama}" \
      --idle-timeout "${AIWS_MODEL_IDLE_TIMEOUT:-1800}" \
      --status-path "${AIWS_LOCAL_RUNTIME_STATUS_PATH:-$RUN_DIR/aiws-runtime-status.json}"
  ) >"$SERVER_LOG" 2>&1 &
  echo "$!" > "$SERVER_PID_FILE"

  echo "Starting AIWS server on port $PORT..."
  if ! wait_for_port; then
    echo "AIWS did not start. Log: $SERVER_LOG" >&2
    tail -n 80 "$SERVER_LOG" >&2 || true
    write_status "failed" "AIWS server did not open the port."
    exit 1
  fi

  if [[ "$START_ADMIN_DASHBOARD" != "0" && "$START_ADMIN_DASHBOARD" != "false" && "$START_ADMIN_DASHBOARD" != "no" ]]; then
    "$REPO_ROOT/scripts/aiws-admin-dashboard.sh" start >/dev/null 2>&1 || true
  fi

  local token_file=""
  if [[ -n "$TUNNEL_TOKEN_FILE" ]]; then
    token_file="$TUNNEL_TOKEN_FILE"
  elif [[ -n "$TUNNEL_TOKEN" ]]; then
    printf '%s' "$TUNNEL_TOKEN" > "$GENERATED_TOKEN_FILE"
    chmod 600 "$GENERATED_TOKEN_FILE"
    token_file="$GENERATED_TOKEN_FILE"
  fi

  "$REPO_ROOT/.venv/bin/python" - "$token_file" "$TUNNEL_LOG" "$TUNNEL_PID_FILE" "$TUNNEL_CONFIG" "$TUNNEL_NAME" "${AIWS_CLOUDFLARED_PROTOCOL:-http2}" <<'PY'
import os
import subprocess
import sys
from pathlib import Path

token_file, log_path, pid_path, config_path, tunnel_name, protocol = sys.argv[1:7]
if token_file:
    command = ["cloudflared", "tunnel", "run", "--protocol", protocol, "--token-file", token_file]
else:
    command = ["cloudflared", "tunnel", "--config", config_path, "run", tunnel_name]

env = os.environ.copy()
env.pop("AIWS_CLOUDFLARE_TUNNEL_TOKEN", None)
Path(log_path).parent.mkdir(parents=True, exist_ok=True)
log = Path(log_path).open("ab", buffering=0)
process = subprocess.Popen(
    command,
    stdout=log,
    stderr=subprocess.STDOUT,
    stdin=subprocess.DEVNULL,
    start_new_session=True,
    close_fds=True,
    env=env,
)
Path(pid_path).write_text(str(process.pid) + "\n", encoding="utf-8")
PY
  echo "https://$HOSTNAME" > "$URL_FILE"

  echo "Starting Cloudflare named tunnel for https://$HOSTNAME..."
  for _ in {1..40}; do
    if ! pid_alive "$(tunnel_pid)"; then
      echo "cloudflared exited during startup. Log: $TUNNEL_LOG" >&2
      tail -n 80 "$TUNNEL_LOG" >&2 || true
      write_status "failed" "cloudflared exited during startup."
      exit 1
    fi
    if grep -E "Registered tunnel connection|Connection.*registered" "$TUNNEL_LOG" >/dev/null 2>&1; then
      write_status "running" "Cloudflare named tunnel is running."
      url
      return 0
    fi
    sleep 0.5
  done

  write_status "running" "cloudflared is running; endpoint may still be provisioning."
  url
}

stop() {
  for pid in "$(tunnel_pid)" "$(server_pid)"; do
    if pid_alive "$pid"; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  pkill -f "cloudflared tunnel --config .* run $TUNNEL_NAME" 2>/dev/null || true
  pkill -f "cloudflared tunnel run --token" 2>/dev/null || true
  pkill -f "cloudflared tunnel run --token-file" 2>/dev/null || true
  rm -f "$TUNNEL_PID_FILE" "$SERVER_PID_FILE" "$URL_FILE"
  "$REPO_ROOT/scripts/aiws-admin-dashboard.sh" stop >/dev/null 2>&1 || true
  write_status "stopped" "Cloudflare named tunnel stopped."
  echo "Stopped AIWS Cloudflare named tunnel."
}

status() {
  if is_running; then
    echo "running server=$(server_pid) cloudflared=$(tunnel_pid)"
    url
  else
    echo "stopped"
  fi
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN || true
  "$REPO_ROOT/scripts/aiws-admin-dashboard.sh" status || true
}

url() {
  echo "https://$HOSTNAME"
}

logs() {
  tail -n "${2:-120}" "$SERVER_LOG" "$TUNNEL_LOG" 2>/dev/null || true
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  reboot) stop; start ;;
  status) status ;;
  url) url ;;
  logs) logs "$@" ;;
  *)
    echo "Usage: aiws-cloudflare-named [start|stop|restart|reboot|status|url|logs]" >&2
    exit 2
    ;;
esac
