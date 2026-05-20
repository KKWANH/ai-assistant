#!/usr/bin/env bash
# Bind Ariadne to a stable Cloudflare custom domain via a named tunnel.
#
# Usage: ops/setup-tunnel.sh <hostname>
#   e.g. ops/setup-tunnel.sh ai.kwanho.dev
#
# Prerequisites: `cloudflared` installed, and the domain managed on Cloudflare.
# This runs `cloudflared tunnel login` (opens a browser once), creates a named
# tunnel, routes DNS to it, and records the result in .env. After it finishes,
# run `ariadne restart` — the daemon will serve the custom domain.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TUNNEL_NAME="ariadne"

GREEN="\033[32m"; CYAN="\033[36m"; RED="\033[31m"; YELLOW="\033[33m"; RESET="\033[0m"
info() { printf "${CYAN}→${RESET} %s\n" "$*"; }
ok()   { printf "${GREEN}✓${RESET} %s\n" "$*"; }
err()  { printf "${RED}✗${RESET} %s\n" "$*" >&2; }

HOSTNAME="${1:-}"
if [[ -z "${HOSTNAME}" ]]; then
  err "Usage: ops/setup-tunnel.sh <hostname>   (e.g. ai.kwanho.dev)"
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  err "cloudflared is not installed. Install it first (e.g. brew install cloudflared)."
  exit 1
fi

# 1. Authenticate (one-time; opens a browser). Skipped if a cert already exists.
if [[ -f "${HOME}/.cloudflared/cert.pem" ]]; then
  ok "Cloudflare credentials already present — skipping login."
else
  info "Opening a browser to authorise cloudflared with your Cloudflare account…"
  cloudflared tunnel login
fi

# 2. Create the named tunnel (idempotent).
if cloudflared tunnel list 2>/dev/null | awk '{print $2}' | grep -qx "${TUNNEL_NAME}"; then
  ok "Tunnel \"${TUNNEL_NAME}\" already exists."
else
  info "Creating tunnel \"${TUNNEL_NAME}\"…"
  cloudflared tunnel create "${TUNNEL_NAME}"
fi

# 3. Route the domain's DNS to the tunnel. --overwrite-dns replaces any
#    pre-existing record for the hostname (otherwise the route silently
#    fails and the domain returns Cloudflare Error 1033).
info "Routing ${HOSTNAME} → tunnel \"${TUNNEL_NAME}\"…"
cloudflared tunnel route dns --overwrite-dns "${TUNNEL_NAME}" "${HOSTNAME}"

# 4. Record the tunnel config in .env so the daemon picks it up.
ENV_FILE="${ROOT}/.env"
[[ -f "${ENV_FILE}" ]] || cp "${ROOT}/.env.example" "${ENV_FILE}" 2>/dev/null || touch "${ENV_FILE}"
# Drop any previous tunnel lines, then append the current ones.
grep -v -E '^ARIADNE_TUNNEL_(NAME|HOSTNAME)=' "${ENV_FILE}" > "${ENV_FILE}.tmp" || true
mv "${ENV_FILE}.tmp" "${ENV_FILE}"
{
  echo "ARIADNE_TUNNEL_NAME=${TUNNEL_NAME}"
  echo "ARIADNE_TUNNEL_HOSTNAME=${HOSTNAME}"
} >> "${ENV_FILE}"

echo
ok "Done. ${HOSTNAME} is bound to the \"${TUNNEL_NAME}\" tunnel."
info "Run 'ariadne restart' — the daemon will now serve https://${HOSTNAME}"
