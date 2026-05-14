"""Chat/session domain facade for gradually shrinking storage.py."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from aiws import storage


def create_session(root: str | Path, project_path: str, title: str, **kwargs: Any) -> dict[str, Any]:
    return storage.create_session(root, project_path, title, **kwargs)


def create_general_session(root: str | Path, username: str | None, title: str, **kwargs: Any) -> tuple[str, dict[str, Any]]:
    return storage.create_general_chat_session(root, username, title, **kwargs)


def load_session(root: str | Path, project_path: str, session_slug: str) -> dict[str, Any]:
    return storage.load_session(root, project_path, session_slug)


def list_sessions(root: str | Path, project_path: str) -> list[dict[str, Any]]:
    return storage.list_sessions(root, project_path)


def append_message(root: str | Path, project_path: str, session_slug: str, **kwargs: Any) -> dict[str, Any]:
    return storage.append_message(root, project_path, session_slug, **kwargs)


def read_messages(root: str | Path, project_path: str, session_slug: str) -> list[dict[str, Any]]:
    return storage.read_messages(root, project_path, session_slug)


def move_to_project(root: str | Path, source_project_path: str, session_slug: str, target_project_path: str) -> dict[str, Any]:
    return storage.move_session_to_project(root, source_project_path, session_slug, target_project_path)


def move_to_general(root: str | Path, source_project_path: str, session_slug: str, username: str | None) -> tuple[str, dict[str, Any]]:
    return storage.move_session_to_general_chat(root, source_project_path, session_slug, username)


def update_title(root: str | Path, project_path: str, session_slug: str, title: str, *, auto: bool = False) -> dict[str, Any]:
    return storage.update_session_title(root, project_path, session_slug, title, auto=auto)


def delete_session(root: str | Path, project_path: str, session_slug: str) -> None:
    storage.delete_session(root, project_path, session_slug)


def next_slug(root: str | Path, project_path: str, base_slug: str) -> str:
    return storage.next_available_session_slug(root, project_path, base_slug)
