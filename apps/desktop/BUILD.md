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

## Per-OS build steps (run on the target OS)

Prereqs on each host: Rust (stable) + the Tauri CLI (`cargo install
tauri-cli --version "^2"` or `npm i -g @tauri-apps/cli`) + Node 22.
Bash is required for the two scripts (on Windows use **Git Bash** or WSL).

```bash
# 1. Install JS deps — compiles native modules FOR THIS OS/arch.
npm install

# 2. Build the web SPA the server serves.
npm run build -w apps/web

# 3. Fetch the official Node sidecar for this host (auto-detects the target;
#    or pass TARGET=win-x64 | linux-x64 | linux-arm64 | darwin-x64 | darwin-arm64).
apps/desktop/scripts/fetch-node-sidecar.sh

# 4. Stage the self-contained server tree (incl. THIS OS's node_modules) into
#    src-tauri/.bundle.
apps/desktop/scripts/stage-server.sh

# 5. Bundle. `tauri.conf.json` has bundle.targets:"all", so each OS emits its
#    native installers.
cd apps/desktop/src-tauri && cargo tauri build
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
`tauri.conf.json` references `icons/icon.png`. To regenerate the full
platform icon set (Windows needs `.ico`, macOS `.icns`):
```bash
cd apps/desktop/src-tauri && cargo tauri icon icons/icon.png
```

## CI (recommended): GitHub Actions matrix

One job per OS, each running steps 1–5 above:

```yaml
strategy:
  matrix:
    os: [macos-latest, windows-latest, ubuntu-22.04]
runs-on: ${{ matrix.os }}
```

`tauri-apps/tauri-action` handles step 5 + release upload; run steps 1–4 before
it. On `ubuntu-22.04` install the Linux deps above first.

## Signing / notarization (deferred)

The current builds are **unsigned**. For distribution: macOS needs a Developer
ID cert + notarization; Windows needs an Authenticode cert (or users see
SmartScreen); Linux AppImage/deb are typically distributed unsigned. Wire these
via env-based signing keys in CI when ready.
