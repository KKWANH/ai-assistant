#!/usr/bin/env bash
set -euo pipefail

TAILSCALE_BIN="${TAILSCALE_BIN:-}"

if [[ -z "$TAILSCALE_BIN" ]]; then
  if command -v tailscale >/dev/null 2>&1; then
    TAILSCALE_BIN="$(command -v tailscale)"
  elif [[ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]]; then
    TAILSCALE_BIN="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
  else
    echo "Tailscale CLI not found. Install/open Tailscale.app first." >&2
    exit 1
  fi
fi

exec "$TAILSCALE_BIN" status "$@"
