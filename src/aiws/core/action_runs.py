"""Shared action/run façade for Home and Project actions.

Home starter actions and project `aiws.yaml` actions still have different
storage roots, but UI routes should pass through this module so run handling
has one obvious entrypoint.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from aiws import storage
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
    workflow_inputs: dict[str, Any] | None = None,
    workflow_files: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    connections = project_connections.payload(root, project_path, actor)
    return action_registry.run_action(
        root,
        project_path,
        command_name,
        actor=actor,
        confirmed=confirmed,
        resolved_imports=connections.get("resolvedImports", []),
        workflow_inputs=workflow_inputs,
        workflow_files=workflow_files,
    )


def rerun_project_step(
    root: str | Path,
    project_path: str,
    run_id: str,
    *,
    actor: str | None = None,
    step_id: str = "",
) -> dict[str, Any]:
    """Create a new run from a previous Workflow App run and mark the scoped step.

    This is intentionally conservative: AIWS does not yet have a full DAG step
    runtime, so a step rerun recreates the same Workflow App execution with the
    previous typed inputs and an explicit rerun marker in metadata.
    """
    previous = action_registry.read_run_detail(root, project_path, run_id).get("run", {})
    if not isinstance(previous, dict):
        raise storage.WorkspaceError("Run metadata is invalid.")
    command_name = str(previous.get("command_id") or previous.get("action_id") or "").strip()
    if not command_name:
        raise storage.WorkspaceError("Previous run is not attached to a Workflow App.")
    previous_inputs = previous.get("inputs") if isinstance(previous.get("inputs"), dict) else {}
    workflow_inputs = dict(previous_inputs.get("workflow_inputs") or {}) if isinstance(previous_inputs, dict) else {}
    workflow_inputs["_rerun"] = {
        "source_run_id": run_id,
        "step_id": step_id,
        "requested_by": actor or "local",
    }
    workflow_files = list(previous_inputs.get("workflow_files") or []) if isinstance(previous_inputs, dict) else []
    return run_project(
        root,
        project_path,
        command_name,
        actor=actor,
        confirmed=True,
        workflow_inputs=workflow_inputs,
        workflow_files=workflow_files,
    )
