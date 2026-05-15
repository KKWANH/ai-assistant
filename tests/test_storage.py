import json
from threading import Thread

import pytest

from aiws import storage
from aiws import attachments


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


def test_duplicate_project_titles_get_sequence_slugs(tmp_path):
    root = tmp_path / "workspace"

    first = storage.create_project(root, "Test")
    second = storage.create_project(root, "Test")
    storage.create_project(root, "Parent")
    child_one = storage.create_project(root, "Child", parent="parent")
    child_two = storage.create_project(root, "Child", parent="parent")

    assert first["path"] == "test"
    assert second["path"] == "test-2"
    assert child_one["path"] == "parent/child"
    assert child_two["path"] == "parent/child-2"


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


def test_concurrent_message_appends_remain_valid_jsonl(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Concurrency")

    threads = [
        Thread(
            target=storage.append_message,
            args=(root, "ai-system", "concurrency"),
            kwargs={"role": "user", "content": f"message {index}"},
        )
        for index in range(20)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    messages = storage.read_messages(root, "ai-system", "concurrency")
    assert len(messages) == 20
    assert {message["content"] for message in messages} == {f"message {index}" for index in range(20)}


def test_concurrent_profile_updates_do_not_corrupt_users_json(tmp_path):
    root = tmp_path / "workspace"
    storage.create_account(root, "Kwanho", "secret")

    threads = [
        Thread(
            target=storage.update_account_profile,
            args=(root, "kwanho"),
            kwargs={"job": f"job-{index}", "memory": f"memory {index}"},
        )
        for index in range(12)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    users = storage.load_users(root)
    account = users["users"]["kwanho"]
    assert account["profile"]["job"].startswith("job-")
    memories = account["profile"]["memory"]
    assert len(memories) == 12
    assert {item["content"] for item in memories} == {f"memory {index}" for index in range(12)}


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


def test_prompt_context_includes_session_and_project_attachments(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Research")
    storage.create_session(root, "research", "Source Session")
    storage.create_session(root, "research", "Current Session")

    attachments.save_attachment(root, "research", "source-session", "shared.txt", b"shared project evidence")
    attachments.save_attachment(root, "research", "current-session", "paper.pdf", b"%PDF-1.4\n(Current PDF text)")

    context = storage.build_prompt_context(root, "research", "current-session")

    assert "## Session Files" in context
    assert "paper.pdf" in context
    assert "Current PDF text" in context
    assert "## Project Files" in context
    assert "shared.txt (source-session)" in context
    assert "shared project evidence" in context


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
    assert admin["nickname"] == "Kwanho Kim"
    assert admin["profile"]["ui_mode"] == "power"
    assert parent["profile"]["ui_mode"] == "easy"
    assert storage.create_account(root, "benetea", "secret")["nickname"] == "Chungja Byun"
    assert storage.create_account(root, "dosadol", "secret")["nickname"] == "Gunwoo Kim"
    assert storage.create_account(root, "kwanho0096", "secret")["nickname"] == "Kwanho Kim"
    assert storage.display_name_for_username(None) == "Kwanho Kim"
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
        ui_mode="power",
        memory="Prefers concise answers.",
    )

    assert account["profile"]["language"] == "en"
    assert account["profile"]["ui_mode"] == "power"
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
    project = storage.load_project(root, project_path)
    assert project["hidden"] is True
    assert project["visibility"] == "private"
    assert storage.list_visible_projects(root, "kwanho") == []
    assert [project["path"] for project in storage.list_visible_general_chat_projects(root, "kwanho")] == ["general-chat-kwanho"]

    context = storage.build_prompt_context(root, project_path, "quick-thought")
    assert "Projectless general chat" in context


def test_projectless_general_chat_accepts_blank_and_duplicate_titles(tmp_path):
    root = tmp_path / "workspace"
    storage.init_workspace(root)

    project_path, first = storage.create_general_chat_session(root, None, "")
    _, second = storage.create_general_chat_session(root, None, "New chat")

    assert project_path == "general-chat-local"
    assert first["slug"] == "new-chat"
    assert first["title"] == "New chat"
    assert second["slug"] == "new-chat-2"

    storage.append_message(root, project_path, first["slug"], role="user", content="Hello", actor="kwanho")
    assert storage.read_messages(root, project_path, first["slug"])[0]["actor"] == "kwanho"
    updated = storage.maybe_update_default_session_title(root, project_path, first["slug"], "첨부한 pdf 파일을 분석해줘")
    assert updated["title"] == "첨부한 pdf 파일을 분석"
    assert updated["title_auto"] is True


def test_auto_title_prefers_short_instruction_over_long_body(tmp_path):
    root = tmp_path / "workspace"
    project_path, session = storage.create_general_chat_session(root, None, "")
    content = (
        "Lorem Ipsum is simply dummy text of the printing and typesetting industry. "
        "Lorem Ipsum has been the industry's standard dummy text ever since the 1500s.\n\n"
        "이 글 요약해줘!\n\n"
        "이 글을 요약하고 뒤에 더 창작해봐!"
    )

    updated = storage.maybe_update_default_session_title(root, project_path, session["slug"], content)

    assert updated["title"] == "글 요약"
    assert len(updated["title"]) <= 28


def test_old_ellipsis_auto_title_can_be_repaired(tmp_path):
    root = tmp_path / "workspace"
    project_path, session = storage.create_general_chat_session(root, None, "Lorem Ipsum is simply dummy text of the pr...")

    updated = storage.maybe_update_default_session_title(root, project_path, session["slug"], "이 글 요약해줘!")

    assert updated["title"] == "글 요약"


def test_owner_can_move_general_chat_into_project(tmp_path):
    root = tmp_path / "workspace"
    storage.create_account(root, "Kwanho", "secret", admin=True)
    storage.create_account(root, "Other", "secret")
    project = storage.create_project(root, "Research", owner="kwanho")
    source_project_path, session = storage.create_general_chat_session(root, "kwanho", "Move this chat")
    storage.append_message(root, source_project_path, session["slug"], role="user", content="Keep this", actor="kwanho")

    with pytest.raises(storage.WorkspaceError, match="Only the project owner"):
        storage.ensure_project_owner(root, project["path"], "other")

    moved = storage.move_session_to_project(root, source_project_path, session["slug"], project["path"])

    assert moved["project_path"] == "research"
    assert storage.read_messages(root, "research", moved["slug"])[0]["content"] == "Keep this"
    assert not storage.session_dir(root, source_project_path, session["slug"]).exists()
    assert storage.session_dir(root, "research", moved["slug"]).exists()


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


def test_project_goal_round_trip_and_codex_prompt(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    markdown = """# Goal

## Objective
Build a trustworthy family AI workspace.

## Current Status
MVP is running.

## Next Actions
- Improve PDF previews
- Add Codex prompt copy

## Success Criteria
- Tests pass

## Test Commands
- .venv/bin/python -m pytest
"""

    goal = storage.set_goal_from_markdown(root, "ai-system", markdown)

    assert goal["objective"] == "Build a trustworthy family AI workspace."
    assert "Improve PDF previews" in goal["next_actions"]
    assert (storage.project_dir(root, "ai-system") / "GOAL.md").exists()
    prompt = storage.codex_goal_prompt(root, "ai-system", "planning")
    assert "Build a trustworthy family AI workspace." in prompt
    assert "Session: planning" in prompt


def test_workspace_backup_and_restore(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    backup = storage.create_workspace_backup(root, tmp_path / "backup")

    assert backup.name == "backup.tar.gz"

    restored = storage.restore_workspace_backup(backup, tmp_path / "restored")
    assert storage.load_project(restored, "ai-system")["title"] == "AI System"
    with pytest.raises(storage.WorkspaceError, match="not empty"):
        storage.restore_workspace_backup(backup, restored)
