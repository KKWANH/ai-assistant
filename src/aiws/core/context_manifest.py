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
    network_used: bool = False,
    search_queries: list[str] | None = None,
    active_attachment_filenames: set[str] | None = None,
    include_project_files: bool = True,
) -> dict[str, Any]:
    """Return a compact record of what AIWS intends to use as context."""
    project = storage.load_project(root, project_path)
    session = storage.load_session(root, project_path, session_slug)
    goal = storage.load_goal(root, project_path)
    session_files, session_excluded = _attachment_items(
        root,
        project_path,
        session_slug,
        scope="chat",
        active_filenames=active_attachment_filenames,
        include_for_context=True,
    )
    project_files: list[dict[str, Any]] = []
    project_excluded: list[dict[str, Any]] = []
    if include_project_files:
        project_files, project_excluded = _project_attachment_items(root, project_path, exclude_session=session_slug)
    else:
        project_excluded = _project_attachment_exclusions(
            root,
            project_path,
            exclude_session=session_slug,
            reason="current request limited to active attachment files",
        )
    recent_runs = action_registry.latest_runs(root, project_path, limit=5)
    input_tokens = costs.rough_token_count(prompt_context) if prompt_context else 0
    estimate = costs.estimate_cost(provider, model, input_tokens) if provider and model else {}
    all_files = session_files + project_files
    included_chunks = _included_chunks(all_files, model_delivery="local" if provider == "ollama" else "cloud")
    file_exclusions = session_excluded + project_excluded

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

    model_delivery = "local" if provider == "ollama" else "cloud"
    files_sent_to_cloud = [item["path"] for item in all_files if model_delivery == "cloud" and item.get("included_in_context")]
    files_kept_local = [item["path"] for item in all_files if model_delivery == "local" and item.get("included_in_context")]
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
        "privacy_mode": "network" if network_used and model_delivery == "local" else model_delivery,
        "privacy": {
            "model_delivery": model_delivery,
            "network_used": bool(network_used),
            "search_queries_sent": list(search_queries or []),
            "remote_providers": (["duckduckgo"] if network_used else []) + ([] if model_delivery == "local" else [provider]),
            "files_sent_to_cloud": files_sent_to_cloud,
            "files_kept_local": files_kept_local,
        },
        "provider": provider,
        "model": model,
        "search_mode": search_mode,
        "included": included,
        "files": all_files,
        "included_chunks": included_chunks,
        "runs": [_run_summary(run) for run in recent_runs],
        "excluded": file_exclusions
        + [{"pattern": pattern, "reason": "blocked secret path"} for pattern in sorted(action_registry.SECRET_PATTERNS)][:8],
        "estimates": {
            "context_chars": len(prompt_context),
            "input_tokens": input_tokens,
            "estimated_cost": estimate.get("estimated_cost"),
            "currency": estimate.get("currency", "USD"),
        },
    }


def _attachment_items(
    root: str | Path,
    project_path: str,
    session_slug: str,
    *,
    scope: str,
    active_filenames: set[str] | None = None,
    include_for_context: bool = True,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    items: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    for item in storage.read_attachment_metadata(root, project_path, session_slug):
        filename = str(item.get("filename", "attachment"))
        selected = active_filenames is None or filename in active_filenames
        included = include_for_context and selected and _file_has_context_delivery(item)
        path = f"{project_path}/{session_slug}/attachments/{filename}"
        if not included:
            reason = "not selected for this request" if active_filenames is not None and not selected else "no extracted context available"
            excluded.append({"path": path, "filename": filename, "scope": scope, "reason": reason})
        items.append(
            {
                "scope": scope,
                "session": session_slug,
                "filename": filename,
                "path": path,
                "content_type": item.get("content_type", ""),
                "delivery": item.get("delivery", "stored_only"),
                "extraction_status": item.get("extraction_status", "stored"),
                "text_available": bool(item.get("text_available")),
                "size": item.get("size", 0),
                "included_in_context": included,
                "reason": _inclusion_reason(item, scope) if included else "",
                "token_count": costs.rough_token_count(str(item.get("text", ""))) if included else 0,
                "text_preview": str(item.get("text", ""))[:500] if included else "",
            }
        )
    return items, excluded


def _project_attachment_items(
    root: str | Path, project_path: str, *, exclude_session: str
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    items: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    for session in storage.list_sessions(root, project_path):
        slug = str(session.get("slug", ""))
        if not slug or slug == exclude_session:
            continue
        session_items, session_excluded = _attachment_items(root, project_path, slug, scope="project")
        items.extend(session_items)
        excluded.extend(session_excluded)
    return items, excluded


def _project_attachment_exclusions(root: str | Path, project_path: str, *, exclude_session: str, reason: str) -> list[dict[str, Any]]:
    excluded: list[dict[str, Any]] = []
    for session in storage.list_sessions(root, project_path):
        slug = str(session.get("slug", ""))
        if not slug or slug == exclude_session:
            continue
        for item in storage.read_attachment_metadata(root, project_path, slug):
            filename = str(item.get("filename", "attachment"))
            excluded.append(
                {
                    "path": f"{project_path}/{slug}/attachments/{filename}",
                    "filename": filename,
                    "scope": "project",
                    "reason": reason,
                }
            )
    return excluded


def _file_has_context_delivery(item: dict[str, Any]) -> bool:
    return bool(item.get("text_available")) and str(item.get("delivery", "")) in {"text_context", "Sent as text context"}


def _inclusion_reason(item: dict[str, Any], scope: str) -> str:
    if scope == "chat":
        return "active chat attachment with extracted text"
    return "prior project attachment included by request policy"


def _included_chunks(files: list[dict[str, Any]], *, model_delivery: str) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    for item in files:
        if not item.get("included_in_context"):
            continue
        text = str(item.get("text_preview", ""))
        if not text:
            continue
        token_count = costs.rough_token_count(text)
        chunks.append(
            {
                "chunk_id": f"{item.get('session', '')}:{item.get('filename', '')}:0",
                "path": item.get("path", ""),
                "filename": item.get("filename", ""),
                "scope": item.get("scope", ""),
                "reason": item.get("reason", ""),
                "token_count": token_count,
                "privacy": "sent_to_cloud" if model_delivery == "cloud" else "local_only",
                "content_preview": text,
            }
        )
    return chunks


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
