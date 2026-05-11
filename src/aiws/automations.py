"""File-based automation project registry for repeatable local checks."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from . import openclaw, storage


DEFAULT_OPENCLAW_SLUG = "aiws-ui-self-check"


def automation_root(root: str | Path) -> Path:
    path = storage.workspace_path(root) / "automation_projects"
    path.mkdir(parents=True, exist_ok=True)
    return path


def project_dir(root: str | Path, slug: str) -> Path:
    safe_slug = storage.slugify(slug)
    return automation_root(root) / safe_slug


def project_json_path(root: str | Path, slug: str) -> Path:
    return project_dir(root, slug) / "automation.json"


def runs_dir(root: str | Path, slug: str) -> Path:
    path = project_dir(root, slug) / "runs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def ensure_default_projects(root: str | Path) -> None:
    if not project_json_path(root, DEFAULT_OPENCLAW_SLUG).exists():
        create_project(
            root,
            title="AIWS UI Self Check",
            kind="openclaw-ui-check",
            slug=DEFAULT_OPENCLAW_SLUG,
            description="OpenClaw-backed self-check project for UI diagnosis and local runtime health.",
            category="diagnostics",
            panels=["runs", "browser", "reports"],
            commands={
                "self_check": {
                    "label": "UI self-check",
                    "description": "Check AIWS runtime, Cloudflare URL, OpenClaw gateway, and recent sessions.",
                    "permission": "read-only",
                }
            },
            interval_minutes=0,
        )
    else:
        project = storage.read_json(project_json_path(root, DEFAULT_OPENCLAW_SLUG))
        changed = apply_defaults(
            project,
            category="diagnostics",
            permissions={
                "file_read": True,
                "file_write": "confirm",
                "shell": "blocked",
                "network": False,
            },
            panels=["runs", "browser", "reports"],
            commands={
                "self_check": {
                    "label": "UI self-check",
                    "description": "Check AIWS runtime, Cloudflare URL, OpenClaw gateway, and recent sessions.",
                    "permission": "read-only",
                }
            },
        )
        if changed:
            project["updated_at"] = storage.utc_now()
            storage.write_json(project_json_path(root, DEFAULT_OPENCLAW_SLUG), project)


def apply_defaults(project: dict[str, Any], **defaults: Any) -> bool:
    changed = False
    for key, value in defaults.items():
        if key not in project or project[key] is None or project[key] == "" or project[key] == []:
            project[key] = value
            changed = True
    return changed


def create_project(
    root: str | Path,
    *,
    title: str,
    kind: str,
    slug: str | None = None,
    description: str = "",
    target_url: str = "",
    category: str = "local-task",
    panels: list[str] | None = None,
    commands: dict[str, Any] | None = None,
    permissions: dict[str, Any] | None = None,
    interval_minutes: int = 0,
) -> dict[str, Any]:
    storage.init_workspace(root)
    slug_value = storage.slugify_or_default(slug or title, "automation")
    directory = project_dir(root, slug_value)
    directory.mkdir(parents=True, exist_ok=True)
    path = project_json_path(root, slug_value)
    if path.exists():
        raise storage.WorkspaceError(f"Automation project already exists: {slug_value}")
    project = {
        "slug": slug_value,
        "title": title.strip() or slug_value,
        "kind": kind,
        "category": category,
        "description": description,
        "target_url": target_url,
        "permissions": permissions
        or {
            "file_read": True,
            "file_write": "confirm",
            "shell": "blocked",
            "network": False,
        },
        "panels": panels or ["runs", "reports"],
        "commands": commands or {},
        "interval_minutes": max(0, int(interval_minutes or 0)),
        "created_at": storage.utc_now(),
        "updated_at": storage.utc_now(),
    }
    storage.write_json(path, project)
    runs_dir(root, slug_value)
    return project


def load_project(root: str | Path, slug: str) -> dict[str, Any]:
    ensure_default_projects(root)
    path = project_json_path(root, slug)
    if not path.exists():
        raise storage.WorkspaceError(f"Automation project does not exist: {slug}")
    return storage.read_json(path)


def list_projects(root: str | Path) -> list[dict[str, Any]]:
    ensure_default_projects(root)
    projects: list[dict[str, Any]] = []
    for path in sorted(automation_root(root).glob("*/automation.json")):
        try:
            project = storage.read_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        project["latest_run"] = latest_run(root, str(project.get("slug", "")))
        projects.append(project)
    return projects


def latest_run(root: str | Path, slug: str) -> dict[str, Any] | None:
    directory = runs_dir(root, slug)
    latest = sorted(directory.glob("*.json"), reverse=True)
    if not latest:
        return None
    try:
        return storage.read_json(latest[0])
    except (OSError, json.JSONDecodeError):
        return None


def list_runs(root: str | Path, slug: str, *, limit: int = 10) -> list[dict[str, Any]]:
    load_project(root, slug)
    runs: list[dict[str, Any]] = []
    for path in sorted(runs_dir(root, slug).glob("*.json"), reverse=True)[:limit]:
        try:
            runs.append(storage.read_json(path))
        except (OSError, json.JSONDecodeError):
            continue
    return runs


def run_project(root: str | Path, slug: str, *, actor: str | None = None) -> dict[str, Any]:
    project = load_project(root, slug)
    run_id = storage.utc_now().replace(":", "").replace(".", "-")
    status = "completed"
    observations: list[str] = []
    result: dict[str, Any] = {}

    if project.get("kind") == "openclaw-ui-check":
        result = run_openclaw_ui_check(root, project)
        observations = list(result.get("observations", []))
        if not result.get("ok", False):
            status = "attention"
    else:
        status = "unsupported"
        observations.append(f"Unsupported automation kind: {project.get('kind')}")

    run = {
        "run_id": run_id,
        "project_slug": project["slug"],
        "project_title": project["title"],
        "kind": project["kind"],
        "category": project.get("category", "local-task"),
        "status": status,
        "actor": actor or "local",
        "created_at": storage.utc_now(),
        "observations": observations,
        "result": result,
    }
    storage.write_json(runs_dir(root, project["slug"]) / f"{run_id}.json", run)
    project["updated_at"] = storage.utc_now()
    storage.write_json(project_json_path(root, project["slug"]), project)
    return run


def run_openclaw_ui_check(root: str | Path, project: dict[str, Any]) -> dict[str, Any]:
    claw = openclaw.status()
    runtime_url = current_cloudflare_url(root)
    target_url = str(project.get("target_url") or runtime_url or "http://127.0.0.1:8765")
    gateway = claw.get("gateway", {}) if isinstance(claw, dict) else {}
    gateway_summary = gateway.get("summary", {}) if isinstance(gateway, dict) else {}
    sessions = claw.get("sessions", {}) if isinstance(claw, dict) else {}
    session_count = sessions.get("count", sessions.get("totalCount", 0)) if isinstance(sessions, dict) else 0
    gateway_ok = bool(gateway.get("ok")) if isinstance(gateway, dict) else False

    observations = [
        f"Target URL: {target_url}",
        f"OpenClaw installed: {'yes' if claw.get('installed') else 'no'}",
        f"OpenClaw gateway: {gateway_summary.get('connectivity_probe') or gateway_summary.get('runtime') or ('ok' if gateway_ok else 'unknown')}",
        f"Known OpenClaw sessions: {session_count}",
    ]
    if runtime_url:
        observations.append("AIWS Cloudflare tunnel URL is available.")
    if not gateway_ok:
        observations.append("OpenClaw gateway is not reachable; restart it before browser/operator diagnostics.")

    return {
        "ok": bool(claw.get("installed")) and gateway_ok,
        "target_url": target_url,
        "openclaw": {
            "installed": bool(claw.get("installed")),
            "version": claw.get("version", ""),
            "gateway": gateway_summary,
            "session_count": session_count,
        },
        "runtime": {"cloudflare_url": runtime_url},
        "observations": observations,
    }


def current_cloudflare_url(root: str | Path) -> str:
    workspace = storage.workspace_path(root)
    run_dir = Path(os.environ.get("AIWS_RUN_DIR", str(workspace / "run"))).expanduser()
    url_path = run_dir / "cloudflare-url.txt"
    if url_path.exists():
        return url_path.read_text(encoding="utf-8").strip()
    return ""
