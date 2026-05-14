"""Project domain facade for gradually shrinking storage.py."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from aiws import storage


def create(root: str | Path, title: str, **kwargs: Any) -> dict[str, Any]:
    return storage.create_project(root, title, **kwargs)


def load(root: str | Path, project_path: str) -> dict[str, Any]:
    return storage.load_project(root, project_path)


def visible(root: str | Path, username: str | None) -> list[dict[str, Any]]:
    return storage.list_visible_projects(root, username)


def list_all(root: str | Path) -> list[dict[str, Any]]:
    return storage.list_projects(root)


def visible_general_chats(root: str | Path, username: str | None) -> list[dict[str, Any]]:
    return storage.list_visible_general_chat_projects(root, username)


def update_title(root: str | Path, project_path: str, title: str) -> dict[str, Any]:
    return storage.update_project_title(root, project_path, title)


def delete(root: str | Path, project_path: str) -> None:
    storage.delete_project(root, project_path)
