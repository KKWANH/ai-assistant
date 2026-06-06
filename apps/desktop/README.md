# @ariadne/desktop — Tauri shell (Phase 0 spike)

Double-click Ariadne instead of `git clone` + `npm` + provider keys. This is the
**Phase 0 spike**
§7: prove the sidecar architecture on the dev machine. No signing, no installer,
no bundled Node yet.

## How it works

A tiny Rust shell (`src-tauri/src/main.rs`, ~90 lines):

1. Picks a free loopback port.
2. Spawns the **unchanged** Node server (`npm run start:server`) with
   `ARIADNE_PORT` + `ARIADNE_DESKTOP=1`. No `apps/server` code changes — the
   server already honours `ARIADNE_PORT` (`packages/shared/src/config.ts`).
3. Waits until the server accepts connections.
4. Opens a WKWebView pointed at `http://127.0.0.1:<port>` — the SPA is served by
   the Node process, exactly like the web build.
5. Kills the server when the window closes.

## Run it (macOS, requires Rust + Xcode CLT)

```bash
# one-time: install the Tauri CLI for this workspace
npm install

# build the SPA the server serves, then launch the shell
npm --prefix apps/web run build
npm run tauri:dev --workspace @ariadne/desktop
```

`tauri:dev` compiles the Rust shell and opens a window with a working Ariadne.

## Not done yet (Phase 1+)

- Bundled Node binary as a real Tauri `externalBin` sidecar (so it runs without
  the source tree / npm). Currently spawns `npm run start:server` from the repo.
- App icons for bundling: generate the full set with
  `npm run tauri --workspace @ariadne/desktop -- icon apps/web/public/icon-512.png`
  (the spike ships a single `icons/icon.png` — enough for `tauri dev`).
- Settings → API keys is already in the web app; keychain storage is Phase 1.
- Code signing + notarization + auto-updater.
- ~~Bind loopback-only~~ **done**: the server now defaults to `ARIADNE_BIND=127.0.0.1`
  and the shell sets it explicitly; the `accessContext` socket check treats the
  webview (loopback) as local-admin, so no login screen in desktop mode.
- Graceful shutdown is wired: the shell SIGTERMs the sidecar so the server's MCP
  cleanup runs (was SIGKILL, which orphaned `npx` MCP workers).
