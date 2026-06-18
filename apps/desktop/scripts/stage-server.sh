#!/usr/bin/env bash
#
# Stage a self-contained copy of the Ariadne server that the bundled Node
# sidecar runs from INSIDE the .app — no repo, no npm needed at runtime.
#
# Option A (per DESKTOP_APP_PLAN §5): ship sources + tsx, no precompile. tsx
# resolves @ariadne/* via the tsconfig `paths` → packages/*/src, so the source
# tree + node_modules + tsconfig are all that's required. Tauri copies this dir
# into Contents/Resources/server (see tauri.conf.json `bundle.resources`).
#
# Output lives in src-tauri/.bundle (gitignored). Re-run after changing the
# server or rebuilding the web. Size is dominated by node_modules; pruning is a
# later optimization (v1 favors correctness over a lean bundle).
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"   # apps/desktop
REPO="$(cd "$HERE/../.." && pwd)"          # repo root
DEST="$HERE/src-tauri/.bundle"

echo "→ building the web SPA"
npm --prefix "$REPO/apps/web" run build >/dev/null

echo "→ staging into $DEST (copies node_modules — takes a moment)"
rm -rf "$DEST"
mkdir -p "$DEST/apps/web"

# Server + resolution inputs. tsx maps @ariadne/* through tsconfig paths to
# packages/*/src, so the package sources + base tsconfig must travel along.
cp -R "$REPO/apps/server"        "$DEST/apps/server"
cp -R "$REPO/packages"           "$DEST/packages"
# The per-project registry (budget, lecture, …) is plain source imported by
# relative path from apps/server/src/projects (NOT a workspace package), so it
# must travel along too.
cp -R "$REPO/projects"           "$DEST/projects"
cp -R "$REPO/apps/web/dist"      "$DEST/apps/web/dist"
cp    "$REPO/package.json"       "$DEST/package.json"
cp    "$REPO/tsconfig.base.json" "$DEST/tsconfig.base.json"

# Third-party deps. Native modules (.node) are arm64 prebuilt and load under
# the bundled Node 22 (N-API ABI-stable). Symlinks are preserved here; the
# runtime resolves them fine.
cp -R "$REPO/node_modules"       "$DEST/node_modules"
rm -rf "$DEST/apps/server/node_modules" 2>/dev/null || true

echo "✓ staged ($(du -sh "$DEST" | cut -f1))"
