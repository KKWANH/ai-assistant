"""Python script execution for confirmed local AIWS project actions."""

from __future__ import annotations

from dataclasses import dataclass
import subprocess
import sys
from pathlib import Path

from aiws import storage
from aiws.tools.shell import scrubbed_env, truncate_output


@dataclass(frozen=True)
class PythonResult:
    args: list[str]
    returncode: int
    stdout: str
    stderr: str


def run(
    script: Path,
    args: list[str],
    *,
    cwd: Path,
    root: Path | None = None,
    timeout: int = 120,
    output_limit: int = 200_000,
    allow_network: bool = False,
    extra_env: dict[str, str] | None = None,
) -> PythonResult:
    validate_paths(script, cwd, root)
    env = scrubbed_env()
    env["AIWS_NETWORK_ALLOWED"] = "1" if allow_network else "0"
    if extra_env:
        env.update({str(key): str(value) for key, value in extra_env.items()})
    completed = subprocess.run(
        [sys.executable, str(script), *args],
        cwd=cwd,
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
        env=env,
    )
    return PythonResult(
        args=list(completed.args),
        returncode=completed.returncode,
        stdout=truncate_output(completed.stdout, output_limit),
        stderr=truncate_output(completed.stderr, output_limit),
    )


def validate_paths(script: Path, cwd: Path, root: Path | None) -> None:
    if root is None:
        return
    root_path = root.expanduser().resolve()
    if not script.expanduser().resolve().is_relative_to(root_path):
        raise storage.WorkspaceError("Python script escapes the project root.")
    if not cwd.expanduser().resolve().is_relative_to(root_path):
        raise storage.WorkspaceError("Python cwd escapes the project root.")
