"""WorkSession records for tying chats, runs, receipts, and artifacts together."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from aiws import storage

STATUSES = {"draft", "planned", "running", "completed", "failed"}
TYPES = {"ask_once", "file_analysis", "project_task", "action_run"}


def path(root: str | Path, project_path: str, session_slug: str) -> Path:
    return storage.session_dir(root, project_path, session_slug) / "work_session.json"


def load(root: str | Path, project_path: str, session_slug: str) -> dict[str, Any]:
    target = path(root, project_path, session_slug)
    if target.exists():
        return storage.read_json(target)
    session = storage.load_session(root, project_path, session_slug)
    project = storage.load_project(root, project_path)
    work_session = {
        "id": f"{project_path}/{session_slug}",
        "type": "ask_once" if project.get("hidden") else "project_task",
        "title": session.get("title", session_slug),
        "status": "draft",
        "inputs": [],
        "model_calls": [],
        "tool_runs": [],
        "artifacts": [],
        "context_receipts": [],
        "next_actions": [],
        "created_at": session.get("created_at", storage.utc_now()),
        "updated_at": storage.utc_now(),
    }
    storage.write_json(target, work_session)
    return work_session


def update(
    root: str | Path,
    project_path: str,
    session_slug: str,
    *,
    type: str | None = None,
    title: str | None = None,
    status: str | None = None,
    input_item: dict[str, Any] | None = None,
    model_call: dict[str, Any] | None = None,
    tool_run: dict[str, Any] | None = None,
    artifact: dict[str, Any] | None = None,
    context_receipt: dict[str, Any] | None = None,
    next_actions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    work_session = load(root, project_path, session_slug)
    if type:
        if type not in TYPES:
            raise storage.WorkspaceError("WorkSession type is invalid.")
        work_session["type"] = type
    if title:
        work_session["title"] = title
    if status:
        if status not in STATUSES:
            raise storage.WorkspaceError("WorkSession status is invalid.")
        work_session["status"] = status
    _append(work_session, "inputs", input_item)
    _append(work_session, "model_calls", model_call)
    _append(work_session, "tool_runs", tool_run)
    _append(work_session, "artifacts", artifact)
    _append(work_session, "context_receipts", context_receipt)
    if next_actions is not None:
        work_session["next_actions"] = next_actions
    work_session["updated_at"] = storage.utc_now()
    storage.write_json(path(root, project_path, session_slug), work_session)
    return work_session


def _append(work_session: dict[str, Any], key: str, item: dict[str, Any] | None) -> None:
    if not item:
        return
    values = work_session.setdefault(key, [])
    if isinstance(values, list):
        values.append(item)
