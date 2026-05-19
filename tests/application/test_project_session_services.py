from dataclasses import dataclass
from datetime import UTC, datetime

import pytest

from aiws.application.services.project_service import CreateProjectCommand, ProjectService
from aiws.application.services.session_service import (
    AppendMessageCommand,
    CreateSessionCommand,
    SessionService,
)
from aiws.domain.enums import MessageRole
from aiws.infrastructure.storage.repositories import (
    FileMessageRepository,
    FileProjectRepository,
    FileSessionRepository,
)
from aiws.infrastructure.storage.workspace_layout import WorkspaceLayout

NOW = datetime(2026, 5, 19, tzinfo=UTC)


@dataclass
class FixedClock:
    def now(self) -> datetime:
        return NOW


class CountingIds:
    def __init__(self) -> None:
        self.count = 0

    def new_id(self, prefix: str) -> str:
        self.count += 1
        return f"{prefix}_{self.count}"


def make_services(tmp_path):
    layout = WorkspaceLayout(tmp_path)
    project_repo = FileProjectRepository(layout)
    session_repo = FileSessionRepository(layout)
    message_repo = FileMessageRepository(layout)
    clock = FixedClock()
    ids = CountingIds()
    return (
        ProjectService(project_repo, clock, ids),
        SessionService(project_repo, session_repo, message_repo, clock, ids),
    )


def test_create_project_and_subproject(tmp_path) -> None:
    project_service, _ = make_services(tmp_path)

    project = project_service.create_project(
        CreateProjectCommand(path="research", title="Research")
    )
    subproject = project_service.create_subproject(
        CreateProjectCommand(path="research/brief", title="Brief")
    )

    assert project.path == "research"
    assert subproject.parent_path == "research"
    assert [project.path for project in project_service.list_projects()] == [
        "research",
        "research/brief",
    ]


def test_create_project_rejects_nested_path_on_root_method(tmp_path) -> None:
    project_service, _ = make_services(tmp_path)

    with pytest.raises(ValueError):
        project_service.create_project(CreateProjectCommand(path="research/brief", title="Brief"))


def test_create_session_and_append_message(tmp_path) -> None:
    project_service, session_service = make_services(tmp_path)
    project_service.create_project(CreateProjectCommand(path="research", title="Research"))
    session = session_service.create_session(
        CreateSessionCommand(project_path="research", slug="planning", title="Planning")
    )

    message = session_service.append_message(
        AppendMessageCommand(
            project_path="research",
            session_slug="planning",
            session_id=session.id,
            role=MessageRole.USER,
            content="Start from the domain model.",
        )
    )

    assert message.role == MessageRole.USER
    assert session_service.read_messages("research", "planning") == (message,)
