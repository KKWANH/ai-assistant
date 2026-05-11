"""Python script execution for confirmed local AIWS project actions."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def run(script: Path, args: list[str], *, cwd: Path, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(script), *args],
        cwd=cwd,
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )

