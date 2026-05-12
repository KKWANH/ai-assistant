"""Build transparent context manifests for chat requests."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .. import costs, storage
from . import action_registry


def build_context_manifest(
    root: str | Path,
    project_path: str,
    session_slug: str,
    *,
    actor: str | None = None,
    provider: str = "",
    model: str = "",
    search_mode: str = "",
    prompt_context: str = "",
) -> dict[str, Any]:
    """Return a compact record of what AIWS intends to use as context."""
    project = storage.load_project(root, project_path)
    session = storage.load_session(root, project_path, session_slug)
    goal = storage.load_goal(root, project_path)
    session_files = _attachment_items(root, project_path, session_slug, scope="chat")
    project_files = _project_attachment_items(root, project_path, exclude_session=session_slug)
    recent_runs = action_registry.latest_runs(root, project_path, limit=5)
    input_tokens = costs.rough_token_count(prompt_context) if prompt_context else 0
    estimate = costs.estimate_cost(provider, model, input_tokens) if provider and model else {}

    included: list[dict[str, Any]] = []
    if goal.get("objective"):
        included.append({"type": "goal", "label": str(goal["objective"])[:120]})
    if storage.resolve_skill_names(root, project_path):
        included.append({"type": "skills", "count": len(storage.resolve_skill_names(root, project_path))})
    if session_files:
        included.append({"type": "chat_files", "count": len(session_files)})
    if project_files:
        included.append({"type": "project_files", "count": len(project_files)})
    if recent_runs:
        included.append({"type": "recent_runs", "count": len(recent_runs)})

    return {
        "created_at": storage.utc_now(),
        "actor": storage.slugify(actor) if actor else "local",
        "project": {
            "path": project_path,
            "title": project.get("title", project_path),
            "visibility": project.get("visibility", "private"),
            "hidden": bool(project.get("hidden", False)),
        },
        "session": {"slug": session_slug, "title": session.get("title", session_slug)},
        "privacy_mode": "local" if provider == "ollama" else "cloud_allowed",
        "provider": provider,
        "model": model,
        "search_mode": search_mode,
        "included": included,
        "files": session_files + project_files,
        "runs": [_run_summary(run) for run in recent_runs],
        "excluded": [
            {"pattern": pattern, "reason": "blocked secret path"}
            for pattern in sorted(action_registry.SECRET_PATTERNS)
        ][:8],
        "estimates": {
            "context_chars": len(prompt_context),
            "input_tokens": input_tokens,
            "estimated_cost": estimate.get("estimated_cost"),
            "currency": estimate.get("currency", "USD"),
        },
    }


def _attachment_items(root: str | Path, project_path: str, session_slug: str, *, scope: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for item in storage.read_attachment_metadata(root, project_path, session_slug):
        items.append(
            {
                "scope": scope,
                "session": session_slug,
                "filename": item.get("filename", "attachment"),
                "content_type": item.get("content_type", ""),
                "delivery": item.get("delivery", "stored_only"),
                "extraction_status": item.get("extraction_status", "stored"),
                "text_available": bool(item.get("text_available")),
                "size": item.get("size", 0),
            }
        )
    return items


def _project_attachment_items(root: str | Path, project_path: str, *, exclude_session: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for session in storage.list_sessions(root, project_path):
        slug = str(session.get("slug", ""))
        if not slug or slug == exclude_session:
            continue
        items.extend(_attachment_items(root, project_path, slug, scope="project"))
    return items


def _run_summary(run: dict[str, Any]) -> dict[str, Any]:
    return {
        "run_id": run.get("run_id", ""),
        "command": run.get("command", ""),
        "label": run.get("label", run.get("command", "")),
        "kind": run.get("kind", ""),
        "status": run.get("status", ""),
        "created_at": run.get("created_at", ""),
        "artifacts": run.get("artifacts", []),
    }
