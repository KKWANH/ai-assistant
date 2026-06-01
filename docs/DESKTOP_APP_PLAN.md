# Desktop app — packaging Ariadne as a native binary

A planning document for "double-click an icon, get Ariadne." The wedge:
keep the *exact same* Node server + React SPA, but wrap them in a desktop
shell so users don't `git clone`, don't install Node, don't think about
ports or tunnels.

This is the plan, not the implementation. Read it before touching Rust.

---

## 1. Does this idea make sense?

Yes — with caveats. Ariadne is already shaped right for a desktop app:

| Property | Current state | Why it helps |
|---|---|---|
| Local-first by design | Server runs on user's machine, reads local folders | No "where do I host this" question for the user |
| One backend, one frontend | Fastify + React SPA on the same port | The shell only needs to manage one subprocess |
| Loopback auth bypass | `accessContext === "local"` → admin, no login | Desktop = always loopback = no login UX needed |
| BYO model keys | Already env-var driven; can be settings-UI driven | No backend secrets to ship; user supplies their own |
| Storage is portable | `data/ariadne.db` + per-workspace `.ariadne/` folders | Mirror to `~/Library/Application Support/Ariadne/` cleanly |

The caveats — none are blockers, but each is real work:

- **Native deps**: `@napi-rs/canvas`, `pdf-parse` / `pdfjs-dist`, `esbuild`,
  Node's built-in `node:sqlite`. The bundler has to package the right
  prebuilt binary per platform.
- **Tunnel feature**: doesn't survive into the desktop world. A desktop user
  who wants to share probably wants the web build. We drop `cloudflared` from
  the desktop bundle and hide the tunnel UI.
- **Update channel**: web users just refresh. Desktop users need
  auto-updater + code signing or they'll be on stale versions forever.
- **Code signing cost**: Apple Developer ID ($99/yr) + Windows EV cert
  ($200–500/yr). Without these, users see "unknown developer" warnings.

**Verdict**: ship the desktop app as the *recommended* install path for
single-user use. Keep the web build for the "I want to chat from my phone"
case.

---

## 2. Shell choice — Tauri vs Electron

We need a webview shell that can host the Vite-built React bundle and
spawn the Node server as a child process.

| | **Tauri 2** | **Electron** |
|---|---|---|
| Shell language | Rust | Node |
| Renderer | System webview (WKWebView / WebView2 / WebKitGTK) | Bundled Chromium |
| Binary size (empty app) | ~10 MB | ~120 MB |
| Memory at idle | ~50 MB | ~300 MB |
| Sidecar process support | First-class (`tauri.conf.json` → `externalBin`) | Manual (`child_process.spawn`) |
| Auto-updater | Built in (signed manifests) | Squirrel / `electron-updater` |
| Code signing | Same Apple/Windows certs work | Same |
| Learning curve | Rust for the shell (~500 LOC for our case) | TypeScript only |
| Ecosystem maturity | Newer, smaller community | Older, bigger community |

**Recommendation: Tauri 2.**

- Our shell is small — we're not writing a complex desktop UI in Rust, we're
  just hosting a webview and managing a Node sidecar. ~500 lines, mostly
  config.
- 12× smaller download (~10 MB shell vs ~120 MB Chromium) matters when the
  point is "double-click and go."
- WKWebView on macOS is a single user-perceived load (already in the OS).
- The sidecar pattern is a first-class concept, not a hack.

Electron is the conservative choice if we hit a Tauri-specific blocker, but
no specific blocker is visible from here.

---

## 3. Architecture — shell + sidecar

```
┌────────────────────────────────────────────────────────────────┐
│  Tauri shell (Rust, ~500 LOC)                                  │
│                                                                │
│  ┌──────────────────────────┐    ┌──────────────────────────┐  │
│  │  WKWebView (or WebView2) │◄──►│  Node sidecar (Ariadne)  │  │
│  │  loads built React SPA   │    │   apps/server/index.ts   │  │
│  │  from app://localhost    │    │   on 127.0.0.1:<random>  │  │
│  └──────────────────────────┘    └──────────────────────────┘  │
│           ▲                                ▲                   │
│           │ user clicks                    │ child_process     │
│           │                                │ stdio piped       │
│           ▼                                ▼                   │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  Tauri commands (Rust)                                 │    │
│  │  · pick_folder()  — native folder picker for workspaces│    │
│  │  · open_in_editor(path) — opens user's $EDITOR         │    │
│  │  · reveal_in_finder(path)                              │    │
│  │  · server_port() — webview asks "where do I fetch?"    │    │
│  └────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
   ~/Library/Application Support/Ariadne/   (macOS)
   %APPDATA%/Ariadne/                       (Windows)
   ~/.config/Ariadne/                       (Linux)
     └ ariadne.db, logs/, run/
```

**Sidecar boot sequence** (Rust shell on startup):

1. Find a free port (`portpicker` crate or equivalent) — don't hardcode 4319,
   the user might already be running web Ariadne.
2. Spawn the bundled Node binary with the server entry, passing the port,
   data dir, and a generated bearer token as env vars.
3. Poll `GET /healthz` until it returns 200 (with a 30s timeout + nice error
   UI on failure).
4. Load the webview at `http://127.0.0.1:<port>` (the SPA is *served by* the
   Node process, same as web — no separate bundle to load).
5. Pipe sidecar stdout/stderr to the user's app data log dir.

**Shutdown**: on window close, send SIGTERM to the sidecar, wait up to 5
seconds, then SIGKILL. Update the supervisor PID file convention to be
optional (it exists for the multi-process web deployment; for desktop the
shell is the supervisor).

---

## 4. What changes in the existing codebase

Most of the codebase doesn't change at all — that's the point. The list of
real edits is short:

### 4.1 Server: accept a port from CLI/env

**Already done.** `PORTS.server` in `packages/shared/src/config.ts` is
`Number(env("ARIADNE_PORT") ?? 4319)`, and `apps/server/src/index.ts` calls
`app.listen({ port: PORTS.server })` — so the sidecar can pass `ARIADNE_PORT`
today, no change needed. (Phase 1 may add an `ARIADNE_HOST` to bind
loopback-only instead of `0.0.0.0`; not required for the Phase 0 spike.)

### 4.2 Auth: treat sidecar as "local"

`apps/server/src/auth/context.ts` already maps loopback hosts to `local`. A
Tauri sidecar binds to `127.0.0.1`, so this *already works* — the webview
fetches `http://127.0.0.1:<port>` and the server sees it as loopback. **No
code change needed**, but worth a confirming integration test.

If we want extra safety, add a "desktop mode" env var that disables remote
auth entirely:

```ts
// apps/server/src/auth/context.ts
if (process.env.ARIADNE_DESKTOP === "1") return "local"; // always trust
```

### 4.3 Disable tunnel UI in desktop mode

The Settings → Tunnel panel doesn't make sense in a single-user desktop
context. Add a build-time flag (`VITE_ARIADNE_FLAVOR=desktop|web`) and hide
the panel when `desktop`. Same flag hides the "Logout" button (loopback
admin can't really log out).

### 4.4 Pull provider keys from settings table, not env

This is the biggest UX shift. On the web, we tell users to `export
ANTHROPIC_API_KEY=…` in their shell. Desktop users won't do that — they
expect a "paste your key" field in Settings.

The provider modules in `apps/server/src/providers/` need to check the
`settings` table *before* `process.env`. The settings UI gets a new section
("API keys") that writes into the table. Existing web users keep using env
vars (loaded into the settings table on first boot if present).

**Security**: store keys in the OS keychain via Tauri's
`tauri-plugin-stronghold` or `keytar`, not in `ariadne.db`. The settings
table holds a *reference* (`{ provider: "anthropic", key_id: "anthropic-1" }`)
and the actual secret lives in the OS keychain.

### 4.5 First-run setup wizard

A modal that runs once on first launch:
1. "Pick a folder for your first workspace" (or "skip — I'll do this later").
2. "Add a provider key" (or "skip — try the demo mock provider").
3. "Should Ariadne start when you log in?" (auto-start toggle).

All four can be redirected to existing UI flows; this is just a guided tour
on top.

---

## 5. Native dependencies — the hard part

These are the deps that ship native code. Each needs verification under
the desktop bundler:

| Dependency | What it does | Native? | Risk |
|---|---|---|---|
| `node:sqlite` | Workspace registry, sessions, chats | Built into Node | Need Node 22.5+ in the bundle |
| `@napi-rs/canvas` | Image generation for the gallery | Yes (prebuilt) | Have to bundle the right `.node` for each platform |
| `pdf-parse` + `pdfjs-dist` | PDF text extraction | No (pure JS) | Bundle size only |
| `esbuild` | Building custom surface.tsx | Yes (Go binary) | One binary per OS/arch |
| `mammoth` | DOCX text extraction | No | Bundle size only |
| `xlsx` | Spreadsheet read | No | Bundle size only |

**Approach**: bundle Node itself with the app. Tauri's sidecar contract is
"give me a path to an executable per platform" — we point that at a
pre-built Node binary in `src-tauri/binaries/node-<target-triple>`.

For the Ariadne server itself, we have two options:

- **A. Ship sources, use bundled Node + tsx** — simpler, larger (~50MB extra
  for tsx + sources), slower startup.
- **B. Bundle to a single CJS file via `esbuild --bundle --platform=node`,
  then use [`@vercel/ncc`](https://github.com/vercel/ncc) or pkg-style
  packaging** — smaller (~15MB), faster startup, but native deps need
  manual handling (esbuild can't bundle `.node` files; they have to sit
  alongside).

**Recommendation for phase 1**: option A. We already use tsx everywhere
(`npm run start:server` is just `tsx src/index.ts`). Optimise to B later if
startup is painful.

---

## 6. Distribution — signing + notarization + updates

### macOS (priority — user is on macOS)

- **Code sign**: Apple Developer ID Application certificate. ~$99/yr. Tauri
  handles this via `tauri.conf.json` → `bundle.macOS.signingIdentity`.
- **Notarize**: Apple's notary service must scan and approve the binary.
  ~5 minutes per build. Tauri's `tauri build` integrates with `notarytool`.
- **Distribution**: `.dmg` + `.app` bundle. Host on GitHub Releases or our
  own download page.
- **Auto-update**: Tauri's updater downloads a signed `.tar.gz` from a
  manifest URL we host. Updates land on next launch.

### Windows

- **Code sign**: EV (Extended Validation) cert. ~$200–500/yr. Without it,
  SmartScreen shows "unknown publisher" until enough users install (slow
  reputation build).
- **Installer**: NSIS or MSI via Tauri's bundler.
- **Update**: same Tauri updater pattern.

### Linux

- **No signing needed**, but **format choice matters**:
  - **AppImage**: portable, one file, works on any distro. Simplest.
  - **`.deb` + `.rpm`**: per-distro, requires more CI setup.
  - **Flatpak / Snap**: stores, more reach, more bureaucracy.
- **Recommendation**: AppImage for v1. Add Flatpak later if there's demand.

### CI

GitHub Actions matrix:

```yaml
matrix:
  include:
    - { os: macos-latest, target: aarch64-apple-darwin }
    - { os: macos-latest, target: x86_64-apple-darwin }
    - { os: windows-latest, target: x86_64-pc-windows-msvc }
    - { os: ubuntu-latest, target: x86_64-unknown-linux-gnu }
```

Tauri's official action (`tauri-apps/tauri-action`) handles the build +
artifact upload. Sign certs go in repo secrets. Notarization credentials
(Apple ID + app-specific password) too.

---

## 7. Phasing

### Phase 0 — spike (1–2 days)

- Install Tauri CLI, scaffold `apps/desktop/` next to `apps/web/`.
- Get the existing server to run as a sidecar with no code changes (just
  the env-var port from §4.1).
- Webview loads the existing SPA from the sidecar's port.
- Hardcoded paths, no signing, no installer. Just prove the architecture
  works on the dev machine.

**Exit criterion**: `npm run tauri:dev` opens a window with a working chat.

### Phase 1 — macOS-first MVP (1 week)

- Settings → API keys UI + keychain integration.
- Hide tunnel/logout in desktop flavor.
- First-run wizard.
- Signed + notarized `.dmg` produced by CI on tag push.
- Auto-updater pointed at GitHub Releases.

**Exit criterion**: send the `.dmg` to a friend on macOS, they
double-click, app opens, they add an API key, chat works. Update lands
on relaunch when we ship v0.1.1.

### Phase 2 — Windows + Linux (1 week)

- Same flow on Windows. EV cert (or eat the SmartScreen warning for now).
- AppImage for Linux.
- CI matrix produces all three on tag push.

### Phase 3 — polish (open-ended)

- Native folder picker for workspaces (skip the in-app file browser).
- "Open in editor" + "reveal in Finder/Explorer" Tauri commands.
- macOS menubar app option (`tauri-plugin-positioner` + tray icon).
- Crash reporter (Sentry or self-hosted GlitchTip).

---

## 8. Open decisions (to make before phase 1)

1. **Single port or split?** Currently web has `4319` (API+SPA) and `7459`
   (admin dashboard). Desktop probably doesn't need the admin dashboard at
   all — the Tauri shell *is* the supervisor. Drop the admin dashboard
   from the desktop bundle?
   - **Lean**: yes, drop it. The admin dashboard exists to monitor a
     long-running web deployment. Desktop crash recovery is just "relaunch
     the app."

2. **One binary for web + desktop, or separate apps?**
   - **Lean**: one repo, two build targets via `VITE_ARIADNE_FLAVOR`.
     Shared core, ~5% UI differences. Splitting would mean drift.

3. **What about the Cloudflare tunnel feature?** Desktop users *could*
   want to share their desktop instance.
   - **Lean**: don't ship it in desktop v1. If users ask, add it back as
     an opt-in "advanced" toggle. Tunneling raises the auth-bypass risk
     (we'd need the full remote-auth path again) and breaks the "double-
     click, just works" pitch.

4. **OS keychain library**: `tauri-plugin-stronghold` (built by Tauri, IOTA
   under the hood) vs `keytar` (older, Electron-era, very stable).
   - **Lean**: stronghold. Tauri-native, no Node dependency for the
     keychain layer.

5. **Update channel**: stable only, or stable + beta?
   - **Lean**: stable only for v1. Add beta when there's a reason.

---

## 9. Non-goals (be explicit)

- **Mobile apps**. Tauri Mobile exists but is alpha; iOS App Store policy
  for "browse local files" apps is a separate rabbit hole.
- **Sandboxing the workspace folder**. macOS App Sandbox would force us to
  use bookmarks for every file access — incompatible with how scans work
  today. Ship outside the App Sandbox; users get the "unidentified
  developer" prompt once on install (handled by notarization).
- **Replacing the web build**. The desktop app is *also* available; the web
  build stays for multi-device users.
- **Rust port of the server**. Tempting (smaller binary, faster startup),
  but throws away every line of working Node code. Sidecar pattern keeps
  the server identical.

---

## 10. References

- Tauri 2 docs: <https://v2.tauri.app/>
- Tauri sidecar pattern: <https://v2.tauri.app/develop/sidecar/>
- Apple Developer ID + notarization: <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>
- `tauri-action` (GitHub Actions): <https://github.com/tauri-apps/tauri-action>
- `tauri-plugin-stronghold`: <https://v2.tauri.app/plugin/stronghold/>

---

## 11. Estimated effort

Phase 0 spike: **1–2 days** of focused work.
Phase 1 (macOS MVP): **1 week** including learning Tauri's bundler.
Phase 2 (Win + Linux): **1 week** including CI matrix debugging.

Plus ongoing cost: **$99/yr** Apple Developer + **$200–500/yr** Windows EV
cert + occasional notarization re-run on cert renewal. No infrastructure
cost (GitHub Releases hosts the binaries free).

---

## Next steps if approved

1. Add `apps/desktop/` workspace, scaffold Tauri (Cargo.toml, `tauri.conf.json`).
2. Implement the env-var port read in `apps/server/src/index.ts` (§4.1) —
   this one change is small, safe, and useful for the web build too.
3. Run the phase 0 spike. Commit the working spike to a `desktop-spike`
   branch, demo it, decide whether to push forward.
