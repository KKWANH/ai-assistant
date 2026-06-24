# Building the Ariadne desktop app

The desktop shell (Tauri 2, `src-tauri/`) is a thin wrapper: it connect-or-spawns
the normal Ariadne Node server on `127.0.0.1:4319` and points a webview at it.
The shell code (`src-tauri/src/main.rs`) is cross-platform — path resolution uses
Tauri's per-OS path API, the node binary name / dev triple are selected per host,
and external URLs open via the platform opener.

## ⚠ The one hard constraint: native modules are per-platform

The bundled server ships real `node_modules` (`node-pty`, `tree-sitter` +
grammars, `@napi-rs/canvas`, `esbuild`, `node:sqlite` natives). These are
compiled for the **build host's OS + arch** and are **not** portable. You
therefore **build on each target OS** (or a matching CI runner / container) —
you cannot produce a Windows or Linux app from macOS by copying files.

So: macOS app → build on macOS · Windows app → build on Windows · Linux app →
build on Linux. A CI matrix is the practical way to ship all three (below).

## Dev loop: edit once → reflected on web AND desktop

You do **not** rebuild the desktop app to see code changes during development —
the shell just points a webview at the same `127.0.0.1:4319` server, so whatever
the server serves, the app shows on reload. A full `build:desktop` is only for
producing a shippable installer.

| You changed…        | To see it                                                                 |
|---------------------|---------------------------------------------------------------------------|
| Web SPA (`apps/web`)| `npm run build:web` — `@fastify/static` (`wildcard:true`) serves the fresh `dist/` live; reload the app (Cmd+R) or browser. For instant HMR while iterating, `npm run dev:web` (Vite, `:5174`). |
| Server (`apps/server`, `projects/*`) | `./ops/ariadne.sh restart` (runs the working tree via `tsx`). Reload the app. |

The desktop app is then just one of the clients of that running server — no
per-edit rebuild. Rebuild (`npm run build:desktop`) only to cut a new installer.

## Per-OS build steps (run on the target OS)

Prereqs on each host: Rust (stable) + Node 22 + Bash (on Windows use **Git
Bash**). The Tauri CLI is fetched on demand via `npx @tauri-apps/cli@2` — no
global install needed.

**One command** (from the repo root) does the whole pipeline for the current OS:

```bash
npm run build:desktop                      # → native installer(s) for THIS OS
npm run build:desktop -- --bundles app     # …skip the .dmg (its bundle_dmg.sh needs a GUI)
```

It runs these (each can be invoked on its own):

```bash
npm install                                  # native modules for THIS OS/arch
apps/desktop/scripts/fetch-node-sidecar.sh   # Node sidecar (auto-detects target; or TARGET=win-x64 …)
apps/desktop/scripts/stage-server.sh         # builds the web SPA + stages the self-contained server
cd apps/desktop && npx -y @tauri-apps/cli@2 build   # bundle (targets:"all" → this OS's installers)
```

Outputs (under `src-tauri/target/release/bundle/`):

| OS      | Artifacts                          |
|---------|------------------------------------|
| macOS   | `macos/Ariadne.app`, `dmg/*.dmg`   |
| Windows | `nsis/*-setup.exe`, `msi/*.msi`    |
| Linux   | `deb/*.deb`, `appimage/*.AppImage` |

### Linux extra system deps
WebKitGTK + build tooling are required to compile the shell:
```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### Icons
`tauri.conf.json` references the generated `icons/` set. To regenerate it from a
source PNG (Windows needs `.ico`, macOS `.icns`):
```bash
cd apps/desktop && npx -y @tauri-apps/cli@2 icon src-tauri/icons/icon.png
```

## CI: build all three OSes from one push

`.github/workflows/desktop.yml` runs the one-command pipeline on a
macOS + Windows + Linux matrix and uploads each OS's installers as artifacts.
Native `node_modules` aren't portable, so this matrix is the only way to produce
all three from a single trigger. Trigger it manually (Actions → **Desktop build**
→ Run workflow) or by pushing a `v*` tag.

## Signing / notarization (deferred)

The current builds are **unsigned**. For distribution: macOS needs a Developer
ID cert + notarization; Windows needs an Authenticode cert (or users see
SmartScreen); Linux AppImage/deb are typically distributed unsigned. Wire these
via env-based signing keys in CI when ready.
