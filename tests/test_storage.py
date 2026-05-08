import json

import pytest

from aiws import storage


def test_workspace_initialization_creates_default_skill(tmp_path):
    root = storage.init_workspace(tmp_path / "workspace")

    assert (root / "projects").is_dir()
    skill_file = root / "skills" / "andrej-karpathy-skills" / "CLAUDE.md"
    assert skill_file.exists()
    assert "Think Before Coding" in skill_file.read_text(encoding="utf-8")


def test_root_project_creation(tmp_path):
    root = tmp_path / "workspace"
    project = storage.create_project(
        root,
        "AI System",
        notes="Local-first AI gateway.",
        skills=["andrej-karpathy-skills"],
    )

    assert project["path"] == "ai-system"
    loaded = storage.load_project(root, "ai-system")
    assert loaded["title"] == "AI System"
    assert loaded["skills"] == ["andrej-karpathy-skills"]


def test_subproject_creation_and_third_level_rejection(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    subproject = storage.create_project(root, "Local Runner", parent="ai-system")

    assert subproject["path"] == "ai-system/local-runner"
    with pytest.raises(storage.WorkspaceError, match="root project"):
        storage.create_project(root, "Third Level", parent="ai-system/local-runner")
    with pytest.raises(storage.WorkspaceError, match="Project path"):
        storage.parse_project_path("ai-system/local-runner/third")


def test_session_creation_append_jsonl_and_markdown(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    session = storage.create_session(root, "ai-system", "Ollama MVP")

    assert session["slug"] == "ollama-mvp"
    message = storage.append_message(
        root,
        "ai-system",
        "ollama-mvp",
        role="user",
        content="How should we implement the Ollama runner?",
    )

    assert message["role"] == "user"
    session_path = storage.session_dir(root, "ai-system", "ollama-mvp")
    jsonl_lines = (session_path / "messages.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(jsonl_lines) == 1
    decoded = json.loads(jsonl_lines[0])
    assert decoded["content"] == "How should we implement the Ollama runner?"
    assert decoded["metadata"] == {}

    markdown = (session_path / "session.md").read_text(encoding="utf-8")
    assert "# Ollama MVP" in markdown
    assert "## User" in markdown
    assert "How should we implement" in markdown


def test_skill_inheritance_from_parent_project(tmp_path):
    root = tmp_path / "workspace"
    storage.init_workspace(root)
    skill_dir = root / "skills" / "local-style"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text("# Local Style\n\nBe concise.", encoding="utf-8")

    storage.create_project(root, "AI System", skills=["andrej-karpathy-skills"])
    storage.create_project(root, "Local Runner", parent="ai-system", skills=["local-style"])
    storage.create_session(root, "ai-system/local-runner", "Ollama MVP")

    assert storage.resolve_skill_names(root, "ai-system/local-runner") == [
        "andrej-karpathy-skills",
        "local-style",
    ]
    context = storage.build_prompt_context(root, "ai-system/local-runner", "ollama-mvp")
    assert "andrej-karpathy-skills/CLAUDE.md" in context
    assert "local-style/SKILL.md" in context
    assert "AI System" in context
    assert "Local Runner" in context


def test_invalid_role_is_rejected(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Ollama MVP")

    with pytest.raises(storage.WorkspaceError, match="Role must be"):
        storage.append_message(root, "ai-system", "ollama-mvp", role="bad", content="Nope")


def test_accounts_project_visibility_and_usage(tmp_path):
    root = tmp_path / "workspace"
    admin = storage.create_account(root, "Kwanho", "secret", admin=True)
    parent = storage.create_account(root, "Parent", "parent-secret")

    assert admin["username"] == "kwanho"
    assert storage.authenticate_account(root, "kwanho", "secret")["admin"] is True
    assert storage.authenticate_account(root, "parent", "wrong") is None

    storage.create_project(root, "Private Notes", owner="kwanho", visibility="private")
    storage.create_project(root, "Family Notes", owner="parent", visibility="public")

    assert [project["path"] for project in storage.list_visible_projects(root, "parent")] == ["family-notes"]
    assert {project["path"] for project in storage.list_visible_projects(root, "kwanho")} == {
        "private-notes",
        "family-notes",
    }

    storage.create_session(root, "family-notes", "Shared")
    storage.append_message(root, "family-notes", "shared", role="user", content="Hello", actor="parent")
    usage = storage.load_account(root, "parent")["usage"]
    assert usage["messages"] == 1


def test_account_profile_memory_language_and_avatar(tmp_path):
    root = tmp_path / "workspace"
    storage.create_account(root, "Kwanho", "secret", admin=True)

    account = storage.update_account_profile(
        root,
        "kwanho",
        name="Kwanho Kim",
        age="40",
        job="Engineer",
        situation="Building a local AI workspace.",
        language="en",
        memory="Prefers concise answers.",
    )

    assert account["profile"]["language"] == "en"
    context = storage.account_context(root, "kwanho")
    assert "Kwanho Kim" in context
    assert "Prefers concise answers." in context

    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 12
    avatar = storage.set_account_avatar(root, "kwanho", "avatar.png", png)
    assert avatar == "avatars/kwanho.png"
    assert (storage.workspace_path(root) / avatar).read_bytes() == png

    with pytest.raises(storage.WorkspaceError, match="image file"):
        storage.set_account_avatar(root, "kwanho", "avatar.txt", b"hello")


def test_projectless_general_chat_is_hidden_from_project_list(tmp_path):
    root = tmp_path / "workspace"
    storage.create_account(root, "Kwanho", "secret", admin=True)

    project_path, session = storage.create_general_chat_session(root, "kwanho", "Quick thought")

    assert project_path == "general-chat-kwanho"
    assert session["slug"] == "quick-thought"
    assert storage.load_project(root, project_path)["hidden"] is True
    assert storage.list_visible_projects(root, "kwanho") == []
    assert [project["path"] for project in storage.list_visible_general_chat_projects(root, "kwanho")] == [
        "general-chat-kwanho"
    ]

    context = storage.build_prompt_context(root, project_path, "quick-thought")
    assert "Projectless general chat" in context


def test_execution_run_events_are_structured_and_mirrored_to_session(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Coding")

    run = storage.create_execution_run(root, "ai-system", "coding", title="Pytest run")
    event = storage.append_run_event(
        root,
        "ai-system",
        "coding",
        run["id"],
        event_type="command",
        content="$ python -m pytest",
        metadata={"cwd": "/repo"},
    )
    storage.update_execution_run_status(root, "ai-system", "coding", run["id"], "completed")

    assert event["type"] == "command"
    assert storage.load_execution_run(root, "ai-system", "coding", run["id"])["status"] == "completed"
    assert storage.read_run_events(root, "ai-system", "coding", run["id"])[0]["content"] == "$ python -m pytest"
    messages = storage.read_messages(root, "ai-system", "coding")
    assert messages[0]["role"] == "tool"
    assert messages[0]["metadata"]["run_id"] == run["id"]
    run_md = storage.run_dir(root, "ai-system", "coding", run["id"]) / "run.md"
    assert "Pytest run" in run_md.read_text(encoding="utf-8")
