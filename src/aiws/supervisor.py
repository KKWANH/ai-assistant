"""Lightweight process supervisor for AIWS commands."""

from __future__ import annotations

import json
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ProcessStatus:
    running: bool
    returncode: int | None
    restarts: int
    command: list[str]


class StatusSupervisor:
    def __init__(self, command: list[str], *, restart: bool = True, interval: float = 1.0) -> None:
        self.command = command
        self.restart = restart
        self.interval = interval
        self.restarts = 0
        self.process: subprocess.Popen[str] | None = None

    def start(self) -> None:
        self.process = subprocess.Popen(self.command, text=True, start_new_session=True)

    def status(self) -> ProcessStatus:
        returncode = None if self.process is None else self.process.poll()
        return ProcessStatus(
            running=self.process is not None and returncode is None,
            returncode=returncode,
            restarts=self.restarts,
            command=self.command,
        )

    def run_once(self) -> ProcessStatus:
        if self.process is None:
            self.start()
        elif self.restart and self.process.poll() is not None:
            self.restarts += 1
            self.start()
        return self.status()

    def run_forever(self, status_path: str | Path | None = None) -> None:
        try:
            while True:
                status = self.run_once()
                if status_path:
                    write_status(status_path, status)
                time.sleep(self.interval)
        finally:
            if self.process and self.process.poll() is None:
                self.process.terminate()


def write_status(path: str | Path, status: ProcessStatus) -> None:
    Path(path).write_text(
        json.dumps(
            {
                "running": status.running,
                "returncode": status.returncode,
                "restarts": status.restarts,
                "command": status.command,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
