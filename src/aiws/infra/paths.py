"""Path confinement helpers for local-first workspace operations."""

from __future__ import annotations

from pathlib import Path

from aiws import storage


def resolve_under_root(root: str | Path, user_path: str | Path, *, allow_absolute: bool = False) -> Path:
    """Resolve a user supplied path and require it to stay inside root."""
    root_path = Path(root).expanduser().resolve()
    raw = Path(user_path).expanduser()
    if not str(user_path).strip():
        raise storage.WorkspaceError("Path is required.")
    if raw.is_absolute():
        if not allow_absolute:
            raise storage.WorkspaceError("Absolute paths are not allowed for project actions.")
        resolved = raw.resolve()
    else:
        resolved = (root_path / raw).resolve()
    if not resolved.is_relative_to(root_path):
        raise storage.WorkspaceError("Path escapes the allowed root.")
    return resolved


def relative_to_root(root: str | Path, path: str | Path) -> str:
    return Path(path).expanduser().resolve().relative_to(Path(root).expanduser().resolve()).as_posix()
