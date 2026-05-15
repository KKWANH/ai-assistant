"""Background Cloudflare quick tunnel supervisor."""

from __future__ import annotations

import os
import json
import queue
import re
import signal
import socket
import subprocess
import threading
import time
from pathlib import Path

from .env import load_env, repo_root

URL_RE = re.compile(r"https://[^\s]+trycloudflare\.com")


def env_value(name: str, default: str) -> str:
    return os.environ.get(name, default)


def port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def terminate(process: subprocess.Popen[str] | None) -> None:
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def kill_port_listeners(port: int) -> None:
    result = subprocess.run(
        ["lsof", "-tiTCP:%s" % port, "-sTCP:LISTEN"],
        capture_output=True,
        text=True,
        check=False,
    )
    for raw_pid in result.stdout.splitlines():
        try:
            os.kill(int(raw_pid), signal.SIGTERM)
        except (ProcessLookupError, ValueError):
            pass
    if result.stdout.strip():
        time.sleep(1)


def kill_old_tunnels(port: int) -> None:
    subprocess.run(
        ["pkill", "-f", f"cloudflared tunnel .*127.0.0.1:{port}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def main() -> int:
    load_env()
    root = repo_root()
    workspace = Path(env_value("AIWS_ROOT", str(Path.home() / ".ai-workspace"))).expanduser()
    port = int(env_value("AIWS_PORT", "8765"))
    log_dir = Path(env_value("AIWS_LOG_DIR", str(workspace / "logs"))).expanduser()
    run_dir = Path(env_value("AIWS_RUN_DIR", str(workspace / "run"))).expanduser()
    password = os.environ.get("AIWS_SERVER_PASSWORD", "")
    protocol = env_value("AIWS_CLOUDFLARED_PROTOCOL", "http2")
    log_dir.mkdir(parents=True, exist_ok=True)
    run_dir.mkdir(parents=True, exist_ok=True)
    server_log_path = log_dir / "aiws-server.log"
    tunnel_log_path = log_dir / "cloudflared.log"
    monitor_log_path = log_dir / "aiws-cloudflare-monitor.log"
    url_path = run_dir / "cloudflare-url.txt"
    stop_path = run_dir / "aiws-cloudflare.stop"
    status_path = Path(env_value("AIWS_STATUS_PATH", str(workspace / "runtime-status.json"))).expanduser()
    child_status_path = Path(env_value("AIWS_LOCAL_RUNTIME_STATUS_PATH", str(run_dir / "aiws-runtime-status.json"))).expanduser()
    if not password:
        monitor_log_path.write_text("AIWS_SERVER_PASSWORD is required in .env\n", encoding="utf-8")
        return 1

    stopping = False

    def handle_signal(_signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True
        stop_path.touch()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    server: subprocess.Popen[str] | None = None
    tunnel: subprocess.Popen[str] | None = None
    python = str(root / ".venv" / "bin" / "python")
    env = os.environ.copy()

    def log(message: str) -> None:
        with monitor_log_path.open("a", encoding="utf-8") as file:
            file.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {message}\n")

    def write_status(status: str, *, url: str = "", message: str = "") -> None:
        payload = {
            "status": status,
            "message": message,
            "cloudflare_url": url,
            "port": port,
            "workspace": str(workspace),
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "pids": {
                "daemon": os.getpid(),
                "server": server.pid if server and server.poll() is None else None,
                "cloudflared": tunnel.pid if tunnel and tunnel.poll() is None else None,
            },
            "logs": {
                "monitor": str(monitor_log_path),
                "server": str(server_log_path),
                "cloudflared": str(tunnel_log_path),
            },
        }
        status_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    def pump_tunnel_output(stream: object, output: Path, lines: "queue.Queue[str]") -> None:
        with output.open("w", encoding="utf-8") as tunnel_log:
            for line in stream:  # type: ignore[operator]
                tunnel_log.write(line)
                tunnel_log.flush()
                lines.put(line)

    kill_port_listeners(port)
    kill_old_tunnels(port)
    url_path.unlink(missing_ok=True)
    write_status("starting", message="Starting AIWS server and Cloudflare tunnel.")

    while not stopping and not stop_path.exists():
        with server_log_path.open("a", encoding="utf-8") as server_log:
            log(f"starting AIWS server on port {port}")
            server = subprocess.Popen(
                [
                    python,
                    "-m",
                    "aiws.cli",
                    "run",
                    "--root",
                    str(workspace),
                    "--mode",
                    "server",
                    "--port",
                    str(port),
                    "--password",
                    password,
                    "--models",
                    env_value("AIWS_MODELS", "ollama"),
                    "--idle-timeout",
                    env_value("AIWS_MODEL_IDLE_TIMEOUT", "1800"),
                    "--status-path",
                    str(child_status_path),
                ],
                cwd=str(root),
                env=env,
                stdout=server_log,
                stderr=subprocess.STDOUT,
                text=True,
            )
            write_status("starting", message="Waiting for AIWS server port.")
            for _ in range(80):
                if port_open(port):
                    break
                if server.poll() is not None:
                    break
                time.sleep(0.25)

        if not port_open(port):
            log("AIWS server did not open the port; restarting")
            write_status("restarting", message="AIWS server did not open the port.")
            terminate(server)
            time.sleep(3)
            continue

        url_path.unlink(missing_ok=True)
        log(f"starting cloudflared tunnel with protocol={protocol}")
        tunnel = subprocess.Popen(
            [
                "cloudflared",
                "tunnel",
                "--protocol",
                protocol,
                "--url",
                f"http://127.0.0.1:{port}",
            ],
            cwd=str(root),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert tunnel.stdout is not None
        output_lines: "queue.Queue[str]" = queue.Queue()
        reader = threading.Thread(
            target=pump_tunnel_output,
            args=(tunnel.stdout, tunnel_log_path, output_lines),
            daemon=True,
        )
        reader.start()
        current_url = ""
        write_status("starting", message="Waiting for Cloudflare quick tunnel URL.")

        while not stopping and not stop_path.exists():
            try:
                line = output_lines.get(timeout=0.5)
            except queue.Empty:
                line = ""
            if line:
                match = URL_RE.search(line)
                if match:
                    current_url = match.group(0)
                    url_path.write_text(current_url + "\n", encoding="utf-8")
                    write_status("running", url=current_url, message="Cloudflare tunnel is running.")
                    log(f"cloudflared URL {current_url}")
            if server.poll() is not None:
                log("AIWS server exited; restarting pair")
                write_status("restarting", url=current_url, message="AIWS server exited.")
                break
            if tunnel.poll() is not None:
                log("cloudflared exited; restarting pair")
                write_status("restarting", url=current_url, message="cloudflared exited.")
                break
            if current_url:
                write_status("running", url=current_url, message="Cloudflare tunnel is running.")
            time.sleep(0.5)

        terminate(tunnel)
        terminate(server)
        if not stopping and not stop_path.exists():
            time.sleep(3)

    terminate(tunnel)
    terminate(server)
    url_path.unlink(missing_ok=True)
    write_status("stopped", message="Cloudflare daemon stopped.")
    log("monitor stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
