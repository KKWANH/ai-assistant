"""Shared AIWS object contracts.

These helpers keep backend payloads boring and explicit. They are intentionally
plain dictionaries because the rest of the storage layer is file-based JSON.
"""

from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Any


PANEL_TYPES = {
    "fileExplorer",
    "tableViewer",
    "markdownViewer",
    "pdfViewer",
    "imageViewer",
    "jsonTree",
    "chart",
    "runTimeline",
    "actionLauncher",
    "costMeter",
    "modelRouter",
    "diffViewer",
    "logConsole",
    "plannerTrace",
    "webPreview",
    "formPanel",
    "folderStats",
    "artifactGallery",
    "codeEditor",
    "reportBuilder",
}


def viewer_type(path: str, mime: str = "") -> str:
    suffix = Path(path).suffix.lower()
    if suffix == ".csv":
        return "tableViewer"
    if suffix in {".md", ".markdown"}:
        return "markdownViewer"
    if suffix == ".pdf":
        return "pdfViewer"
    if suffix in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
        return "imageViewer"
    if suffix == ".json":
        return "jsonTree"
    if suffix in {".py", ".js", ".jsx", ".ts", ".tsx", ".css", ".html", ".sh", ".yaml", ".yml"}:
        return "codeEditor"
    if mime.startswith("image/"):
        return "imageViewer"
    return "textViewer"


def artifact_contract(
    *,
    artifact_id: str,
    path: str,
    source_run: str,
    summary: str = "",
    size: int = 0,
) -> dict[str, Any]:
    mime = mimetypes.guess_type(path)[0] or "text/plain"
    return {
        "id": artifact_id,
        "path": path,
        "type": Path(path).suffix.lower().lstrip(".") or "text",
        "mime": mime,
        "size": size,
        "source_run": source_run,
        "viewer_type": viewer_type(path, mime),
        "summary": summary,
        "available_actions": [
            "open",
            "ask_ai_with_artifact",
            "create_report_from_artifact",
            "download_artifact",
            "save_to_project",
            "publish_artifact",
        ],
    }


def run_contract(
    *,
    run_id: str,
    action_id: str,
    label: str,
    actor: str,
    status: str,
    created_at: str,
    plan: dict[str, Any],
    logs: list[dict[str, Any]] | None = None,
    artifacts: list[dict[str, Any]] | None = None,
    errors: list[str] | None = None,
    project_path: str = "",
    session_slug: str = "",
    command_id: str = "",
    kind: str = "",
    approval: dict[str, Any] | None = None,
    capabilities: dict[str, Any] | None = None,
    inputs: dict[str, Any] | None = None,
    outputs: dict[str, Any] | None = None,
    stdout: str = "",
    stderr: str = "",
    model_calls: list[dict[str, Any]] | None = None,
    estimated_cost: dict[str, Any] | float | None = None,
    actual_cost: dict[str, Any] | float | None = None,
    workspace_id: str = "",
    session_id: str = "",
    context_receipt: dict[str, Any] | None = None,
    steps: list[dict[str, Any]] | None = None,
    error: str = "",
) -> dict[str, Any]:
    finished_at = created_at if status in {"completed", "failed", "cancelled"} else ""
    input_snapshot = inputs or {}
    calls = model_calls or []
    model_summary = model_contract(calls, input_snapshot)
    plan_steps = steps if steps is not None else plan.get("steps", []) if isinstance(plan, dict) else []
    return {
        "id": run_id,
        "run_id": run_id,
        "workspace_id": workspace_id or project_path or "home",
        "session_id": session_id or session_slug or None,
        "action_id": action_id,
        "action_label": label,
        "command_id": command_id or action_id,
        "command": command_id or action_id,
        "project_path": project_path,
        "session_slug": session_slug,
        "kind": kind,
        "label": label,
        "actor": actor,
        "requested_by": actor,
        "status": status,
        "created_at": created_at,
        "started_at": created_at,
        "finished_at": finished_at,
        "completed_at": finished_at,
        "approval": approval or {"required": False, "confirmed": False, "approved_by": ""},
        "capabilities": capabilities or {},
        "input_snapshot": input_snapshot,
        "inputs": input_snapshot,
        "outputs": outputs or {},
        "execution_plan": plan,
        "steps": plan_steps,
        "logs": logs or [],
        "stdout_tail": stdout[-4000:],
        "stderr_tail": stderr[-4000:],
        "costs": {"local": True, "api_usd": 0},
        "estimated_cost": estimated_cost,
        "actual_cost": actual_cost,
        "artifacts": artifacts or [],
        "model": model_summary,
        "model_calls": calls,
        "context_receipt": context_receipt or {},
        "errors": errors or [],
        "error": error or ("\n".join(errors or []) if errors else ""),
    }


def model_contract(model_calls: list[dict[str, Any]], inputs: dict[str, Any]) -> dict[str, Any]:
    """Return the compact model shape used by run timelines."""
    call = model_calls[-1] if model_calls else {}
    provider = str(call.get("provider") or inputs.get("provider") or "")
    model_id = str(call.get("id") or call.get("model") or inputs.get("model") or "")
    if not provider and not model_id:
        return {}
    return {
        "provider": provider,
        "id": model_id,
        "local": bool(call.get("local")) if "local" in call else provider == "ollama",
    }


def panel_contract(
    *,
    panel_id: str,
    panel_type: str,
    title: str,
    source: str = "",
    layout: str = "main",
    actions: list[str] | None = None,
    visibility: str = "private",
    props: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": panel_id,
        "type": panel_type if panel_type in PANEL_TYPES else "webPreview",
        "title": title,
        "source": source,
        "layout": layout,
        "actions": actions or [],
        "visibility": visibility,
        "props": props or {},
    }
