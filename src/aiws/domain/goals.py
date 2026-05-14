"""Goal domain facade for project objective and Codex prompt operations."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from aiws import storage


def load(root: str | Path, project_path: str) -> dict[str, Any]:
    return storage.load_goal(root, project_path)


def save(root: str | Path, project_path: str, data: dict[str, Any]) -> dict[str, Any]:
    return storage.save_goal(root, project_path, data)


def codex_prompt(root: str | Path, project_path: str, session_slug: str | None = None) -> str:
    return storage.codex_goal_prompt(root, project_path, session_slug)
