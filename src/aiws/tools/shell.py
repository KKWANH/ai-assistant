"""Permissioned shell command execution for local-first project actions."""

from __future__ import annotations

from dataclasses import dataclass
import os
import shlex
import subprocess
from pathlib import Path

from aiws import storage


DANGEROUS_PROGRAMS = {"sudo", "curl", "wget", "ssh", "scp", "nc", "chmod", "chown"}
DANGEROUS_SHELLS = {"bash", "sh", "zsh", "fish"}
DANGEROUS_STRING_TOKENS = (";", "|", "&&", "||", "`", "$(", ">", "<", "\n", "\r")
SAFE_ENV_KEYS = {"HOME", "LANG", "LC_ALL", "PATH", "TMPDIR"}


@dataclass(frozen=True)
class CommandSpec:
    argv: list[str]
    cwd: Path
    timeout_sec: int = 120
    stdin: str | None = None


@dataclass(frozen=True)
class CommandResult:
    args: list[str]
    returncode: int
    stdout: str
    stderr: str


def run(command: str | list[str] | tuple[str, ...] | CommandSpec, *, cwd: Path, timeout: int = 120) -> CommandResult:
    spec = command if isinstance(command, CommandSpec) else CommandSpec(
        argv=normalize_argv(command),
        cwd=cwd,
        timeout_sec=timeout,
    )
    validate_command(spec.argv)
    completed = subprocess.run(
        spec.argv,
        cwd=spec.cwd,
        shell=False,
        check=False,
        capture_output=True,
        text=True,
        timeout=spec.timeout_sec,
        stdin=spec.stdin,
        env=scrubbed_env(),
    )
    return CommandResult(
        args=list(completed.args) if isinstance(completed.args, (list, tuple)) else [str(completed.args)],
        returncode=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
    )


def normalize_argv(command: str | list[str] | tuple[str, ...]) -> list[str]:
    if isinstance(command, str):
        if any(token in command for token in DANGEROUS_STRING_TOKENS):
            raise storage.WorkspaceError("Shell metacharacters are not allowed in project actions.")
        try:
            argv = shlex.split(command)
        except ValueError as exc:
            raise storage.WorkspaceError(f"Invalid shell command: {exc}") from exc
    else:
        argv = [str(item) for item in command]
    if not argv:
        raise storage.WorkspaceError("Shell command is empty.")
    return argv


def validate_command(argv: list[str]) -> None:
    program = Path(argv[0]).name
    if program in DANGEROUS_PROGRAMS:
        raise storage.WorkspaceError(f"Command is not allowed by default: {program}")
    if program == "rm" and any("r" in arg.replace("-", "") for arg in argv[1:] if arg.startswith("-")):
        raise storage.WorkspaceError("Recursive remove is not allowed by default.")
    if program in DANGEROUS_SHELLS and len(argv) > 1 and argv[1] == "-c":
        raise storage.WorkspaceError(f"{program} -c is not allowed by default.")
    if program.startswith("python") and len(argv) > 1 and argv[1] == "-c":
        raise storage.WorkspaceError("python -c is not allowed by default.")


def scrubbed_env() -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if key in SAFE_ENV_KEYS}
    env.setdefault("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
    return env
