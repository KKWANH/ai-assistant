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
) -> dict[str, Any]:
    return {
        "id": run_id,
        "run_id": run_id,
        "action_id": action_id,
        "command": action_id,
        "label": label,
        "actor": actor,
        "status": status,
        "created_at": created_at,
        "started_at": created_at,
        "completed_at": created_at if status in {"completed", "failed"} else "",
        "input_snapshot": {},
        "execution_plan": plan,
        "logs": logs or [],
        "costs": {"local": True, "api_usd": 0},
        "artifacts": artifacts or [],
        "errors": errors or [],
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
