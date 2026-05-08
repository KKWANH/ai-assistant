"""Runtime launcher for AIWS and local model services."""

from __future__ import annotations

import json
import shutil
import signal
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from . import storage


@dataclass
class ManagedProcess:
    name: str
    command: list[str]
    process: subprocess.Popen[str] | None = None
    owned: bool = True
    restarts: int = 0
    enabled: bool = True

    def start(self) -> None:
        if not self.enabled or self.is_running():
            return
        self.process = subprocess.Popen(self.command, text=True, start_new_session=True)

    def is_running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def ensure_running(self) -> None:
        if not self.enabled:
            return
        if self.process is None:
            self.start()
        elif self.process.poll() is not None:
            self.restarts += 1
            self.start()

    def stop(self) -> None:
        if self.process is None or self.process.poll() is not None:
            return
        self.process.terminate()
        try:
            self.process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            self.process.kill()

    def status(self) -> dict[str, object]:
        return {
            "name": self.name,
            "running": self.is_running(),
            "returncode": None if self.process is None else self.process.poll(),
            "restarts": self.restarts,
            "command": self.command,
            "owned": self.owned,
            "enabled": self.enabled,
        }


class LocalRuntime:
    def __init__(
        self,
        *,
        root: str,
        mode: str,
        port: int,
        password: str | None,
        start_ollama: bool,
        idle_timeout: int,
        status_path: str | None,
    ) -> None:
        self.root = root
        self.mode = mode
        self.port = port
        self.password = password
        self.start_ollama = start_ollama
        self.idle_timeout = idle_timeout
        self.status_path = Path(status_path) if status_path else None
        self.processes: list[ManagedProcess] = []
        self._stopping = False
        self._last_activity_mtime = 0.0

    def build_processes(self) -> list[ManagedProcess]:
        ui_command = [
            sys.executable,
            "-m",
            "aiws.cli",
            "ui",
            "start",
            "--root",
            self.root,
            "--mode",
            self.mode,
            "--port",
            str(self.port),
        ]
        if self.password:
            ui_command.extend(["--password", self.password])
        processes = [ManagedProcess("aiws-ui", ui_command)]
        if self.start_ollama:
            ollama = shutil.which("ollama")
            if ollama and not is_port_open("127.0.0.1", 11434):
                processes.append(ManagedProcess("ollama", [ollama, "serve"]))
        return processes

    def newest_workspace_mtime(self) -> float:
        root = storage.workspace_path(self.root)
        if not root.exists():
            return time.time()
        newest = root.stat().st_mtime
        for path in (root / "projects").glob("**/*"):
            try:
                newest = max(newest, path.stat().st_mtime)
            except OSError:
                continue
        return newest

    def run_forever(self) -> None:
        storage.init_workspace(self.root)
        probe_host = "127.0.0.1" if self.mode == "local" else "127.0.0.1"
        if is_port_open(probe_host, self.port):
            print(f"Assistant is already running at http://{probe_host}:{self.port}")
            return
        self.processes = self.build_processes()
        self._last_activity_mtime = self.newest_workspace_mtime()
        for process in self.processes:
            process.start()
        signal.signal(signal.SIGTERM, self._handle_stop)
        signal.signal(signal.SIGINT, self._handle_stop)
        try:
            while not self._stopping:
                newest_mtime = self.newest_workspace_mtime()
                if newest_mtime > self._last_activity_mtime:
                    self._last_activity_mtime = newest_mtime
                    for process in self.processes:
                        if process.name == "ollama":
                            process.enabled = True
                idle_seconds = time.time() - newest_mtime
                for process in self.processes:
                    if process.name == "ollama" and self.idle_timeout > 0 and idle_seconds > self.idle_timeout:
                        process.stop()
                        process.enabled = False
                    process.ensure_running()
                self.write_status(idle_seconds)
                time.sleep(2)
        finally:
            for process in reversed(self.processes):
                process.stop()
            self.write_status(0)

    def write_status(self, idle_seconds: float) -> None:
        if not self.status_path:
            return
        self.status_path.parent.mkdir(parents=True, exist_ok=True)
        self.status_path.write_text(
            json.dumps(
                {
                    "root": self.root,
                    "mode": self.mode,
                    "port": self.port,
                    "idle_seconds": round(idle_seconds, 2),
                    "idle_timeout": self.idle_timeout,
                    "processes": [process.status() for process in self.processes],
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

    def _handle_stop(self, signum: int, frame: object) -> None:
        self._stopping = True


def is_port_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex((host, port)) == 0
