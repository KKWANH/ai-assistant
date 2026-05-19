from datetime import UTC, datetime

import pytest

from aiws.domain.enums import MessageRole
from aiws.domain.models import Message, Project, Session
from aiws.infrastructure.security.path_guard import PathGuard
from aiws.infrastructure.storage.file_store import JsonFileStore
from aiws.infrastructure.storage.repositories import (
    FileMessageRepository,
    FileProjectRepository,
    FileSessionRepository,
)
from aiws.infrastructure.storage.workspace_layout import WorkspaceLayout

NOW = datetime(2026, 5, 19, tzinfo=UTC)


def test_json_file_store_writes_and_reads_atomic_json(tmp_path) -> None:
    store = JsonFileStore()
    path = tmp_path / "workspace.json"

    store.write_json(path, {"id": "workspace_local", "mode": "local"})

    assert store.read_json(path) == {"id": "workspace_local", "mode": "local"}
    assert not list(tmp_path.glob("*.tmp"))


def test_jsonl_append_and_read(tmp_path) -> None:
    store = JsonFileStore()
    path = tmp_path / "messages.jsonl"

    store.append_jsonl(path, {"id": "message_1", "content": "hello"})
    store.append_jsonl(path, {"id": "message_2", "content": "world"})

    assert store.read_jsonl(path) == [
        {"id": "message_1", "content": "hello"},
        {"id": "message_2", "content": "world"},
    ]


def test_path_guard_blocks_traversal(tmp_path) -> None:
    guard = PathGuard(tmp_path)

    with pytest.raises(ValueError):
        guard.resolve_under_root("../outside")


def test_project_session_message_repositories_round_trip(tmp_path) -> None:
    layout = WorkspaceLayout(tmp_path)
    project_repo = FileProjectRepository(layout)
    session_repo = FileSessionRepository(layout)
    message_repo = FileMessageRepository(layout)

    project = Project(
        id="project_1",
        path="research",
        slug="research",
        title="Research",
        created_at=NOW,
        updated_at=NOW,
    )
    session = Session(
        id="session_1",
        slug="planning",
        project_path="research",
        title="Planning",
        created_at=NOW,
        updated_at=NOW,
    )
    message = Message(
        id="message_1",
        session_id="session_1",
        role=MessageRole.USER,
        content="Build from domain first.",
        created_at=NOW,
    )

    project_repo.save(project)
    session_repo.save(session)
    message_repo.append("research", "planning", message)

    assert project_repo.get("research") == project
    assert session_repo.get("research", "planning") == session
    assert message_repo.list_for_session("research", "planning") == (message,)
