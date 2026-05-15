#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib-env.sh
source "$REPO_ROOT/scripts/lib-env.sh"
aiws_load_env "$REPO_ROOT"

WORKSPACE_ROOT="${AIWS_ROOT:-$HOME/.ai-workspace}"
LOG_DIR="${AIWS_LOG_DIR:-$WORKSPACE_ROOT/logs}"
RUN_DIR="${AIWS_RUN_DIR:-$WORKSPACE_ROOT/run}"
PID_FILE="$RUN_DIR/aiws-cloudflare-monitor.pid"
STOP_FILE="$RUN_DIR/aiws-cloudflare.stop"
URL_FILE="$RUN_DIR/cloudflare-url.txt"
MONITOR_LOG="$LOG_DIR/aiws-cloudflare-monitor.log"
STATUS_FILE="${AIWS_STATUS_PATH:-$WORKSPACE_ROOT/runtime-status.json}"
PLIST="$HOME/Library/LaunchAgents/com.aiws.cloudflare.plist"
LAUNCH_LABEL="com.aiws.cloudflare"

mkdir -p "$LOG_DIR" "$RUN_DIR"

is_running() {
  local pid=""
  if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  pid="$(status_daemon_pid)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    echo "$pid" > "$PID_FILE"
    return 0
  fi
  return 1
}

status_daemon_pid() {
  [[ -s "$STATUS_FILE" ]] || return 0
  "$REPO_ROOT/.venv/bin/python" - "$STATUS_FILE" <<'PY' 2>/dev/null || true
import json
import sys
from pathlib import Path

try:
    payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
except Exception:
    raise SystemExit(0)
pid = (payload.get("pids") or {}).get("daemon")
print(pid or "")
PY
}

tunnel_url_resolves() {
  [[ -s "$URL_FILE" ]] || return 1
  local host=""
  host="$("$REPO_ROOT/.venv/bin/python" - "$(cat "$URL_FILE")" <<'PY' 2>/dev/null || true
import sys
from urllib.parse import urlparse

print(urlparse(sys.argv[1]).hostname or "")
PY
)"
  [[ -n "$host" ]] || return 1
  if "$REPO_ROOT/.venv/bin/python" - "$host" <<'PY' 2>/dev/null; then
import socket
import sys

try:
    socket.getaddrinfo(sys.argv[1], 443)
except OSError:
    raise SystemExit(1)
PY
    return 0
  fi
  if command -v dig >/dev/null 2>&1; then
    [[ -n "$(dig @1.1.1.1 +short "$host" 2>/dev/null | head -n 1)" ]]
    return $?
  fi
  return 1
}

start() {
  if is_running; then
    if tunnel_url_resolves; then
      echo "AIWS Cloudflare daemon is already running: pid $(cat "$PID_FILE")"
      url
      return 0
    fi
    echo "AIWS Cloudflare daemon has a stale tunnel URL; restarting..."
    stop
  fi
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "cloudflared is not installed. Run: brew install cloudflared" >&2
    exit 1
  fi
  if [[ -z "${AIWS_SERVER_PASSWORD:-}" ]]; then
    echo "AIWS_SERVER_PASSWORD is required. Put it in $REPO_ROOT/.env" >&2
    exit 1
  fi
  rm -f "$STOP_FILE"
  rm -f "$URL_FILE"
  if [[ "$(uname -s)" == "Darwin" ]] && command -v launchctl >/dev/null 2>&1; then
    install_launch_agent
    launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
    if launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1; then
      echo "Started AIWS Cloudflare LaunchAgent: $LAUNCH_LABEL"
    else
      echo "LaunchAgent start failed; falling back to detached process."
      start_detached_process
    fi
  else
    start_detached_process
  fi
  echo "Waiting for quick tunnel URL..."
  for _ in {1..60}; do
    if [[ -s "$URL_FILE" ]]; then
      url
      return 0
    fi
    sleep 0.5
  done
  echo "Daemon started, but URL is not ready yet. Run: aiws-cloudflare logs"
}

start_detached_process() {
  "$REPO_ROOT/.venv/bin/python" - "$REPO_ROOT" "$MONITOR_LOG" "$PID_FILE" <<'PY'
import os
import subprocess
import sys
from pathlib import Path

repo = Path(sys.argv[1])
log_path = Path(sys.argv[2])
pid_path = Path(sys.argv[3])
log_path.parent.mkdir(parents=True, exist_ok=True)
log = log_path.open("ab", buffering=0)
process = subprocess.Popen(
    [str(repo / ".venv" / "bin" / "python"), "-m", "aiws.cloudflare_daemon"],
    cwd=str(repo),
    stdout=log,
    stderr=subprocess.STDOUT,
    stdin=subprocess.DEVNULL,
    start_new_session=True,
    close_fds=True,
)
pid_path.write_text(str(process.pid) + "\n", encoding="utf-8")
PY
  echo "Started AIWS Cloudflare daemon: pid $(cat "$PID_FILE")"
}

install_launch_agent() {
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LAUNCH_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$REPO_ROOT/.venv/bin/python</string>
    <string>-m</string>
    <string>aiws.cloudflare_daemon</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$REPO_ROOT</string>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/aiws-cloudflare-launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/aiws-cloudflare-launchd.err.log</string>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
PLIST
}

stop() {
  touch "$STOP_FILE"
  if [[ "$(uname -s)" == "Darwin" ]] && command -v launchctl >/dev/null 2>&1; then
    launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
  fi
  if is_running; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    for _ in {1..30}; do
      if ! is_running; then break; fi
      sleep 0.2
    done
  fi
  status_pid="$(status_daemon_pid)"
  if [[ -n "$status_pid" ]]; then
    kill "$status_pid" 2>/dev/null || true
  fi
  "$REPO_ROOT/scripts/aiws-stop.sh" >/dev/null 2>&1 || true
  rm -f "$PID_FILE"
  echo "Stopped AIWS Cloudflare daemon."
}

status() {
  if is_running; then
    echo "running pid $(cat "$PID_FILE")"
  else
    echo "stopped"
  fi
  if [[ -s "$STATUS_FILE" ]]; then
    "$REPO_ROOT/.venv/bin/python" - "$STATUS_FILE" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
try:
    payload = json.loads(path.read_text(encoding="utf-8"))
except Exception as exc:
    print(f"status_file_error {exc}")
else:
    print(f"runtime_status {payload.get('status', 'unknown')}")
    if payload.get("message"):
        print(f"message {payload['message']}")
    if payload.get("cloudflare_url"):
        print(f"url {payload['cloudflare_url']}")
    pids = payload.get("pids") or {}
    print(f"pids daemon={pids.get('daemon')} server={pids.get('server')} cloudflared={pids.get('cloudflared')}")
PY
  elif [[ -s "$URL_FILE" ]]; then
    echo "stale_url $(cat "$URL_FILE")"
  fi
  lsof -nP -iTCP:"${AIWS_PORT:-8765}" -sTCP:LISTEN || true
}

url() {
  if [[ -s "$URL_FILE" ]]; then
    cat "$URL_FILE"
  else
    echo "No Cloudflare URL yet."
    return 1
  fi
}

logs() {
  tail -n "${2:-120}" "$MONITOR_LOG" "$LOG_DIR/aiws-server.log" "$LOG_DIR/cloudflared.log" 2>/dev/null || true
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  reboot) stop; start ;;
  status) status ;;
  url) url ;;
  logs) logs "$@" ;;
  foreground) exec "$REPO_ROOT/scripts/aiws-cloudflare-quick.sh" ;;
  *)
    echo "Usage: aiws-cloudflare [start|stop|restart|reboot|status|url|logs|foreground]" >&2
    exit 2
    ;;
esac
