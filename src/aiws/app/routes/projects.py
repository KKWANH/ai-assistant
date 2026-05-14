"""Project API payload builders."""

from __future__ import annotations

from pathlib import Path

from aiws.core import action_registry
from aiws.domain import goals as goal_domain


def goal_payload(root: str | Path, project_path: str) -> dict[str, object]:
    return {
        "goal": goal_domain.load(root, project_path),
        "codex_prompt": goal_domain.codex_prompt(root, project_path),
    }


def config_payload(root: str | Path, project_path: str) -> dict[str, object]:
    return {
        "config": action_registry.load_config(root, project_path),
        "runs": action_registry.latest_runs(root, project_path),
    }


def run_payload(root: str | Path, project_path: str, run_id: str) -> dict[str, object]:
    return action_registry.read_run_detail(root, project_path, run_id)


def artifact_payload(root: str | Path, project_path: str, artifact_path: str) -> dict[str, object]:
    return {"artifact": action_registry.read_project_artifact(root, project_path, artifact_path)}
