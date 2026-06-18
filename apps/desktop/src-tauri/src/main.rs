// Ariadne desktop — Phase 1 (macOS-first, see DESKTOP_APP_PLAN §7).
//
// The shell stays tiny: pick a free loopback port, spawn the EXISTING Node
// server (unchanged — it already honours ARIADNE_PORT + ARIADNE_HOME), wait
// until it answers, then point a WKWebView at it. The sidecar pattern keeps
// every line of server code identical.
//
// Phase 1 vs the Phase 0 spike: instead of `npm run start:server` from the
// repo, we run a BUNDLED Node 22 binary (Tauri externalBin) against a staged,
// self-contained server tree shipped in the app's Resources — so it runs with
// no repo, no npm, no system Node. User data (DB/logs/run) is redirected to the
// OS app-data dir, outside the read-only bundle.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// Holds the Node sidecar so it can be killed when the app exits. None when we
/// attached to a server we didn't start (so we never kill it).
struct Sidecar(Mutex<Option<Child>>);

/// The canonical Ariadne port — the web/ops server uses it too. Fixed (not a
/// random free port) so the desktop ATTACHES to an already-running server and
/// shares its data, and so the webview origin is stable (localStorage persists
/// across launches, and is shared with a browser tab on the same port).
const PORT: u16 = 4319;

/// Is a real Ariadne server already answering on this port? A bare TCP connect
/// isn't enough (something else could hold the port), so probe an API route and
/// look for an HTTP status line — a live server answers 200 (loopback admin) or
/// 401. Avoids starting a SECOND server on a separate DB.
fn server_alive(port: u16) -> bool {
    use std::io::{Read, Write};
    let Ok(mut s) = TcpStream::connect(("127.0.0.1", port)) else { return false };
    let _ = s.set_read_timeout(Some(Duration::from_millis(800)));
    if s
        .write_all(b"GET /api/auth/me HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut buf = [0u8; 64];
    let n = s.read(&mut buf).unwrap_or(0);
    let head = String::from_utf8_lossy(&buf[..n]);
    head.starts_with("HTTP/1.") && (head.contains(" 200") || head.contains(" 401"))
}

/// Poll until the server accepts TCP connections (a good-enough readiness
/// signal that avoids pulling in an HTTP client crate for the spike).
fn wait_until_ready(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(200));
    }
    false
}

/// Where the server keeps user data — the OS app-data dir, NOT the read-only
/// app bundle. macOS convention; matches Tauri's app_data_dir for our
/// identifier. (Windows/Linux are a later phase.)
fn app_data_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home).join("Library/Application Support/Ariadne")
}

/// Locate the Node runtime + server entry + working dir for both bundled and
/// dev runs:
///   bundled .app → Contents/MacOS/node + Contents/Resources/server/
///   dev (cargo)  → the fetched sidecar binary + the repo's source tree
/// Returns None if neither layout is present (the caller surfaces the error).
fn resolve_runtime() -> Option<(PathBuf, PathBuf, PathBuf)> {
    let exe = std::env::current_exe().ok()?;
    let bin_dir = exe.parent()?.to_path_buf(); // Contents/MacOS | target/<profile>

    // Bundled layout first: the sidecar node sits next to the app binary, the
    // staged server lives in ../Resources/server.
    let bundled_node = bin_dir.join("node");
    if bundled_node.exists() {
        if let Some(contents) = bin_dir.parent() {
            let server_root = contents.join("Resources").join("server");
            let entry = server_root.join("apps/server/src/index.ts");
            if entry.exists() {
                return Some((bundled_node, entry, server_root));
            }
        }
    }

    // Dev fallback: the fetched sidecar binary + the repo's source (run via tsx
    // exactly like the bundle, so dev and prod take the same path).
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")); // apps/desktop/src-tauri
    let dev_node = manifest.join("binaries/node-aarch64-apple-darwin");
    let repo = manifest.join("../../..").canonicalize().ok()?;
    let entry = repo.join("apps/server/src/index.ts");
    if dev_node.exists() && entry.exists() {
        return Some((dev_node, entry, repo));
    }
    None
}

/// Stop the Node sidecar *gracefully* so its SIGTERM handler runs — the server
/// tears down MCP child processes on SIGTERM (`index.ts`), so a plain SIGKILL
/// would orphan every `npx @modelcontextprotocol/server-*` worker. On Unix:
/// SIGTERM, give it a moment to clean up, then force-kill as a backstop.
#[cfg(unix)]
fn stop_sidecar(child: &mut Child) {
    // SAFETY: `child.id()` is a live PID this process owns; SIGTERM is safe.
    unsafe {
        libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
    }
    thread::sleep(Duration::from_millis(1500));
    let _ = child.kill();
}

#[cfg(not(unix))]
fn stop_sidecar(child: &mut Child) {
    let _ = child.kill();
}

fn main() {
    // Connect-or-spawn. If a server (the web/ops one) is already up on the fixed
    // port, ATTACH to it — the desktop window becomes one more client on the
    // same data, so it shows the same workspaces and shares localStorage with a
    // browser tab. Only when nothing is there do we start our own bundled server.
    let attach = server_alive(PORT);

    let sidecar = if attach {
        None // we don't own this server — never kill it on exit.
    } else {
        // Redirect user data outside the (read-only) bundle; create the dirs so a
        // first run on a clean machine has somewhere to write.
        let data = app_data_dir();
        for sub in ["data", "logs", "run"] {
            let _ = std::fs::create_dir_all(data.join(sub));
        }
        // Spawn the bundled Node server. `--import tsx` strips types on the fly so
        // the same source the web build runs from boots here unchanged.
        // ARIADNE_DESKTOP marks this as a trusted single-user loopback context.
        match resolve_runtime() {
            Some((node, entry, cwd)) => Command::new(&node)
                .arg("--import")
                .arg("tsx")
                .arg(&entry)
                .current_dir(&cwd)
                .env("ARIADNE_PORT", PORT.to_string())
                .env("ARIADNE_DESKTOP", "1")
                // Loopback-only: the desktop webview is the only client. The server
                // already defaults to 127.0.0.1, but set it explicitly so a stray
                // ARIADNE_BIND in the user's shell env can't expose the sidecar.
                .env("ARIADNE_BIND", "127.0.0.1")
                .env("ARIADNE_HOME", data.join("data"))
                .env("ARIADNE_LOG_DIR", data.join("logs"))
                .env("ARIADNE_RUN_DIR", data.join("run"))
                .spawn()
                .map_err(|e| eprintln!("Ariadne: failed to start the Node server: {e}"))
                .ok(),
            None => {
                eprintln!("Ariadne: could not locate the bundled Node runtime or server entry");
                None
            }
        }
    };

    // Already-alive servers are ready by definition; a freshly spawned one we
    // wait for.
    let ready = attach || wait_until_ready(PORT, Duration::from_secs(30));
    let url = format!("http://127.0.0.1:{PORT}");

    tauri::Builder::default()
        .manage(Sidecar(Mutex::new(sidecar)))
        .setup(move |app| {
            if !ready {
                eprintln!("Ariadne: server did not become ready on port {PORT} within 30s");
            }

            // Menu-bar tray — the app lives here; the window is just one client
            // onto the server. Status line, then open/browser, then quit.
            let status = MenuItem::with_id(app, "status", format!("Ariadne · running on :{PORT}"), false, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "Open window", true, None::<&str>)?;
            let browser = MenuItem::with_id(app, "browser", "Open in browser", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Ariadne", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &status,
                    &PredefinedMenuItem::separator(app)?,
                    &open,
                    &browser,
                    &PredefinedMenuItem::separator(app)?,
                    &quit,
                ],
            )?;
            TrayIconBuilder::new()
                // A monochrome glyph on transparent — marked as a template so
                // macOS recolors it to match the menu bar (no black box).
                .icon(tauri::include_image!("icons/trayTemplate.png"))
                .icon_as_template(true)
                .menu(&menu)
                .tooltip("Ariadne")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "browser" => {
                        let _ = Command::new("open")
                            .arg(format!("http://127.0.0.1:{PORT}"))
                            .spawn();
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // The window is shown on launch, but its close button HIDES it (the
            // tray + server keep running) instead of quitting the app.
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().unwrap()))
                .title("Ariadne")
                .inner_size(1280.0, 860.0)
                .min_inner_size(900.0, 600.0)
                .build()?;
            let hide_handle = win.clone();
            win.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = hide_handle.hide();
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Ariadne desktop shell")
        .run(|app, event| match event {
            // Tear down ONLY a sidecar we started (None when we attached to an
            // existing server — never kill that one).
            RunEvent::ExitRequested { .. } => {
                if let Some(state) = app.try_state::<Sidecar>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut child) = guard.take() {
                            stop_sidecar(&mut child);
                        }
                    }
                }
            }
            // Dock-icon click after the window was hidden — bring it back.
            RunEvent::Reopen { .. } => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            _ => {}
        });
}
