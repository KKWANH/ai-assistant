// Ariadne desktop — Tauri shell (macOS-first; Windows/Linux now wired too).
//
// The shell stays tiny: connect-or-spawn the EXISTING Node server on a fixed
// loopback port, wait until it answers, then point a webview at it. The sidecar
// pattern keeps every line of server code identical across platforms; the only
// OS-specific bits are path resolution (handled via Tauri's path API), the node
// binary name, the dev target-triple, and how we open an external URL.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env::consts::{ARCH, OS};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// Holds the Node sidecar so it can be killed when the app exits. None when we
/// attached to a server we didn't start (so we never kill it).
struct Sidecar(Mutex<Option<Child>>);

/// The canonical Ariadne port — the web/ops server uses it too. Fixed (not a
/// random free port) so the desktop ATTACHES to an already-running server and
/// shares its data, and so the webview origin is stable (localStorage persists).
const PORT: u16 = 4319;

/// A self-contained dark splash (base64 data URL) shown the instant the window
/// opens, so a cold launch reads as "starting…" instead of a blank/white screen
/// while the Node backend boots. The boot thread navigates to the app over it
/// once the server answers — a different (data:) origin, so it never touches the
/// app's localStorage. Kept tiny + inline so there's no asset to ship or resolve.
const SPLASH_B64: &str = "PCFkb2N0eXBlIGh0bWw+PG1ldGEgY2hhcnNldD11dGYtOD48dGl0bGU+QXJpYWRuZTwvdGl0bGU+PGJvZHkgc3R5bGU9Im1hcmdpbjowO2hlaWdodDoxMDB2aDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2JhY2tncm91bmQ6IzBiMGIwYztjb2xvcjojZTZlNmU2O2ZvbnQtZmFtaWx5Oi1hcHBsZS1zeXN0ZW0sc3lzdGVtLXVpLHNhbnMtc2VyaWYiPjxkaXYgc3R5bGU9ImZvbnQtc2l6ZToyNHB4O2ZvbnQtd2VpZ2h0OjcwMDtsZXR0ZXItc3BhY2luZzotLjAyZW0iPkFyaWFkbmU8L2Rpdj48ZGl2IGlkPW0gc3R5bGU9Im1hcmdpbi10b3A6OHB4O2ZvbnQtc2l6ZToxM3B4O2NvbG9yOiM3YTdhN2EiPlN0YXJ0aW5nIHRoZSBsb2NhbCBzZXJ2ZXLigKY8L2Rpdj48ZGl2IHN0eWxlPSJtYXJnaW4tdG9wOjIwcHg7d2lkdGg6MjRweDtoZWlnaHQ6MjRweDtib3JkZXI6Mi41cHggc29saWQgIzJhMmEyYztib3JkZXItdG9wLWNvbG9yOiM5YTlhOWE7Ym9yZGVyLXJhZGl1czo1MCU7YW5pbWF0aW9uOnNwaW4gLjhzIGxpbmVhciBpbmZpbml0ZSI+PC9kaXY+PHN0eWxlPkBrZXlmcmFtZXMgc3Bpbnt0b3t0cmFuc2Zvcm06cm90YXRlKDM2MGRlZyl9fTwvc3R5bGU+PC9ib2R5Pgo=";

/// The splash as a navigable data URL.
fn splash_url() -> String {
    format!("data:text/html;base64,{SPLASH_B64}")
}

/// Is a real Ariadne server already answering on this port? A bare TCP connect
/// isn't enough, so probe an API route and look for an HTTP status line — a live
/// server answers 200 (loopback admin) or 401. Avoids a second server.
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

/// Poll until the server actually answers an HTTP request (not just opens the
/// port — `server_alive` does the real probe). Used as the gate before we
/// navigate the webview off the splash, so the app loads against a server that's
/// genuinely serving, not one mid-boot.
fn wait_until_alive(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if server_alive(port) {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    false
}

/// nodejs.org-style target-triple suffix for the dev sidecar binary, per host
/// OS/arch — matches what scripts/fetch-node-sidecar.sh writes into binaries/.
fn dev_triple() -> &'static str {
    match (OS, ARCH) {
        ("macos", "aarch64") => "aarch64-apple-darwin",
        ("macos", "x86_64") => "x86_64-apple-darwin",
        ("windows", "x86_64") => "x86_64-pc-windows-msvc",
        ("linux", "aarch64") => "aarch64-unknown-linux-gnu",
        ("linux", "x86_64") => "x86_64-unknown-linux-gnu",
        _ => "aarch64-apple-darwin",
    }
}

/// The sidecar node filename. Tauri strips the triple on install; only the
/// platform extension remains (node.exe on Windows, node elsewhere).
fn node_bin_name() -> &'static str {
    if cfg!(windows) { "node.exe" } else { "node" }
}

/// Where the server keeps user data — the OS app-data dir (NOT the read-only
/// bundle). Tauri resolves this per-platform (macOS Application Support,
/// Windows %APPDATA%, Linux XDG_DATA_HOME); we fall back manually if it can't.
fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(dir) = app.path().app_data_dir() {
        return dir;
    }
    let base = if cfg!(target_os = "windows") {
        std::env::var("APPDATA").unwrap_or_else(|_| ".".into())
    } else if cfg!(target_os = "macos") {
        format!(
            "{}/Library/Application Support",
            std::env::var("HOME").unwrap_or_else(|_| "/tmp".into())
        )
    } else {
        std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| {
            format!("{}/.local/share", std::env::var("HOME").unwrap_or_else(|_| "/tmp".into()))
        })
    };
    PathBuf::from(base).join("Ariadne")
}

/// Locate the Node runtime + server entry + working dir for both bundled and dev
/// runs, cross-platform:
///   bundled → sidecar node next to the app binary + staged server in the
///             resource dir (Tauri resolves the per-OS resource location).
///   dev     → the fetched sidecar binary + the repo's source tree.
/// Returns None if neither layout is present (the caller surfaces the error).
fn resolve_runtime(app: &tauri::AppHandle) -> Option<(PathBuf, PathBuf, PathBuf)> {
    // Bundled layout: the externalBin sidecar sits next to the main executable;
    // the staged server tree is shipped as a resource (mapped to "server").
    if let Ok(exe) = std::env::current_exe() {
        if let Some(bin_dir) = exe.parent() {
            let node = bin_dir.join(node_bin_name());
            if let Ok(res) = app.path().resource_dir() {
                let server_root = res.join("server");
                let entry = server_root.join("apps/server/src/index.ts");
                if node.exists() && entry.exists() {
                    return Some((node, entry, server_root));
                }
            }
        }
    }

    // Dev fallback: the fetched sidecar binary + the repo's source (run via tsx
    // exactly like the bundle, so dev and prod take the same path).
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")); // apps/desktop/src-tauri
    let dev_name = format!("node-{}{}", dev_triple(), if cfg!(windows) { ".exe" } else { "" });
    let dev_node = manifest.join("binaries").join(dev_name);
    let repo = manifest.join("../../..").canonicalize().ok()?;
    let entry = repo.join("apps/server/src/index.ts");
    if dev_node.exists() && entry.exists() {
        return Some((dev_node, entry, repo));
    }
    None
}

/// Spawn the bundled Node server with user-data env redirected outside the
/// (read-only) bundle. Returns the child so it can be torn down on exit.
fn spawn_server(app: &tauri::AppHandle) -> Option<Child> {
    let data = data_dir(app);
    for sub in ["data", "logs", "run"] {
        let _ = std::fs::create_dir_all(data.join(sub));
    }
    match resolve_runtime(app) {
        Some((node, entry, cwd)) => Command::new(&node)
            .arg("--import")
            .arg("tsx")
            .arg(&entry)
            .current_dir(&cwd)
            // tsx auto-detects tsconfig from the CWD, but the one carrying the
            // @ariadne/* path aliases lives at apps/server/tsconfig.json (not the
            // server root). Point tsx straight at it, or the sidecar dies on a
            // bare `@ariadne/shared` import — which is exactly why a cold launch
            // with no server to attach to used to hang on a blank screen.
            .env("TSX_TSCONFIG_PATH", cwd.join("apps/server/tsconfig.json"))
            .env("ARIADNE_PORT", PORT.to_string())
            .env("ARIADNE_DESKTOP", "1")
            // Loopback-only: the desktop webview is the only client.
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
}

/// Open a URL in the user's default browser, cross-platform.
fn open_url(url: &str) {
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").arg(url).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("cmd").args(["/C", "start", "", url]).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("xdg-open").arg(url).spawn();
    }
}

/// Stop the Node sidecar *gracefully* so its SIGTERM handler runs (the server
/// tears down MCP child processes on SIGTERM). On Unix: SIGTERM, pause, then
/// force-kill as a backstop. Elsewhere: a plain kill.
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

/// Point the main window at `url`, dispatched onto the UI thread so it's safe to
/// call from a background boot/restart thread.
fn navigate_main(handle: &tauri::AppHandle, url: &str) {
    if let Some(w) = handle.get_webview_window("main") {
        let url = url.to_string();
        let _ = handle.run_on_main_thread(move || {
            if let Ok(u) = url.parse() {
                let _ = w.navigate(u);
            }
        });
    }
}

/// Tray "Restart server": flip the window back to the splash, then on a worker
/// thread stop the sidecar we own, start a fresh one, and navigate back to the
/// app once it answers. For an ATTACHED server (we don't own it) there's nothing
/// to restart — we just wait for it to answer and reload, never killing it.
fn restart_server(handle: &tauri::AppHandle, app_url: &str) {
    navigate_main(handle, &splash_url());
    let handle = handle.clone();
    let app_url = app_url.to_string();
    thread::spawn(move || {
        // Take the child OUT of the lock before the (blocking) stop, so a
        // concurrent quit isn't stuck waiting on the mutex during teardown.
        let mut owned = None;
        if let Some(state) = handle.try_state::<Sidecar>() {
            if let Ok(mut guard) = state.0.lock() {
                owned = guard.take();
            }
        }
        if let Some(mut child) = owned {
            stop_sidecar(&mut child);
            thread::sleep(Duration::from_millis(600)); // let the port free
            let fresh = spawn_server(&handle);
            if let Some(state) = handle.try_state::<Sidecar>() {
                if let Ok(mut guard) = state.0.lock() {
                    *guard = fresh;
                }
            }
        }
        wait_until_alive(PORT, Duration::from_secs(60));
        navigate_main(&handle, &app_url);
    });
}

/// macOS: put the bare Ariadne symbol (no background tile) in the Dock via
/// `NSDockTile.contentView`. The bundle `.icns` (frosted glass) still drives the
/// Cmd+Tab app switcher — the switcher reads the app icon, not the dock tile — so
/// the two intentionally differ (Dock = bare symbol, switcher = glass). Fully
/// guarded: any missing piece just leaves the default glass icon in the Dock.
#[cfg(target_os = "macos")]
fn set_dock_icon() {
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage, NSImageView};
    use objc2_foundation::NSData;
    let Some(mtm) = MainThreadMarker::new() else { return };
    let data = NSData::with_bytes(include_bytes!("../icons/dock-icon.png"));
    let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) else {
        return;
    };
    let view = NSImageView::imageViewWithImage(&image, mtm);
    let tile = NSApplication::sharedApplication(mtm).dockTile();
    tile.setContentView(Some(&view));
    tile.display();
}

fn main() {
    let url = format!("http://127.0.0.1:{PORT}");

    tauri::Builder::default()
        .manage(Sidecar(Mutex::new(None)))
        // App menu with keyboard recovery: Cmd+R reloads the page; Cmd+Shift+H
        // does a NATIVE navigate back to the light home — which escapes even a
        // hung/blank webview (a heavy surface that wedged WebContent), where an
        // in-page reload can't run. Built on the standard menu so copy/paste/quit
        // survive.
        .menu(|handle| {
            let menu = Menu::default(handle)?;
            let reload = MenuItem::with_id(handle, "menu_reload", "Reload", true, Some("CmdOrCtrl+R"))?;
            let home = MenuItem::with_id(handle, "menu_home", "Home (recover)", true, Some("CmdOrCtrl+Shift+H"))?;
            let view = Submenu::with_items(handle, "View", true, &[&reload, &home])?;
            menu.append(&view)?;
            Ok(menu)
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "menu_reload" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.eval("window.location.reload()");
                }
            }
            "menu_home" => {
                if let Some(w) = app.get_webview_window("main") {
                    if let Ok(u) = format!("http://127.0.0.1:{PORT}/").parse() {
                        let _ = w.navigate(u);
                    }
                }
            }
            _ => {}
        })
        .setup(move |app| {
            // Show the window with a splash IMMEDIATELY — a cold launch then
            // reads as "starting…" instead of a blank/white window while the Node
            // backend boots. Its close button HIDES the window (tray + server keep
            // running) rather than quitting.
            let win = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(splash_url().parse().unwrap()),
            )
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

            // Menu-bar tray — the app lives here; the window is one client onto
            // the server. "Restart server" reboots the sidecar; "Reload window"
            // recovers a blank/stuck webview — both without quitting.
            let status = MenuItem::with_id(app, "status", format!("Ariadne · running on :{PORT}"), false, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "Open window", true, None::<&str>)?;
            let reload = MenuItem::with_id(app, "reload", "Reload window", true, None::<&str>)?;
            let restart = MenuItem::with_id(app, "restart", "Restart server", true, None::<&str>)?;
            let browser = MenuItem::with_id(app, "browser", "Open in browser", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Ariadne", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &status,
                    &PredefinedMenuItem::separator(app)?,
                    &open,
                    &reload,
                    &restart,
                    &browser,
                    &PredefinedMenuItem::separator(app)?,
                    &quit,
                ],
            )?;
            let tray_url = url.clone();
            TrayIconBuilder::new()
                .icon(tauri::include_image!("icons/trayTemplate.png"))
                .icon_as_template(true)
                .menu(&menu)
                .tooltip("Ariadne")
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "reload" => {
                        if let Some(w) = app.get_webview_window("main") {
                            // Native navigate to the light home — escapes even a
                            // hung/blank webview (where an in-page reload can't run).
                            if let Ok(u) = format!("http://127.0.0.1:{PORT}/").parse() {
                                let _ = w.navigate(u);
                            }
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "restart" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                        restart_server(app, &tray_url);
                    }
                    "browser" => open_url(&format!("http://127.0.0.1:{PORT}")),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // Connect-or-spawn the server on a BACKGROUND thread, then navigate
            // the window off the splash to the app once it answers HTTP. Done off
            // the setup thread so the splash actually paints during boot (a
            // blocking wait here would freeze the window before it could render).
            let boot_handle = app.handle().clone();
            let boot_url = url.clone();
            thread::spawn(move || {
                let attach = server_alive(PORT);
                if !attach {
                    let child = spawn_server(&boot_handle);
                    if let Some(state) = boot_handle.try_state::<Sidecar>() {
                        if let Ok(mut guard) = state.0.lock() {
                            *guard = child;
                        }
                    }
                }
                let ready = attach || wait_until_alive(PORT, Duration::from_secs(60));
                if !ready {
                    eprintln!("Ariadne: server did not become ready on :{PORT} within 60s");
                }
                navigate_main(&boot_handle, &boot_url);
            });

            // Dock shows the bare symbol; the glass .icns stays for Cmd+Tab.
            #[cfg(target_os = "macos")]
            set_dock_icon();

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Ariadne desktop shell")
        .run(|app, event| match event {
            // Tear down ONLY a sidecar we started (None when we attached).
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
            // macOS-only: RunEvent::Reopen doesn't exist on Linux/Windows, so the
            // arm must be cfg'd out there or the match fails to compile.
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            _ => {}
        });
}
