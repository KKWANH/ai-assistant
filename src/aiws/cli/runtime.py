import json
import os
import signal
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class RuntimePaths:
    root: Path = Path(".aiws/runtime")

    @property
    def logs(self) -> Path:
        return self.root / "logs"

    @property
    def api_pid(self) -> Path:
        return self.root / "aiws.pid"

    @property
    def cloudflare_pid(self) -> Path:
        return self.root / "cloudflared.pid"

    @property
    def status_json(self) -> Path:
        return self.root / "status.json"

    @property
    def api_log(self) -> Path:
        return self.logs / "aiws.log"

    @property
    def cloudflare_log(self) -> Path:
        return self.logs / "cloudflared.log"

    def ensure(self) -> None:
        self.logs.mkdir(parents=True, exist_ok=True)


def is_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def read_pid(path: Path) -> int | None:
    if not path.exists():
        return None
    try:
        return int(path.read_text(encoding="utf-8").strip())
    except ValueError:
        return None


def stop_pid_file(path: Path, *, timeout_seconds: float = 8.0) -> bool:
    pid = read_pid(path)
    if pid is None:
        return False
    if not is_running(pid):
        path.unlink(missing_ok=True)
        return False
    os.kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if not is_running(pid):
            path.unlink(missing_ok=True)
            return True
        time.sleep(0.1)
    os.kill(pid, signal.SIGKILL)
    path.unlink(missing_ok=True)
    return True


def write_status(paths: RuntimePaths, data: dict[str, Any]) -> None:
    paths.root.mkdir(parents=True, exist_ok=True)
    paths.status_json.write_text(
        json.dumps(data, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def read_status(paths: RuntimePaths) -> dict[str, Any]:
    if not paths.status_json.exists():
        return {}
    decoded = json.loads(paths.status_json.read_text(encoding="utf-8"))
    if not isinstance(decoded, dict):
        return {}
    return decoded


def start_api_daemon(
    *,
    host: str,
    port: int,
    workspace_root: Path,
    paths: RuntimePaths,
) -> int:
    paths.ensure()
    existing = read_pid(paths.api_pid)
    if existing and is_running(existing):
        return existing
    env = os.environ.copy()
    env["AIWS_WORKSPACE_ROOT"] = str(workspace_root.resolve())
    env["AIWS_LOG_DIR"] = str(paths.logs.resolve())
    log_file = paths.api_log.open("ab")
    process = subprocess.Popen(
        [
            str(Path(".venv/bin/python") if Path(".venv/bin/python").exists() else "python3"),
            "-m",
            "uvicorn",
            "aiws.api.app:app",
            "--host",
            host,
            "--port",
            str(port),
        ],
        stdout=log_file,
        stderr=subprocess.STDOUT,
        env=env,
        start_new_session=True,
    )
    paths.api_pid.write_text(str(process.pid), encoding="utf-8")
    return process.pid


def start_cloudflare_quick_tunnel(*, port: int, paths: RuntimePaths) -> int:
    paths.ensure()
    existing = read_pid(paths.cloudflare_pid)
    if existing and is_running(existing):
        return existing
    log_file = paths.cloudflare_log.open("ab")
    process = subprocess.Popen(
        ["cloudflared", "tunnel", "--url", f"http://localhost:{port}"],
        stdout=log_file,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    paths.cloudflare_pid.write_text(str(process.pid), encoding="utf-8")
    return process.pid
