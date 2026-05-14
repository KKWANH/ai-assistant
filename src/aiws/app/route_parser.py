"""Route parsing helpers shared by the legacy HTTP handler and tests."""

from __future__ import annotations

from aiws import storage


def split_project_session_route(route: str) -> tuple[str, str]:
    parts = [part for part in route.split("/") if part]
    if len(parts) < 2:
        raise storage.WorkspaceError("Invalid project/session route.")
    session_slug = parts[-1]
    project_path = "/".join(parts[:-1])
    storage.parse_project_path(project_path)
    if session_slug != storage.slugify(session_slug):
        raise storage.WorkspaceError("Session slug must be a slug ID.")
    return project_path, session_slug


def split_project_action_route(route: str) -> tuple[str, str]:
    project_path, command = split_project_session_route(route)
    if not command or not all(ch.isalnum() or ch in "_-" for ch in command):
        raise storage.WorkspaceError("Project action command must be a slug ID.")
    return project_path, command
