"""Chat/session API payload builders."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from aiws import attachments, storage
from aiws.core import action_registry, context_manifest
from aiws.domain import chats as chat_domain
from aiws.domain import goals as goal_domain
from aiws.domain import projects as project_domain


MessageSerializer = Callable[[dict[str, object]], dict[str, object]]
AttachmentSerializer = Callable[[str, str, dict[str, object]], dict[str, object]]


def latest_assistant_metadata(messages: list[dict[str, object]]) -> dict[str, object]:
    for message in reversed(messages):
        if message.get("role") != "assistant":
            continue
        metadata = message.get("metadata", {})
        cost = metadata.get("cost", {}) if isinstance(metadata, dict) else {}
        search = metadata.get("search", {}) if isinstance(metadata, dict) else {}
        return {
            "provider": message.get("provider"),
            "model": message.get("model"),
            "cost": cost.get("estimated_cost") if isinstance(cost, dict) else None,
            "search_mode": search.get("mode") if isinstance(search, dict) else None,
        }
    return {}


def chat_payload(
    root: str | Path,
    project_path: str,
    session_slug: str,
    *,
    actor: str | None,
    message_serializer: MessageSerializer,
    attachment_serializer: AttachmentSerializer,
) -> dict[str, object]:
    project = project_domain.load(root, project_path)
    session = chat_domain.load_session(root, project_path, session_slug)
    messages = chat_domain.read_messages(root, project_path, session_slug)
    latest = latest_assistant_metadata(messages)
    return {
        "project": {
            "path": project_path,
            "title": project["title"],
            "hidden": bool(project.get("hidden", False)),
            "visibility": project.get("visibility", "private"),
        },
        "session": {"slug": session_slug, "title": session["title"]},
        "messages": [message_serializer(message) for message in messages],
        "skills": storage.resolve_skill_names(root, project_path),
        "attachments": [
            attachment_serializer(project_path, session_slug, item)
            for item in attachments.list_attachments(root, project_path, session_slug)
        ],
        "goal": goal_domain.load(root, project_path),
        "codex_prompt": goal_domain.codex_prompt(root, project_path, session_slug),
        "latest": latest,
        "task_suggestions": action_registry.suggest_actions(
            root,
            project_path,
            messages=messages,
        ),
        "context_manifest": context_manifest.build_context_manifest(
            root,
            project_path,
            session_slug,
            actor=actor,
            provider=str(latest.get("provider", "")),
            model=str(latest.get("model", "")),
            search_mode=str(latest.get("search_mode", "")),
        ),
    }
