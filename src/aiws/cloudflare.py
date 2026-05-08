"""Console entry point for the local Cloudflare quick tunnel helper."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "aiws-cloudflare.sh"
    if not script.exists():
        raise SystemExit(f"Missing helper script: {script}")
    return subprocess.call([str(script), *sys.argv[1:]], env=os.environ.copy())
