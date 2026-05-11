"""Safe-ish shell command execution for local-first project actions."""

from __future__ import annotations

import subprocess
from pathlib import Path


def run(command: str, *, cwd: Path, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=cwd,
        shell=True,
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )

