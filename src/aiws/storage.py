"""File-based storage core for Local AI Workspace."""

from __future__ import annotations

import json
import hashlib
import hmac
import re
import secrets
import shutil
import tarfile
from datetime import datetime, timezone
from datetime import date
from pathlib import Path
from typing import Any

SUPPORTED_SKILL_FILES = ("CLAUDE.md", "SKILL.md", "skills.md", "README.md")
SUPPORTED_AVATAR_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
SUPPORTED_LANGUAGES = {"en", "ko"}
GENERAL_CHAT_PREFIX = "general-chat"
KNOWN_NICKNAMES = {
    "local": "Kwanho Kim",
    "kwanho": "Kwanho Kim",
    "kwanho0096": "Kwanho Kim",
    "benetea": "Chungja Byun",
    "dosadol": "Gunwoo Kim",
}

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


def slugify_or_default(value: str, default: str) -> str:
    try:
        return slugify(value)
    except WorkspaceError:
        return slugify(default)


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


def create_workspace_backup(root: str | Path, destination: str | Path) -> Path:
    source = workspace_path(root)
    if not source.exists():
        raise WorkspaceError(f"Workspace does not exist: {source}")
    destination_path = Path(destination).expanduser()
    if destination_path.suffixes[-2:] != [".tar", ".gz"]:
        destination_path = destination_path.with_suffix(destination_path.suffix + ".tar.gz")
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(destination_path, "w:gz") as archive:
        for child in source.iterdir():
            if child.name in {"run", "logs"}:
                continue
            archive.add(child, arcname=child.name)
    return destination_path.resolve()


def restore_workspace_backup(archive_path: str | Path, destination: str | Path, *, replace: bool = False) -> Path:
    archive = Path(archive_path).expanduser().resolve()
    if not archive.exists():
        raise WorkspaceError(f"Backup archive does not exist: {archive}")
    destination_path = workspace_path(destination)
    if destination_path.exists() and any(destination_path.iterdir()):
        if not replace:
            raise WorkspaceError("Destination workspace is not empty. Use --replace to restore over it.")
        shutil.rmtree(destination_path)
    destination_path.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar.getmembers():
            target = (destination_path / member.name).resolve()
            if not str(target).startswith(str(destination_path) + "/") and target != destination_path:
                raise WorkspaceError("Backup archive contains an unsafe path.")
        tar.extractall(destination_path)
    init_workspace(destination_path)
    return destination_path


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
    nickname = display_name or display_name_for_username(username_slug)
    user = {
        "username": username_slug,
        "nickname": nickname,
        "display_name": nickname,
        "password": hash_password(password),
        "admin": admin,
        "created_at": utc_now(),
        "profile": {
            "name": nickname,
            "age": "",
            "job": "",
            "situation": "",
            "language": "ko",
            "ui_mode": "power" if admin else "easy",
            "memory": [],
            "avatar": "",
        },
        "usage": {"messages": 0, "asks": 0},
    }
    users["users"][username_slug] = user
    save_users(root, users)
    return public_account(user)


def public_account(user: dict[str, Any]) -> dict[str, Any]:
    username = user["username"]
    nickname = user.get("nickname") or user.get("display_name") or display_name_for_username(username)
    if nickname == username:
        nickname = display_name_for_username(username)
    profile = dict(user.get("profile", {}))
    profile.setdefault("ui_mode", "power" if bool(user.get("admin", False)) else "easy")
    return {
        "username": username,
        "nickname": nickname,
        "display_name": nickname,
        "admin": bool(user.get("admin", False)),
        "created_at": user.get("created_at"),
        "profile": profile,
        "usage": user.get("usage", {"messages": 0, "asks": 0}),
    }


def list_accounts(root: str | Path) -> list[dict[str, Any]]:
    users = load_users(root)
    return [public_account(user) for user in users["users"].values()]


def display_name_for_username(username: str | None) -> str:
    if not username:
        return KNOWN_NICKNAMES["local"]
    username_slug = slugify_or_default(username, "local")
    return KNOWN_NICKNAMES.get(username_slug, username_slug)


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


def model_usage_jsonl_path(root: str | Path) -> Path:
    path = workspace_path(root) / "usage"
    path.mkdir(parents=True, exist_ok=True)
    return path / "model_usage.jsonl"


def append_model_usage(root: str | Path, record: dict[str, Any]) -> dict[str, Any]:
    saved = dict(record)
    saved.setdefault("created_at", utc_now())
    with model_usage_jsonl_path(root).open("a", encoding="utf-8") as file:
        file.write(json.dumps(saved, ensure_ascii=False) + "\n")
    return saved


def list_model_usage(root: str | Path, username: str | None = None) -> list[dict[str, Any]]:
    path = model_usage_jsonl_path(root)
    if not path.exists():
        return []
    username_slug = slugify(username) if username else None
    items: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(item, dict):
            continue
        if username_slug and item.get("user_id") != username_slug:
            continue
        items.append(item)
    return items


def model_usage_total_usd(root: str | Path, username: str | None, *, period: str) -> float:
    now = date.today()
    total = 0.0
    for item in list_model_usage(root, username):
        created_at = str(item.get("created_at", ""))
        if period == "day" and not created_at.startswith(now.isoformat()):
            continue
        if period == "month" and not created_at.startswith(now.isoformat()[:7]):
            continue
        total += float(item.get("actual_usd") or item.get("estimated_usd") or 0.0)
    return round(total, 8)


def update_account_profile(
    root: str | Path,
    username: str,
    *,
    name: str | None = None,
    age: str | None = None,
    job: str | None = None,
    situation: str | None = None,
    language: str | None = None,
    ui_mode: str | None = None,
    memory: str | None = None,
) -> dict[str, Any]:
    users = load_users(root)
    username_slug = slugify(username)
    user = users["users"].get(username_slug)
    if not user:
        raise WorkspaceError(f"Account does not exist: {username_slug}")
    profile = user.setdefault("profile", {})
    if name is not None:
        nickname = name or display_name_for_username(username_slug)
        profile["name"] = nickname
        user["nickname"] = nickname
        user["display_name"] = nickname
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
    if ui_mode is not None:
        if ui_mode not in {"easy", "power"}:
            raise WorkspaceError("UI mode must be easy or power.")
        profile["ui_mode"] = ui_mode
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
    base_slug = slug or slugify(title)
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
        project_slug = next_available_project_slug(root, parent, base_slug)
        full_path = f"{parent}/{project_slug}"
    else:
        project_slug = next_available_project_slug(root, None, base_slug)
        full_path = project_slug

    parts = parse_project_path(full_path)
    path = project_dir(root, full_path)
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


def next_available_project_slug(root: str | Path, parent: str | None, base_slug: str) -> str:
    candidate = base_slug
    index = 2
    while True:
        project_path = f"{parent}/{candidate}" if parent else candidate
        if not project_json_path(root, project_path).exists():
            return candidate
        candidate = f"{base_slug}-{index}"
        index += 1


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
    session_title = title.strip() or "New chat"
    session_slug = slug or next_available_session_slug(root, project["path"], slugify_or_default(session_title, "new-chat"))
    return project["path"], create_session(root, project["path"], session_title, slug=session_slug)


def next_available_session_slug(root: str | Path, project_path: str, base_slug: str) -> str:
    candidate = base_slug
    index = 2
    while (project_dir(root, project_path) / "sessions" / candidate).exists():
        candidate = f"{base_slug}-{index}"
        index += 1
    return candidate


def load_project(root: str | Path, project_path: str) -> dict[str, Any]:
    ensure_project_exists(root, project_path)
    return read_json(project_json_path(root, project_path))


DEFAULT_GOAL = {
    "objective": "",
    "current_status": "",
    "next_actions": [],
    "constraints": [],
    "success_criteria": [],
    "test_commands": [],
}


def goal_json_path(root: str | Path, project_path: str) -> Path:
    return project_dir(root, project_path) / "goal.json"


def goal_markdown_path(root: str | Path, project_path: str) -> Path:
    return project_dir(root, project_path) / "GOAL.md"


def load_goal(root: str | Path, project_path: str) -> dict[str, Any]:
    ensure_project_exists(root, project_path)
    path = goal_json_path(root, project_path)
    if path.exists():
        data = read_json(path)
        return normalize_goal(data)
    markdown_path = goal_markdown_path(root, project_path)
    if markdown_path.exists():
        return normalize_goal(parse_goal_markdown(markdown_path.read_text(encoding="utf-8")))
    return normalize_goal({})


def save_goal(root: str | Path, project_path: str, goal: dict[str, Any]) -> dict[str, Any]:
    ensure_project_exists(root, project_path)
    normalized = normalize_goal(goal)
    normalized["updated_at"] = utc_now()
    write_json(goal_json_path(root, project_path), normalized)
    goal_markdown_path(root, project_path).write_text(goal_to_markdown(normalized), encoding="utf-8")
    return normalized


def set_goal_from_markdown(root: str | Path, project_path: str, markdown: str) -> dict[str, Any]:
    return save_goal(root, project_path, parse_goal_markdown(markdown))


def normalize_goal(goal: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(DEFAULT_GOAL)
    for key in ("objective", "current_status"):
        value = goal.get(key, "")
        normalized[key] = str(value or "")
    for key in ("next_actions", "constraints", "success_criteria", "test_commands"):
        value = goal.get(key, [])
        if isinstance(value, str):
            normalized[key] = [line.strip("- ").strip() for line in value.splitlines() if line.strip()]
        elif isinstance(value, list):
            normalized[key] = [str(item).strip() for item in value if str(item).strip()]
    if goal.get("updated_at"):
        normalized["updated_at"] = str(goal["updated_at"])
    return normalized


def parse_goal_markdown(markdown: str) -> dict[str, Any]:
    aliases = {
        "objective": "objective",
        "goal": "objective",
        "current status": "current_status",
        "status": "current_status",
        "next actions": "next_actions",
        "actions": "next_actions",
        "constraints": "constraints",
        "success criteria": "success_criteria",
        "tests": "test_commands",
        "test commands": "test_commands",
    }
    goal: dict[str, Any] = {}
    current_key = "objective"
    buffers: dict[str, list[str]] = {}
    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("#"):
            heading = line.lstrip("#").strip().lower()
            current_key = aliases.get(heading, current_key)
            buffers.setdefault(current_key, [])
            continue
        buffers.setdefault(current_key, []).append(line)
    for key, lines in buffers.items():
        if key in {"objective", "current_status"}:
            goal[key] = "\n".join(line.strip("- ").strip() for line in lines).strip()
        else:
            goal[key] = [line.strip("- ").strip() for line in lines if line.strip("- ").strip()]
    return goal


def goal_to_markdown(goal: dict[str, Any]) -> str:
    normalized = normalize_goal(goal)
    lines = ["# Goal", "", "## Objective", "", normalized["objective"] or "_Not set._", ""]
    lines.extend(["## Current Status", "", normalized["current_status"] or "_Not set._", ""])
    for key, heading in (
        ("next_actions", "Next Actions"),
        ("constraints", "Constraints"),
        ("success_criteria", "Success Criteria"),
        ("test_commands", "Test Commands"),
    ):
        lines.extend([f"## {heading}", ""])
        items = normalized[key]
        if items:
            lines.extend(f"- {item}" for item in items)
        else:
            lines.append("_Not set._")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def codex_goal_prompt(root: str | Path, project_path: str, session_slug: str | None = None) -> str:
    project = load_project(root, project_path)
    goal = load_goal(root, project_path)
    lines = [
        "You are Codex working in the local AIWS repository.",
        "",
        f"Project: {project.get('title', project_path)}",
        f"Path: {project_path}",
    ]
    if session_slug:
        lines.append(f"Session: {session_slug}")
    lines.extend(
        [
            "",
            "## Objective",
            goal["objective"] or "Not set.",
            "",
            "## Current Status",
            goal["current_status"] or "Not set.",
            "",
            "## Next Actions",
        ]
    )
    lines.extend(f"- {item}" for item in goal["next_actions"] or ["Not set."])
    lines.extend(["", "## Constraints"])
    lines.extend(f"- {item}" for item in goal["constraints"] or ["Keep changes small and verified."])
    lines.extend(["", "## Success Criteria"])
    lines.extend(f"- {item}" for item in goal["success_criteria"] or ["Tests pass."])
    lines.extend(["", "## Test Commands"])
    lines.extend(f"- `{item}`" for item in goal["test_commands"] or [".venv/bin/python -m pytest"])
    return "\n".join(lines).rstrip() + "\n"


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


def ensure_project_owner(root: str | Path, project_path: str, username: str | None) -> None:
    if not has_accounts(root):
        return
    project = load_project(root, project_path)
    owner = project.get("owner")
    if not username or owner != slugify(username):
        raise WorkspaceError("Only the project owner can move chats into this project.")


def move_session_to_project(
    root: str | Path,
    source_project_path: str,
    session_slug: str,
    target_project_path: str,
) -> dict[str, Any]:
    ensure_project_exists(root, source_project_path)
    ensure_project_exists(root, target_project_path)
    session = load_session(root, source_project_path, session_slug)
    source = session_dir(root, source_project_path, session_slug)
    base_slug = slugify_or_default(str(session.get("slug") or session.get("title") or session_slug), "new-chat")
    target_slug = next_available_session_slug(root, target_project_path, base_slug)
    target = session_dir(root, target_project_path, target_slug)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(target))
    session["slug"] = target_slug
    session["project_path"] = target_project_path
    session["moved_at"] = utc_now()
    write_json(target / "session.json", session)
    update_moved_attachment_paths(root, target_project_path, target_slug)
    regenerate_session_markdown(root, target_project_path, target_slug)
    return session


def move_session_to_general_chat(
    root: str | Path,
    source_project_path: str,
    session_slug: str,
    username: str | None,
) -> tuple[str, dict[str, Any]]:
    project = ensure_general_chat_project(root, username)
    session = move_session_to_project(root, source_project_path, session_slug, str(project["path"]))
    return str(project["path"]), session


def delete_session(root: str | Path, project_path: str, session_slug: str) -> None:
    ensure_project_exists(root, project_path)
    target = session_dir(root, project_path, session_slug)
    if not target.exists():
        raise WorkspaceError(f"Session does not exist: {session_slug}")
    shutil.rmtree(target)


def update_project_title(root: str | Path, project_path: str, title: str) -> dict[str, Any]:
    project = load_project(root, project_path)
    clean_title = title.strip()
    if not clean_title:
        raise WorkspaceError("Project title must not be empty.")
    project["title"] = clean_title
    project["updated_at"] = utc_now()
    write_json(project_json_path(root, project_path), project)
    return project


def delete_project(root: str | Path, project_path: str) -> None:
    ensure_project_exists(root, project_path)
    shutil.rmtree(project_dir(root, project_path))


def update_moved_attachment_paths(root: str | Path, project_path: str, session_slug: str) -> None:
    metadata_path = session_dir(root, project_path, session_slug) / "attachments" / "attachments.jsonl"
    if not metadata_path.exists():
        return
    updated = []
    for item in read_attachment_metadata(root, project_path, session_slug):
        filename = str(item.get("filename", ""))
        if filename:
            item["path"] = str(
                (session_dir(root, project_path, session_slug) / "attachments" / filename).relative_to(workspace_path(root))
            )
        updated.append(json.dumps(item, ensure_ascii=False))
    metadata_path.write_text("\n".join(updated) + ("\n" if updated else ""), encoding="utf-8")


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
    if actor:
        message["actor"] = slugify(actor)

    messages_path = session_dir(root, project_path, session_slug) / "messages.jsonl"
    with messages_path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(message, ensure_ascii=False) + "\n")
    record_usage(root, actor, messages=1)
    regenerate_session_markdown(root, project_path, session_slug)
    return message


def update_session_title(root: str | Path, project_path: str, session_slug: str, title: str) -> dict[str, Any]:
    session = load_session(root, project_path, session_slug)
    clean_title = title.strip()
    if not clean_title:
        raise WorkspaceError("Session title must not be empty.")
    session["title"] = clean_title
    session["updated_at"] = utc_now()
    write_json(session_dir(root, project_path, session_slug) / "session.json", session)
    regenerate_session_markdown(root, project_path, session_slug)
    return session


def suggest_session_title(content: str, *, fallback: str = "New chat", max_length: int = 42) -> str:
    text = re.sub(r"\s+", " ", content).strip()
    if not text:
        return fallback
    for separator in ("?", "!", ".", "。", "?", "!", "\n"):
        if separator in text:
            text = text.split(separator, 1)[0].strip()
            break
    if len(text) > max_length:
        text = text[:max_length].rstrip() + "..."
    return text or fallback


def maybe_update_default_session_title(
    root: str | Path,
    project_path: str,
    session_slug: str,
    content: str,
) -> dict[str, Any] | None:
    session = load_session(root, project_path, session_slug)
    current_title = str(session.get("title", "")).strip().lower()
    if current_title not in {"", "new chat", "new-chat"}:
        return None
    return update_session_title(root, project_path, session_slug, suggest_session_title(content))


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
    session_files = session_attachment_context(root, project_path, session_slug)
    project_files = project_attachment_context(root, project_path, exclude_session=session_slug)
    try:
        from .core import action_registry

        run_context = action_registry.latest_run_context(root, project_path)
    except Exception:
        run_context = ""
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
        ]
    )

    if session_files:
        lines.extend(["## Session Files", ""])
        lines.extend(session_files)
        lines.append("")

    if project_files:
        lines.extend(["## Project Files", ""])
        lines.extend(project_files)
        lines.append("")

    if run_context:
        lines.extend([run_context, ""])

    lines.extend(
        [
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


def read_attachment_metadata(root: str | Path, project_path: str, session_slug: str) -> list[dict[str, Any]]:
    path = session_dir(root, project_path, session_slug) / "attachments" / "attachments.jsonl"
    if not path.exists():
        return []
    items: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            items.append(item)
    return items


def attachment_context_lines(
    root: str | Path,
    project_path: str,
    session_slug: str,
    *,
    include_session_label: bool = False,
    text_budget: int = 50_000,
) -> list[str]:
    lines: list[str] = []
    used = 0
    for item in read_attachment_metadata(root, project_path, session_slug):
        filename = str(item.get("filename", "attachment"))
        content_type = str(item.get("content_type", "file"))
        text = str(item.get("text", "")).strip()
        delivery = str(item.get("delivery", "attached"))
        heading = f"### {filename}"
        if include_session_label:
            heading += f" ({session_slug})"
        lines.extend([heading, f"- Type: {content_type}", f"- Delivery: {delivery}"])
        if text:
            remaining = max(text_budget - used, 0)
            snippet = text[:remaining]
            used += len(snippet)
            lines.extend(["", snippet, ""])
        else:
            lines.extend(["", "No extracted text is available for this file.", ""])
        if used >= text_budget:
            lines.append("Attachment context truncated.")
            break
    return lines


def session_attachment_context(root: str | Path, project_path: str, session_slug: str) -> list[str]:
    return attachment_context_lines(root, project_path, session_slug)


def project_attachment_context(root: str | Path, project_path: str, *, exclude_session: str = "") -> list[str]:
    if any(project.get("hidden") for project in project_chain(root, project_path)):
        return []
    lines: list[str] = []
    for session in list_sessions(root, project_path):
        slug = str(session["slug"])
        if slug == exclude_session:
            continue
        session_lines = attachment_context_lines(root, project_path, slug, include_session_label=True, text_budget=12_000)
        if session_lines:
            lines.extend(session_lines)
    return lines


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
