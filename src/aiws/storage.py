"""File-based storage core for Local AI Workspace."""

from __future__ import annotations

import json
import hashlib
import hmac
import re
import secrets
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SUPPORTED_SKILL_FILES = ("CLAUDE.md", "SKILL.md", "skills.md", "README.md")
SUPPORTED_AVATAR_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
SUPPORTED_LANGUAGES = {"en", "ko"}
GENERAL_CHAT_PREFIX = "general-chat"

DEFAULT_SKILL_NAME = "andrej-karpathy-skills"
DEFAULT_SKILL_FILE = "CLAUDE.md"
DEFAULT_SKILL_CONTENT = """# andrej-karpathy-skills/CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
"""


class WorkspaceError(ValueError):
    """Raised for invalid workspace operations."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
    slug = slug.strip("-")
    if not slug:
        raise WorkspaceError("Title must produce a non-empty slug.")
    return slug


def workspace_path(root: str | Path) -> Path:
    return Path(root).expanduser().resolve()


def init_workspace(root: str | Path) -> Path:
    root_path = workspace_path(root)
    (root_path / "projects").mkdir(parents=True, exist_ok=True)
    config_path = root_path / "config.json"
    if not config_path.exists():
        write_json(config_path, {"auth_secret": secrets.token_hex(32), "created_at": utc_now()})
    users_path = root_path / "users.json"
    if not users_path.exists():
        write_json(users_path, {"users": {}})
    skills_root = root_path / "skills"
    skills_root.mkdir(parents=True, exist_ok=True)
    default_skill_dir = skills_root / DEFAULT_SKILL_NAME
    default_skill_dir.mkdir(parents=True, exist_ok=True)
    default_skill_path = default_skill_dir / DEFAULT_SKILL_FILE
    if not default_skill_path.exists():
        default_skill_path.write_text(DEFAULT_SKILL_CONTENT, encoding="utf-8")
    return root_path


def users_json_path(root: str | Path) -> Path:
    return workspace_path(root) / "users.json"


def load_users(root: str | Path) -> dict[str, Any]:
    init_workspace(root)
    return read_json(users_json_path(root))


def save_users(root: str | Path, users: dict[str, Any]) -> None:
    write_json(users_json_path(root), users)


def config_json_path(root: str | Path) -> Path:
    return workspace_path(root) / "config.json"


def load_config(root: str | Path) -> dict[str, Any]:
    init_workspace(root)
    return read_json(config_json_path(root))


def hash_password(password: str, *, salt: str | None = None) -> dict[str, Any]:
    if not password:
        raise WorkspaceError("Password must not be empty.")
    salt_value = salt or secrets.token_hex(16)
    iterations = 260_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_value), iterations)
    return {
        "algorithm": "pbkdf2_sha256",
        "iterations": iterations,
        "salt": salt_value,
        "hash": digest.hex(),
    }


def verify_password(password: str, password_hash: dict[str, Any]) -> bool:
    if password_hash.get("algorithm") != "pbkdf2_sha256":
        return False
    salt = password_hash.get("salt")
    expected = password_hash.get("hash")
    iterations = password_hash.get("iterations")
    if not isinstance(salt, str) or not isinstance(expected, str) or not isinstance(iterations, int):
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), iterations).hex()
    return hmac.compare_digest(digest, expected)


def create_account(
    root: str | Path,
    username: str,
    password: str,
    *,
    admin: bool = False,
    display_name: str = "",
) -> dict[str, Any]:
    init_workspace(root)
    username_slug = slugify(username)
    users = load_users(root)
    if username_slug in users["users"]:
        raise WorkspaceError(f"Account already exists: {username_slug}")
    user = {
        "username": username_slug,
        "display_name": display_name or username_slug,
        "password": hash_password(password),
        "admin": admin,
        "created_at": utc_now(),
        "profile": {
            "name": display_name or username_slug,
            "age": "",
            "job": "",
            "situation": "",
            "language": "ko",
            "memory": [],
            "avatar": "",
        },
        "usage": {"messages": 0, "asks": 0},
    }
    users["users"][username_slug] = user
    save_users(root, users)
    return public_account(user)


def public_account(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "username": user["username"],
        "display_name": user.get("display_name", user["username"]),
        "admin": bool(user.get("admin", False)),
        "created_at": user.get("created_at"),
        "profile": user.get("profile", {}),
        "usage": user.get("usage", {"messages": 0, "asks": 0}),
    }


def list_accounts(root: str | Path) -> list[dict[str, Any]]:
    users = load_users(root)
    return [public_account(user) for user in users["users"].values()]


def load_account(root: str | Path, username: str) -> dict[str, Any]:
    users = load_users(root)
    username_slug = slugify(username)
    user = users["users"].get(username_slug)
    if not user:
        raise WorkspaceError(f"Account does not exist: {username_slug}")
    return user


def authenticate_account(root: str | Path, username: str, password: str) -> dict[str, Any] | None:
    users = load_users(root)
    username_slug = slugify(username)
    user = users["users"].get(username_slug)
    if not user:
        return None
    if not verify_password(password, user.get("password", {})):
        return None
    return public_account(user)


def has_accounts(root: str | Path) -> bool:
    return bool(load_users(root)["users"])


def is_admin(root: str | Path, username: str | None) -> bool:
    if not username:
        return False
    try:
        return bool(load_account(root, username).get("admin", False))
    except WorkspaceError:
        return False


def record_usage(root: str | Path, username: str | None, *, messages: int = 0, asks: int = 0) -> None:
    if not username:
        return
    users = load_users(root)
    user = users["users"].get(slugify(username))
    if not user:
        return
    usage = user.setdefault("usage", {"messages": 0, "asks": 0})
    usage["messages"] = int(usage.get("messages", 0)) + messages
    usage["asks"] = int(usage.get("asks", 0)) + asks
    save_users(root, users)


def update_account_profile(
    root: str | Path,
    username: str,
    *,
    name: str | None = None,
    age: str | None = None,
    job: str | None = None,
    situation: str | None = None,
    language: str | None = None,
    memory: str | None = None,
) -> dict[str, Any]:
    users = load_users(root)
    username_slug = slugify(username)
    user = users["users"].get(username_slug)
    if not user:
        raise WorkspaceError(f"Account does not exist: {username_slug}")
    profile = user.setdefault("profile", {})
    if name is not None:
        profile["name"] = name
        user["display_name"] = name or username_slug
    if age is not None:
        profile["age"] = age
    if job is not None:
        profile["job"] = job
    if situation is not None:
        profile["situation"] = situation
    if language is not None:
        if language not in SUPPORTED_LANGUAGES:
            raise WorkspaceError("Language must be en or ko.")
        profile["language"] = language
    if memory:
        append_account_memory(root, username_slug, memory, source="manual", users=users)
    save_users(root, users)
    return public_account(user)


def append_account_memory(
    root: str | Path,
    username: str,
    content: str,
    *,
    source: str = "auto",
    metadata: dict[str, Any] | None = None,
    users: dict[str, Any] | None = None,
) -> dict[str, Any]:
    text = " ".join(content.split())
    if not text:
        raise WorkspaceError("Memory content must not be empty.")
    username_slug = slugify(username)
    user_data = users or load_users(root)
    user = user_data["users"].get(username_slug)
    if not user:
        raise WorkspaceError(f"Account does not exist: {username_slug}")
    profile = user.setdefault("profile", {})
    memories = profile.setdefault("memory", [])
    if any(item.get("content") == text for item in memories):
        if users is None:
            save_users(root, user_data)
        return public_account(user)
    memories.append(
        {
            "content": text[:500],
            "created_at": utc_now(),
            "source": source,
            "metadata": metadata or {},
        }
    )
    profile["memory"] = memories[-100:]
    if users is None:
        save_users(root, user_data)
    return public_account(user)


def account_context(root: str | Path, username: str | None) -> str:
    if not username:
        return ""
    try:
        account = load_account(root, username)
    except WorkspaceError:
        return ""
    profile = account.get("profile", {})
    lines = ["## Account Context"]
    for key, label in (("name", "Name"), ("age", "Age"), ("job", "Job"), ("situation", "Situation")):
        value = profile.get(key)
        if value:
            lines.append(f"- {label}: {value}")
    memories = profile.get("memory", [])
    if memories:
        lines.append("- Saved memory:")
        for item in memories[-10:]:
            lines.append(f"  - {item.get('content', '')}")
    return "\n".join(lines) + "\n" if len(lines) > 1 else ""


def validate_avatar(filename: str, content: bytes) -> str:
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_AVATAR_EXTENSIONS:
        raise WorkspaceError("Avatar must be an image file: png, jpg, jpeg, gif, or webp.")
    if len(content) > 2 * 1024 * 1024:
        raise WorkspaceError("Avatar must be 2MB or smaller.")
    signatures = {
        ".png": content.startswith(b"\x89PNG\r\n\x1a\n"),
        ".jpg": content.startswith(b"\xff\xd8\xff"),
        ".jpeg": content.startswith(b"\xff\xd8\xff"),
        ".gif": content.startswith((b"GIF87a", b"GIF89a")),
        ".webp": content.startswith(b"RIFF") and content[8:12] == b"WEBP",
    }
    if not signatures.get(ext, False):
        raise WorkspaceError("Avatar content does not match the selected image extension.")
    return ext


def set_account_avatar(root: str | Path, username: str, filename: str, content: bytes) -> str:
    ext = validate_avatar(filename, content)
    username_slug = slugify(username)
    load_account(root, username_slug)
    avatars_root = workspace_path(root) / "avatars"
    avatars_root.mkdir(parents=True, exist_ok=True)
    avatar_path = avatars_root / f"{username_slug}{ext}"
    avatar_path.write_bytes(content)

    users = load_users(root)
    users["users"][username_slug].setdefault("profile", {})["avatar"] = str(avatar_path.relative_to(workspace_path(root)))
    save_users(root, users)
    return users["users"][username_slug]["profile"]["avatar"]


def get_account_language(root: str | Path, username: str | None) -> str:
    if not username:
        return "ko"
    try:
        account = load_account(root, username)
    except WorkspaceError:
        return "ko"
    language = account.get("profile", {}).get("language", "ko")
    return language if language in SUPPORTED_LANGUAGES else "ko"


def validate_visibility(visibility: str) -> str:
    if visibility not in {"private", "public"}:
        raise WorkspaceError("Visibility must be private or public.")
    return visibility


def parse_project_path(project_path: str) -> list[str]:
    parts = [part for part in project_path.split("/") if part]
    if not 1 <= len(parts) <= 2:
        raise WorkspaceError("Project path must be 'project' or 'project/subproject'.")
    if any(part != slugify(part) for part in parts):
        raise WorkspaceError("Project path parts must be slug IDs.")
    return parts


def project_dir(root: str | Path, project_path: str) -> Path:
    parts = parse_project_path(project_path)
    path = workspace_path(root) / "projects" / parts[0]
    if len(parts) == 2:
        path = path / parts[1]
    return path


def project_json_path(root: str | Path, project_path: str) -> Path:
    return project_dir(root, project_path) / "project.json"


def ensure_project_exists(root: str | Path, project_path: str) -> None:
    if not project_json_path(root, project_path).exists():
        raise WorkspaceError(f"Project does not exist: {project_path}")


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def create_project(
    root: str | Path,
    title: str,
    *,
    parent: str | None = None,
    slug: str | None = None,
    notes: str = "",
    skills: list[str] | None = None,
    owner: str | None = None,
    visibility: str = "private",
) -> dict[str, Any]:
    init_workspace(root)
    project_slug = slug or slugify(title)
    selected_skills = skills or []
    owner_slug = slugify(owner) if owner else None
    visibility_value = validate_visibility(visibility)
    if owner_slug:
        load_account(root, owner_slug)

    if parent:
        parent_parts = parse_project_path(parent)
        if len(parent_parts) != 1:
            raise WorkspaceError("Subprojects can only be created under a root project.")
        ensure_project_exists(root, parent)
        parent_project = load_project(root, parent)
        if owner_slug is None:
            owner_slug = parent_project.get("owner")
        if visibility == "private":
            visibility_value = parent_project.get("visibility", "private")
        full_path = f"{parent}/{project_slug}"
    else:
        full_path = project_slug

    parts = parse_project_path(full_path)
    path = project_dir(root, full_path)
    if (path / "project.json").exists():
        raise WorkspaceError(f"Project already exists: {full_path}")
    path.mkdir(parents=True, exist_ok=False)
    (path / "sessions").mkdir(exist_ok=True)

    project = {
        "slug": parts[-1],
        "path": full_path,
        "title": title,
        "notes": notes,
        "parent": parent,
        "owner": owner_slug,
        "visibility": visibility_value,
        "skills": selected_skills,
        "created_at": utc_now(),
    }
    write_json(path / "project.json", project)
    return project


def general_chat_project_path(username: str | None) -> str:
    owner = slugify(username) if username else "local"
    return f"{GENERAL_CHAT_PREFIX}-{owner}"


def ensure_general_chat_project(root: str | Path, username: str | None) -> dict[str, Any]:
    init_workspace(root)
    project_path = general_chat_project_path(username)
    if project_json_path(root, project_path).exists():
        return load_project(root, project_path)
    owner = slugify(username) if username and has_accounts(root) else None
    project = create_project(
        root,
        "General chats",
        slug=project_path,
        notes="Projectless chats are stored here internally.",
        owner=owner,
        visibility="private",
    )
    project["hidden"] = True
    write_json(project_json_path(root, project_path), project)
    return project


def create_general_chat_session(
    root: str | Path,
    username: str | None,
    title: str,
    *,
    slug: str | None = None,
) -> tuple[str, dict[str, Any]]:
    project = ensure_general_chat_project(root, username)
    return project["path"], create_session(root, project["path"], title, slug=slug)


def load_project(root: str | Path, project_path: str) -> dict[str, Any]:
    ensure_project_exists(root, project_path)
    return read_json(project_json_path(root, project_path))


def list_projects(root: str | Path) -> list[dict[str, Any]]:
    projects_root = workspace_path(root) / "projects"
    if not projects_root.exists():
        return []
    projects: list[dict[str, Any]] = []
    for project_file in sorted(projects_root.glob("*/project.json")):
        projects.append(read_json(project_file))
        for subproject_file in sorted(project_file.parent.glob("*/project.json")):
            projects.append(read_json(subproject_file))
    return projects


def can_access_project(root: str | Path, project: dict[str, Any], username: str | None) -> bool:
    if not has_accounts(root):
        return True
    if project.get("visibility", "private") == "public":
        return True
    if username and project.get("owner") == slugify(username):
        return True
    return is_admin(root, username)


def list_visible_projects(root: str | Path, username: str | None) -> list[dict[str, Any]]:
    return [
        project
        for project in list_projects(root)
        if not project.get("hidden") and can_access_project(root, project, username)
    ]


def list_visible_general_chat_projects(root: str | Path, username: str | None) -> list[dict[str, Any]]:
    return [
        project
        for project in list_projects(root)
        if project.get("hidden") and can_access_project(root, project, username)
    ]


def ensure_project_access(root: str | Path, project_path: str, username: str | None) -> None:
    project = load_project(root, project_path)
    if not can_access_project(root, project, username):
        raise WorkspaceError(f"Account cannot access project: {project_path}")


def list_skills(root: str | Path) -> list[str]:
    skills_root = workspace_path(root) / "skills"
    if not skills_root.exists():
        return []
    return sorted(path.name for path in skills_root.iterdir() if path.is_dir())


def session_dir(root: str | Path, project_path: str, session_slug: str) -> Path:
    if session_slug != slugify(session_slug):
        raise WorkspaceError("Session slug must be a slug ID.")
    return project_dir(root, project_path) / "sessions" / session_slug


def create_session(
    root: str | Path,
    project_path: str,
    title: str,
    *,
    slug: str | None = None,
) -> dict[str, Any]:
    ensure_project_exists(root, project_path)
    session_slug = slug or slugify(title)
    path = session_dir(root, project_path, session_slug)
    if path.exists():
        raise WorkspaceError(f"Session already exists: {session_slug}")
    path.mkdir(parents=True)
    session = {
        "slug": session_slug,
        "title": title,
        "project_path": project_path,
        "created_at": utc_now(),
    }
    write_json(path / "session.json", session)
    (path / "messages.jsonl").write_text("", encoding="utf-8")
    regenerate_session_markdown(root, project_path, session_slug)
    return session


def load_session(root: str | Path, project_path: str, session_slug: str) -> dict[str, Any]:
    path = session_dir(root, project_path, session_slug) / "session.json"
    if not path.exists():
        raise WorkspaceError(f"Session does not exist: {session_slug}")
    return read_json(path)


def list_sessions(root: str | Path, project_path: str) -> list[dict[str, Any]]:
    ensure_project_exists(root, project_path)
    sessions_root = project_dir(root, project_path) / "sessions"
    if not sessions_root.exists():
        return []
    return [read_json(path) for path in sorted(sessions_root.glob("*/session.json"))]


def append_message(
    root: str | Path,
    project_path: str,
    session_slug: str,
    *,
    role: str,
    content: str,
    provider: str | None = None,
    model: str | None = None,
    metadata: dict[str, Any] | None = None,
    actor: str | None = None,
) -> dict[str, Any]:
    load_session(root, project_path, session_slug)
    if role not in {"system", "user", "assistant", "tool"}:
        raise WorkspaceError("Role must be one of: system, user, assistant, tool.")
    message = {
        "role": role,
        "content": content,
        "created_at": utc_now(),
        "metadata": metadata or {},
    }
    if provider:
        message["provider"] = provider
    if model:
        message["model"] = model

    messages_path = session_dir(root, project_path, session_slug) / "messages.jsonl"
    with messages_path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(message, ensure_ascii=False) + "\n")
    record_usage(root, actor, messages=1)
    regenerate_session_markdown(root, project_path, session_slug)
    return message


def create_execution_run(
    root: str | Path,
    project_path: str,
    session_slug: str,
    *,
    title: str = "Programming run",
    mode: str = "programming",
    actor: str | None = None,
) -> dict[str, Any]:
    load_session(root, project_path, session_slug)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S") + "-" + secrets.token_hex(4)
    runs_root = session_dir(root, project_path, session_slug) / "runs"
    run_dir = runs_root / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    run = {
        "id": run_id,
        "title": title,
        "mode": mode,
        "actor": slugify(actor) if actor else None,
        "status": "running",
        "created_at": utc_now(),
        "updated_at": utc_now(),
    }
    write_json(run_dir / "run.json", run)
    (run_dir / "events.jsonl").write_text("", encoding="utf-8")
    regenerate_run_markdown(root, project_path, session_slug, run_id)
    return run


def run_dir(root: str | Path, project_path: str, session_slug: str, run_id: str) -> Path:
    if not re.fullmatch(r"[0-9]{14}-[a-f0-9]{8}", run_id):
        raise WorkspaceError("Run id is invalid.")
    return session_dir(root, project_path, session_slug) / "runs" / run_id


def load_execution_run(root: str | Path, project_path: str, session_slug: str, run_id: str) -> dict[str, Any]:
    path = run_dir(root, project_path, session_slug, run_id) / "run.json"
    if not path.exists():
        raise WorkspaceError(f"Run does not exist: {run_id}")
    return read_json(path)


def update_execution_run_status(
    root: str | Path,
    project_path: str,
    session_slug: str,
    run_id: str,
    status: str,
) -> dict[str, Any]:
    if status not in {"running", "completed", "failed", "cancelled"}:
        raise WorkspaceError("Run status is invalid.")
    run = load_execution_run(root, project_path, session_slug, run_id)
    run["status"] = status
    run["updated_at"] = utc_now()
    write_json(run_dir(root, project_path, session_slug, run_id) / "run.json", run)
    regenerate_run_markdown(root, project_path, session_slug, run_id)
    return run


def append_run_event(
    root: str | Path,
    project_path: str,
    session_slug: str,
    run_id: str,
    *,
    event_type: str,
    content: str,
    metadata: dict[str, Any] | None = None,
    actor: str | None = None,
    mirror_to_session: bool = True,
) -> dict[str, Any]:
    load_execution_run(root, project_path, session_slug, run_id)
    event = {
        "type": event_type,
        "content": content,
        "created_at": utc_now(),
        "metadata": metadata or {},
    }
    events_path = run_dir(root, project_path, session_slug, run_id) / "events.jsonl"
    with events_path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(event, ensure_ascii=False) + "\n")
    if mirror_to_session:
        append_message(
            root,
            project_path,
            session_slug,
            role="tool",
            content=content,
            metadata={"run_id": run_id, "event_type": event_type, **(metadata or {})},
            actor=actor,
        )
    regenerate_run_markdown(root, project_path, session_slug, run_id)
    return event


def read_run_events(root: str | Path, project_path: str, session_slug: str, run_id: str) -> list[dict[str, Any]]:
    events_path = run_dir(root, project_path, session_slug, run_id) / "events.jsonl"
    if not events_path.exists():
        raise WorkspaceError(f"Run events do not exist: {run_id}")
    events = []
    for line in events_path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            events.append(json.loads(line))
    return events


def regenerate_run_markdown(root: str | Path, project_path: str, session_slug: str, run_id: str) -> None:
    run = load_execution_run(root, project_path, session_slug, run_id)
    events_path = run_dir(root, project_path, session_slug, run_id) / "events.jsonl"
    events = []
    if events_path.exists():
        events = read_run_events(root, project_path, session_slug, run_id)
    lines = [
        f"# {run['title']}",
        "",
        f"- Run: `{run_id}`",
        f"- Mode: `{run['mode']}`",
        f"- Status: `{run['status']}`",
        "",
    ]
    for event in events:
        lines.extend([f"## {event['type']}", "", event["content"], ""])
    (run_dir(root, project_path, session_slug, run_id) / "run.md").write_text(
        "\n".join(lines),
        encoding="utf-8",
    )


def read_messages(root: str | Path, project_path: str, session_slug: str) -> list[dict[str, Any]]:
    path = session_dir(root, project_path, session_slug) / "messages.jsonl"
    if not path.exists():
        raise WorkspaceError(f"Session messages do not exist: {session_slug}")
    messages = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            messages.append(json.loads(line))
    return messages


def regenerate_session_markdown(root: str | Path, project_path: str, session_slug: str) -> None:
    session = load_session(root, project_path, session_slug)
    messages_path = session_dir(root, project_path, session_slug) / "messages.jsonl"
    messages = []
    if messages_path.exists():
        messages = read_messages(root, project_path, session_slug)
    lines = [
        f"# {session['title']}",
        "",
        f"- Project: `{project_path}`",
        f"- Session: `{session_slug}`",
        "",
    ]
    for message in messages:
        lines.extend(
            [
                f"## {message['role'].title()}",
                "",
                message["content"],
                "",
                f"_Created at: {message['created_at']}_",
                "",
            ]
        )
    session_md = session_dir(root, project_path, session_slug) / "session.md"
    session_md.write_text("\n".join(lines), encoding="utf-8")


def project_chain(root: str | Path, project_path: str) -> list[dict[str, Any]]:
    parts = parse_project_path(project_path)
    if len(parts) == 1:
        return [load_project(root, parts[0])]
    return [load_project(root, parts[0]), load_project(root, project_path)]


def resolve_skill_names(root: str | Path, project_path: str) -> list[str]:
    seen: set[str] = set()
    names: list[str] = []
    for project in project_chain(root, project_path):
        for skill in project.get("skills", []):
            if skill not in seen:
                names.append(skill)
                seen.add(skill)
    return names


def skill_instruction_files(root: str | Path, skill_name: str) -> list[Path]:
    skill_dir = workspace_path(root) / "skills" / skill_name
    if not skill_dir.exists():
        raise WorkspaceError(f"Selected skill does not exist: {skill_name}")
    return [skill_dir / name for name in SUPPORTED_SKILL_FILES if (skill_dir / name).exists()]


def build_prompt_context(root: str | Path, project_path: str, session_slug: str) -> str:
    session = load_session(root, project_path, session_slug)
    projects = project_chain(root, project_path)
    messages = read_messages(root, project_path, session_slug)
    lines = ["# AIWS Prompt Context", ""]

    if any(project.get("hidden") for project in projects):
        lines.extend(["## Chat Scope", "Projectless general chat.", ""])
    else:
        lines.append("## Projects")
        for project in projects:
            lines.extend(
                [
                    f"### {project['title']}",
                    f"- Path: `{project['path']}`",
                    f"- Slug: `{project['slug']}`",
                ]
            )
            if project.get("notes"):
                lines.extend(["", project["notes"]])
            lines.append("")

    skill_names = resolve_skill_names(root, project_path)
    lines.extend(["## Skills", ""])
    if skill_names:
        for skill_name in skill_names:
            for skill_file in skill_instruction_files(root, skill_name):
                lines.extend(
                    [
                        f"### {skill_name}/{skill_file.name}",
                        "",
                        skill_file.read_text(encoding="utf-8").strip(),
                        "",
                    ]
                )
    else:
        lines.extend(["No skills selected.", ""])

    lines.extend(
        [
            "## Session",
            f"- Title: {session['title']}",
            f"- Slug: `{session['slug']}`",
            "",
            "## Messages",
            "",
        ]
    )
    if messages:
        for message in messages:
            lines.extend([f"### {message['role'].title()}", "", message["content"], ""])
    else:
        lines.extend(["No messages yet.", ""])
    return "\n".join(lines).rstrip() + "\n"


def copy_default_skill_to_repo(destination: str | Path = "skills") -> Path:
    """Create the repository-level bundled skill for source checkouts."""
    path = Path(destination) / DEFAULT_SKILL_NAME
    path.mkdir(parents=True, exist_ok=True)
    skill_file = path / DEFAULT_SKILL_FILE
    if not skill_file.exists():
        skill_file.write_text(DEFAULT_SKILL_CONTENT, encoding="utf-8")
    return skill_file


def reset_workspace(root: str | Path) -> None:
    """Test helper; not used by CLI."""
    root_path = workspace_path(root)
    if root_path.exists():
        shutil.rmtree(root_path)
