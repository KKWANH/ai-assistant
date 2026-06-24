#!/usr/bin/env bash
#
# One command → desktop app for the CURRENT OS. Wraps the whole pipeline so
# `npm run build:desktop` (from the repo root) does everything:
#   1. fetch the Node sidecar for this OS (skipped if already present)
#   2. stage the self-contained server — this ALSO builds the web SPA
#   3. tauri bundle → native installer(s) in src-tauri/target/release/bundle/
#
# Extra args pass through to `tauri build`, e.g.:
#   build-app.sh --bundles app     # skip the .dmg (its bundle_dmg.sh needs a GUI)
#
# Cross-OS: run this same script on each target OS (or via the CI matrix in
# .github/workflows/desktop.yml) — native node_modules aren't portable, so each
# platform's app must be built on that platform.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"   # apps/desktop/scripts
DESKTOP="$(cd "$HERE/.." && pwd)"       # apps/desktop

if ! ls "$DESKTOP/src-tauri/binaries/node-"* >/dev/null 2>&1; then
  echo "→ [1/3] fetching Node sidecar for this OS"
  bash "$HERE/fetch-node-sidecar.sh"
else
  echo "→ [1/3] Node sidecar present — skipping fetch"
fi

echo "→ [2/3] staging server + building web SPA"
bash "$HERE/stage-server.sh"

echo "→ [3/3] bundling the app"
( cd "$DESKTOP" && npx -y @tauri-apps/cli@2 build "$@" )

echo "✓ bundle → $DESKTOP/src-tauri/target/release/bundle/"
