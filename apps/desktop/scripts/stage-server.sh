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
cp    "$REPO/tsconfig.base.json" "$DEST/tsconfig.base.json"

# Lean production node_modules: ONLY the server's runtime closure + tsx, built
# fresh from the declared deps of server + shared + surface-sdk. This drops the
# web/editor build tooling the old whole-tree copy dragged in (vite,
# lucide-react, @babel, lightningcss, typescript…) — the bundle's biggest win.
# @ariadne/* are intentionally excluded: tsx resolves them via tsconfig `paths`
# to the staged packages/ source, not node_modules.
node -e '
  const fs = require("fs");
  const repo = process.argv[1], dest = process.argv[2];
  const dep = (p) => { try { return JSON.parse(fs.readFileSync(repo + "/" + p, "utf8")).dependencies || {}; } catch { return {}; } };
  const deps = {
    ...dep("apps/server/package.json"),
    ...dep("packages/shared/package.json"),
    ...dep("packages/surface-sdk/package.json"),
  };
  for (const k of Object.keys(deps)) if (k.startsWith("@ariadne/")) delete deps[k];
  const root = JSON.parse(fs.readFileSync(repo + "/package.json", "utf8"));
  deps.tsx = (root.devDependencies && root.devDependencies.tsx) || "^4.20.6";
  fs.writeFileSync(dest + "/package.json",
    JSON.stringify({ name: "ariadne-server-bundle", private: true, type: "module", dependencies: deps }, null, 2));
' "$REPO" "$DEST"
( cd "$DEST" && npm install --omit=dev --no-audit --no-fund --no-package-lock )
rm -rf "$DEST/apps/server/node_modules" 2>/dev/null || true
# Belt-and-suspenders: no dangling symlinks for Tauri's resource resolver.
find "$DEST" -type l ! -exec test -e {} \; -delete 2>/dev/null || true

# Drop cross-platform prebuilt binaries (other OS/arch) — dead weight on macOS
# arm64. node-pty alone ships ~58M of win32/darwin-x64 prebuilds.
find "$DEST/node_modules" -type d -name prebuilds | while read -r pb; do
  find "$pb" -mindepth 1 -maxdepth 1 ! -name 'darwin-arm64' -exec rm -rf {} + 2>/dev/null || true
done
# A fresh npm extraction can drop the execute bit on node-pty's spawn-helper
# (a posix_spawn shim) — restore it or pty.fork() fails with "posix_spawnp failed".
find "$DEST/node_modules" -name spawn-helper -exec chmod +x {} + 2>/dev/null || true

echo "✓ staged ($(du -sh "$DEST" | cut -f1))"
