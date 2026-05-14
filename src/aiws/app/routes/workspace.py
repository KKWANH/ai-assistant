"""Workspace/account API payload builders."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from aiws import costs, storage
from aiws.domain import chats as chat_domain
from aiws.domain import projects as project_domain
from aiws.domain import usage as usage_domain


def model_catalog() -> list[dict[str, object]]:
    return [
        {
            "provider": item.provider,
            "model": item.model,
            "input_per_million": item.input_per_million,
            "output_per_million": item.output_per_million,
            "note": item.note,
        }
        for item in costs.list_model_costs()
    ]


def project_payload(root: str | Path, project: dict[str, Any]) -> dict[str, object]:
    project_path = str(project["path"])
    sessions = chat_domain.list_sessions(root, project_path)
    first_session_url = f"/chat/{project_path}/{sessions[0]['slug']}" if sessions else ""
    return {
        "path": project_path,
        "title": project.get("title", project_path),
        "created_at": project.get("created_at", ""),
        "parent": project.get("parent", ""),
        "level": 1 if project.get("parent") else 0,
        "owner": project.get("owner", ""),
        "owner_display": storage.display_name_for_username(str(project.get("owner", "") or "local")),
        "visibility": project.get("visibility", "private"),
        "hidden": bool(project.get("hidden", False)),
        "firstSessionUrl": first_session_url,
        "sessions": [
            {
                "slug": session["slug"],
                "title": session["title"],
                "created_at": session.get("created_at", ""),
            }
            for session in sessions
        ],
    }


def account_payload(root: str | Path, username: str | None) -> dict[str, object]:
    if username and storage.has_accounts(root):
        try:
            account = storage.public_account(storage.load_account(root, username))
            avatar = account.get("profile", {}).get("avatar") if isinstance(account.get("profile"), dict) else ""
            if avatar:
                account["avatar_url"] = f"/avatar/{username}"
            account["cost_usage"] = {
                "day_usd": usage_domain.model_total_usd(root, username, period="day"),
                "month_usd": usage_domain.model_total_usd(root, username, period="month"),
            }
            account["model_catalog"] = model_catalog()
            return account
        except storage.WorkspaceError:
            pass
    username = username or "local"
    nickname = storage.display_name_for_username(username)
    return {
        "username": username,
        "nickname": nickname,
        "display_name": nickname,
        "admin": False,
        "profile": {"name": nickname, "ui_mode": "power"},
        "model_catalog": model_catalog(),
    }


def workspace_payload(root: str | Path, username: str | None) -> dict[str, object]:
    if storage.has_accounts(root):
        visible_projects = project_domain.visible(root, username)
    else:
        visible_projects = project_domain.list_all(root)
    chats = project_domain.visible_general_chats(root, username)
    return {
        "projects": [project_payload(root, project) for project in visible_projects if not project.get("hidden")],
        "chats": [project_payload(root, project) for project in chats],
        "account": account_payload(root, username),
        "model_catalog": model_catalog(),
        "workbench_contract": {
            "version": 1,
            "actions_endpoint": "/api/action-library",
            "models_endpoint": "/api/models",
        },
    }
