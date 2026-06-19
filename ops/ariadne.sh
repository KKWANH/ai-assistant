#!/usr/bin/env bash
# Ariadne control script
# Usage: ariadne.sh <start|stop|restart|status|logs|admin> [log-name]
set -euo pipefail

# ── Resolve repo root from this script's location ─────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARIADNE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
export ARIADNE_ROOT

export ARIADNE_LOG_DIR="${ARIADNE_LOG_DIR:-${ARIADNE_ROOT}/logs}"
export ARIADNE_RUN_DIR="${ARIADNE_RUN_DIR:-${ARIADNE_ROOT}/run}"
export ARIADNE_HOME="${ARIADNE_HOME:-${ARIADNE_ROOT}/data}"

# The server binds loopback (127.0.0.1) by default for safety. cloudflared runs
# on this host, so 0.0.0.0 preserves the existing tunnel binding; the
# socket-based local-admin check keeps it safe (LAN clients are treated as
# remote and must log in). Remove this line for the stricter loopback-only bind
# if your tunnel targets localhost.
export ARIADNE_BIND="${ARIADNE_BIND:-0.0.0.0}"

# ── Load .env so the daemon sees provider keys + tunnel config ────────────
if [[ -f "${ARIADNE_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ARIADNE_ROOT}/.env"
  set +a
fi

PID_FILE="${ARIADNE_RUN_DIR}/supervisor.pid"
TUNNEL_URL_FILE="${ARIADNE_RUN_DIR}/tunnel-url.txt"
TSX_BIN="${ARIADNE_ROOT}/node_modules/.bin/tsx"
SUPERVISOR_ENTRY="${ARIADNE_ROOT}/apps/admin/src/supervisor.ts"
LOG_FILE="${ARIADNE_LOG_DIR}/supervisor.log"

# ── Colours ────────────────────────────────────────────────────────────────
RESET="\033[0m"
BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
CYAN="\033[36m"
DIM="\033[2m"

info()    { printf "${CYAN}→${RESET} %s\n" "$*"; }
ok()      { printf "${GREEN}✓${RESET} %s\n" "$*"; }
warn()    { printf "${YELLOW}!${RESET} %s\n" "$*"; }
err()     { printf "${RED}✗${RESET} %s\n" "$*" >&2; }
bold()    { printf "${BOLD}%s${RESET}\n" "$*"; }
dim()     { printf "${DIM}%s${RESET}\n" "$*"; }

# ── Helpers ────────────────────────────────────────────────────────────────

pid_alive() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null
}

read_pid() {
  if [[ -f "${PID_FILE}" ]]; then
    cat "${PID_FILE}"
  else
    echo ""
  fi
}

supervisor_running() {
  local pid
  pid="$(read_pid)"
  [[ -n "$pid" ]] && pid_alive "$pid"
}

wait_for_tunnel_url() {
  local waited=0
  while [[ $waited -lt 20 ]]; do
    if [[ -f "${TUNNEL_URL_FILE}" ]]; then
      cat "${TUNNEL_URL_FILE}"
      return 0
    fi
    sleep 1
    (( waited++ )) || true
  done
  echo ""
}

# ── Commands ───────────────────────────────────────────────────────────────

# Ensure the local Ollama server is up — it's the local-first default provider,
# so a stopped Ollama is why "the local model suddenly broke". brew services /
# launchd can't reliably auto-start it here because $HOME lives on an external
# volume (gui launch agents fail to bootstrap from /Volumes/...), so Ariadne
# starts it itself — detached — every time it starts. No-op if Ollama isn't
# installed or is already running.
ensure_ollama() {
  command -v ollama >/dev/null 2>&1 || return 0
  if curl -fsS -m 2 http://localhost:11434/api/tags >/dev/null 2>&1; then
    return 0
  fi
  info "Starting local Ollama server…"
  nohup ollama serve >> "${ARIADNE_LOG_DIR}/ollama.log" 2>&1 &
  local waited=0
  while [[ $waited -lt 8 ]] && ! curl -fsS -m 2 http://localhost:11434/api/tags >/dev/null 2>&1; do
    sleep 1; waited=$((waited + 1))
  done
  if curl -fsS -m 2 http://localhost:11434/api/tags >/dev/null 2>&1; then
    ok "Ollama is up (http://localhost:11434)."
  else
    warn "Ollama didn't come up — local models may be unavailable until it starts."
  fi
}

cmd_start() {
  if supervisor_running; then
    local pid
    pid="$(read_pid)"
    warn "Supervisor is already running (PID ${pid})."
    printf "  Admin:  ${CYAN}http://localhost:7459${RESET}\n"
    exit 0
  fi

  # Ensure dependencies
  if [[ ! -d "${ARIADNE_ROOT}/node_modules" ]]; then
    info "node_modules missing — running npm install…"
    (cd "${ARIADNE_ROOT}" && npm install)
  fi

  # Ensure a FRESH web build. Rebuild when dist is missing OR any web / shared /
  # project-web source is newer than the built index.html. Otherwise a stale dist
  # (e.g. after `git pull`, or a manual rebuild while the server ran) gets served
  # and @fastify/static is registered against it at boot — producing 404 assets /
  # a white screen until the next rebuild. Building here, before the supervisor
  # launches the server, keeps the served dist and the static handler in sync.
  # projects/*/web is included because the web bundle pulls in each project's
  # client code (e.g. lecture's LectureView) — editing only a project web file
  # must still trigger a rebuild. The -path filter keeps project *server* edits
  # (which don't touch the web bundle) from forcing a needless rebuild.
  local dist_index="${ARIADNE_ROOT}/apps/web/dist/index.html"
  if [[ ! -f "${dist_index}" ]] || \
     [[ -n "$(find "${ARIADNE_ROOT}/apps/web/src" "${ARIADNE_ROOT}/packages/shared/src" "${ARIADNE_ROOT}/projects" -type f -newer "${dist_index}" \( -path '*/apps/web/src/*' -o -path '*/packages/shared/src/*' -o -path '*/projects/*/web/*' \) -print -quit 2>/dev/null)" ]]; then
    info "Building web (dist missing or stale)…"
    (cd "${ARIADNE_ROOT}" && npm run build:web)
  fi

  # Ensure dirs exist
  mkdir -p "${ARIADNE_LOG_DIR}" "${ARIADNE_RUN_DIR}"

  # Ensure the local model server is up before the app needs it.
  ensure_ollama

  # Remove stale tunnel URL
  rm -f "${TUNNEL_URL_FILE}"

  info "Starting Ariadne supervisor…"
  # Detach: nohup + background, stdout appended to log
  nohup "${TSX_BIN}" "${SUPERVISOR_ENTRY}" >> "${LOG_FILE}" 2>&1 &
  local spid=$!

  # Give it a moment to write the PID file
  local waited=0
  while [[ $waited -lt 8 ]] && ! supervisor_running; do
    sleep 0.5
    (( waited++ )) || true
  done

  if ! supervisor_running; then
    err "Supervisor failed to start. Check ${LOG_FILE}"
    exit 1
  fi

  ok "Supervisor started (PID ${spid})"
  printf "\n"
  bold "  Local server:  http://localhost:4319"
  printf "  Admin:         ${CYAN}http://localhost:7459${RESET}\n"

  printf "\n"
  info "Waiting for Cloudflare tunnel URL (up to 20s)…"
  local tunnel_url
  tunnel_url="$(wait_for_tunnel_url)"
  if [[ -n "$tunnel_url" ]]; then
    printf "\n"
    bold "  Tunnel URL:    ${tunnel_url}"
    printf "\n"
    ok "Ariadne is ready."
  else
    warn "Tunnel URL not yet available. Check: ariadne.sh status"
  fi
}

cmd_stop() {
  local pid
  pid="$(read_pid)"
  if [[ -z "$pid" ]]; then
    warn "No PID file found — supervisor may not be running."
    return 0
  fi
  if ! pid_alive "$pid"; then
    warn "PID ${pid} is not alive — cleaning up stale PID file."
    rm -f "${PID_FILE}"
    return 0
  fi
  info "Sending SIGTERM to supervisor (PID ${pid})…"
  kill -TERM "$pid"
  # Wait up to 10s
  local waited=0
  while pid_alive "$pid" && [[ $waited -lt 20 ]]; do
    sleep 0.5
    (( waited++ )) || true
  done
  if pid_alive "$pid"; then
    warn "Supervisor did not exit in 10s — sending SIGKILL"
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "${PID_FILE}"
  rm -f "${TUNNEL_URL_FILE}"
  ok "Supervisor stopped."
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

cmd_status() {
  printf "\n"
  bold "Ariadne status"
  printf "\n"

  local pid
  pid="$(read_pid)"

  if [[ -n "$pid" ]] && pid_alive "$pid"; then
    ok "Supervisor running  (PID ${pid})"
  else
    err "Supervisor NOT running"
    if [[ -n "$pid" ]]; then
      warn "  Stale PID file references PID ${pid}"
    fi
  fi

  # Server health
  if command -v curl &>/dev/null; then
    local health
    health="$(curl -sf --max-time 2 "http://localhost:4319/healthz" 2>/dev/null || echo "")"
    if [[ -n "$health" ]]; then
      ok "Server healthy     (http://localhost:4319)"
    else
      warn "Server not responding on :4319"
    fi
  fi

  # Tunnel
  if [[ -f "${TUNNEL_URL_FILE}" ]]; then
    local turl
    turl="$(cat "${TUNNEL_URL_FILE}")"
    ok "Tunnel URL:  ${turl}"
  else
    dim "  Tunnel URL: not yet available"
  fi

  printf "\n"
  printf "  Admin dashboard:  ${CYAN}http://localhost:7459${RESET}\n"
  printf "\n"
}

cmd_logs() {
  local name="${1:-server}"
  local log_file="${ARIADNE_LOG_DIR}/${name}.log"
  if [[ ! -f "$log_file" ]]; then
    warn "Log file not found: ${log_file}"
    exit 1
  fi
  info "Tailing ${log_file}  (Ctrl+C to stop)"
  tail -f "${log_file}"
}

cmd_admin() {
  info "Opening admin dashboard…"
  open "http://localhost:7459"
}

# ── Dispatch ───────────────────────────────────────────────────────────────

VERB="${1:-help}"

case "$VERB" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  status)  cmd_status ;;
  logs)    cmd_logs "${2:-server}" ;;
  admin)   cmd_admin ;;
  *)
    printf "Usage: %s <start|stop|restart|status|logs [server|tunnel|supervisor]|admin>\n" \
      "$(basename "${BASH_SOURCE[0]}")"
    exit 1
    ;;
esac
