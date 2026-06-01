// Ariadne desktop — Phase 0 spike (see docs/DESKTOP_APP_PLAN.md §7).
//
// The shell is deliberately tiny: pick a free loopback port, spawn the EXISTING
// Node server unchanged (it already honours ARIADNE_PORT), wait until it
// answers, then point a WKWebView at it. No code in apps/server changes — the
// whole point of the sidecar pattern.
//
// Phase 0 = dev spike: spawns `npm run start:server` from the monorepo, so it
// needs npm + the repo on disk. Phase 1 swaps that for a bundled Node binary
// shipped as a Tauri `externalBin` sidecar, plus signing/notarization.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

/// Holds the Node sidecar so it can be killed when the app exits.
struct Sidecar(Mutex<Option<Child>>);

/// Ask the OS for a free loopback port by binding :0 and reading it back.
fn pick_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(4319)
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

/// Repo root, resolved from this crate at compile time
/// (apps/desktop/src-tauri → ../../..). Phase 1 replaces this with the bundled
/// sidecar path so the app no longer depends on the source tree.
fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn main() {
    let port = pick_free_port();
    let root = repo_root();

    // Spawn the unchanged Node server. ARIADNE_DESKTOP marks this as a trusted
    // single-user loopback context (DESKTOP_APP_PLAN §4.2 auth note).
    let sidecar = Command::new("npm")
        .args(["run", "start:server"])
        .current_dir(&root)
        .env("ARIADNE_PORT", port.to_string())
        .env("ARIADNE_DESKTOP", "1")
        .spawn()
        .map_err(|e| eprintln!("Ariadne: failed to start the Node server: {e}"))
        .ok();

    let ready = wait_until_ready(port, Duration::from_secs(30));
    let url = format!("http://127.0.0.1:{port}");

    tauri::Builder::default()
        .manage(Sidecar(Mutex::new(sidecar)))
        .setup(move |app| {
            if !ready {
                eprintln!("Ariadne: server did not become ready on port {port} within 30s");
            }
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().unwrap()))
                .title("Ariadne")
                .inner_size(1280.0, 860.0)
                .min_inner_size(900.0, 600.0)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Ariadne desktop shell")
        .run(|app, event| {
            // Tear the sidecar down with the app so no orphan server lingers.
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app.try_state::<Sidecar>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}
