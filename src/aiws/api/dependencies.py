import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from aiws.application.services.project_service import ProjectService
from aiws.application.services.session_service import SessionService
from aiws.infrastructure.storage.repositories import (
    FileMessageRepository,
    FileProjectRepository,
    FileSessionRepository,
    FileUserRepository,
    FileWorkspaceRepository,
)
from aiws.infrastructure.storage.workspace_layout import WorkspaceLayout


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class UuidGenerator:
    def new_id(self, prefix: str) -> str:
        return f"{prefix}_{uuid4().hex}"


@dataclass(frozen=True)
class AppContainer:
    workspace_root: Path
    layout: WorkspaceLayout
    workspace_repository: FileWorkspaceRepository
    user_repository: FileUserRepository
    project_repository: FileProjectRepository
    session_repository: FileSessionRepository
    message_repository: FileMessageRepository
    project_service: ProjectService
    session_service: SessionService


def default_workspace_root() -> Path:
    configured = os.environ.get("AIWS_WORKSPACE_ROOT")
    if configured:
        return Path(configured).expanduser().resolve()
    return (Path.cwd() / ".aiws" / "workspace").resolve()


def create_container(workspace_root: Path | None = None) -> AppContainer:
    root = (workspace_root or default_workspace_root()).resolve()
    layout = WorkspaceLayout(root)
    workspace_repository = FileWorkspaceRepository(layout)
    user_repository = FileUserRepository(layout)
    project_repository = FileProjectRepository(layout)
    session_repository = FileSessionRepository(layout)
    message_repository = FileMessageRepository(layout)
    clock = SystemClock()
    ids = UuidGenerator()
    project_service = ProjectService(project_repository, clock, ids)
    session_service = SessionService(
        project_repository,
        session_repository,
        message_repository,
        clock,
        ids,
    )
    return AppContainer(
        workspace_root=root,
        layout=layout,
        workspace_repository=workspace_repository,
        user_repository=user_repository,
        project_repository=project_repository,
        session_repository=session_repository,
        message_repository=message_repository,
        project_service=project_service,
        session_service=session_service,
    )
