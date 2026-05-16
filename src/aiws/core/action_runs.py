"""Shared action/run façade for Home and Project actions.

Home starter actions and project `aiws.yaml` actions still have different
storage roots, but UI routes should pass through this module so run handling
has one obvious entrypoint.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from aiws.core import action_registry, home_workbench, project_connections


def preview_home(action_id: str) -> dict[str, Any]:
    return home_workbench.preview_action(action_id)


def run_home(
    root: str | Path,
    username: str | None,
    action_id: str,
    *,
    actor: str | None = None,
    content: str = "",
    upload: tuple[str, bytes] | None = None,
    uploads: list[tuple[str, bytes]] | None = None,
    provider: str = "ollama",
    model: str = "qwen3:8b",
    model_response: str = "",
) -> dict[str, Any]:
    return home_workbench.run_action(
        root,
        username,
        action_id,
        actor=actor,
        content=content,
        upload=upload,
        uploads=uploads,
        provider=provider,
        model=model,
        model_response=model_response,
    )


def preview_project(root: str | Path, project_path: str, command_name: str) -> dict[str, Any]:
    return action_registry.preview_action(root, project_path, command_name)


def run_project(
    root: str | Path,
    project_path: str,
    command_name: str,
    *,
    actor: str | None = None,
    confirmed: bool = False,
) -> dict[str, Any]:
    connections = project_connections.payload(root, project_path, actor)
    return action_registry.run_action(
        root,
        project_path,
        command_name,
        actor=actor,
        confirmed=confirmed,
        resolved_imports=connections.get("resolvedImports", []),
    )
