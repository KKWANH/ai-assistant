#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib-env.sh
source "$REPO_ROOT/scripts/lib-env.sh"
aiws_load_env "$REPO_ROOT"

WORKSPACE_ROOT="${AIWS_ROOT:-$HOME/.ai-workspace}"
PORT="${AIWS_PORT:-8765}"
LOG_DIR="${AIWS_LOG_DIR:-$WORKSPACE_ROOT/logs}"
RUN_DIR="${AIWS_RUN_DIR:-$WORKSPACE_ROOT/run}"
SERVER_LOG="$LOG_DIR/aiws-server.log"
TUNNEL_LOG="$LOG_DIR/cloudflared.log"
MONITOR_LOG="$LOG_DIR/aiws-cloudflare-monitor.log"
URL_FILE="$RUN_DIR/cloudflare-url.txt"
STOP_FILE="$RUN_DIR/aiws-cloudflare.stop"

mkdir -p "$LOG_DIR" "$RUN_DIR"
rm -f "$STOP_FILE"

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >> "$MONITOR_LOG"
}

kill_children() {
  if [[ -n "${SERVER_PID:-}" ]]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  if [[ -n "${TUNNEL_PID:-}" ]]; then kill "$TUNNEL_PID" 2>/dev/null || true; fi
  wait "${SERVER_PID:-}" 2>/dev/null || true
  wait "${TUNNEL_PID:-}" 2>/dev/null || true
}

trap 'touch "$STOP_FILE"; kill_children; exit 0' INT TERM

if [[ -z "${AIWS_SERVER_PASSWORD:-}" ]]; then
  log "AIWS_SERVER_PASSWORD is required. Put it in $REPO_ROOT/.env"
  exit 1
fi

while [[ ! -f "$STOP_FILE" ]]; do
  log "starting AIWS server on port $PORT"
  (
    cd "$REPO_ROOT"
    source "$REPO_ROOT/.venv/bin/activate"
    exec aiws run \
      --root "$WORKSPACE_ROOT" \
      --mode server \
      --port "$PORT" \
      --password "$AIWS_SERVER_PASSWORD" \
      --models "${AIWS_MODELS:-ollama}" \
      --idle-timeout "${AIWS_MODEL_IDLE_TIMEOUT:-1800}" \
      --status-path "${AIWS_STATUS_PATH:-$WORKSPACE_ROOT/runtime-status.json}"
  ) >>"$SERVER_LOG" 2>&1 &
  SERVER_PID=$!

  for _ in {1..80}; do
    if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done

  if ! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    log "AIWS server did not open port $PORT; restarting"
    kill_children
    sleep 3
    continue
  fi

  log "starting cloudflared quick tunnel"
  : > "$TUNNEL_LOG"
  rm -f "$URL_FILE"
  cloudflared tunnel --protocol "${AIWS_CLOUDFLARED_PROTOCOL:-http2}" --url "http://127.0.0.1:$PORT" >>"$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!

  for _ in {1..80}; do
    if grep -Eo 'https://[^[:space:]]+trycloudflare.com' "$TUNNEL_LOG" | tail -n 1 > "$URL_FILE.tmp"; then
      if [[ -s "$URL_FILE.tmp" ]]; then
        mv "$URL_FILE.tmp" "$URL_FILE"
        break
      fi
    fi
    rm -f "$URL_FILE.tmp"
    if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
      break
    fi
    sleep 0.25
  done
  rm -f "$URL_FILE.tmp"
  HEALTH_FAILURES=0

  while [[ ! -f "$STOP_FILE" ]]; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      log "AIWS server exited; restarting pair"
      break
    fi
    if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
      log "cloudflared exited; restarting pair"
      break
    fi
    if [[ "${AIWS_CLOUDFLARE_HEALTHCHECK:-0}" == "1" && -s "$URL_FILE" ]]; then
      if curl -L --max-time 12 -fsS "$(cat "$URL_FILE")" >/dev/null 2>&1; then
        HEALTH_FAILURES=0
      else
        HEALTH_FAILURES=$((HEALTH_FAILURES + 1))
        log "cloudflared URL health check failed ($HEALTH_FAILURES/3): $(cat "$URL_FILE")"
        if [[ "$HEALTH_FAILURES" -ge 3 ]]; then
          log "cloudflared URL is not reachable; restarting pair"
          break
        fi
      fi
    fi
    sleep 5
  done

  kill_children
  if [[ ! -f "$STOP_FILE" ]]; then
    sleep 3
  fi
done

log "monitor stopped"
