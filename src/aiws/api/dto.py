from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from aiws.domain.enums import MessageRole, ProjectKind, SessionKind, Visibility, WorkspaceMode
from aiws.domain.models import Message, Project, Session, Workspace


class HealthResponse(BaseModel):
    ok: bool
    service: str = "aiws"
    workspace_root: str


class WorkspaceInitRequest(BaseModel):
    id: str = "workspace_local"
    mode: WorkspaceMode = WorkspaceMode.LOCAL


class WorkspaceResponse(BaseModel):
    workspace: Workspace | None
    initialized: bool
    workspace_root: str


class CreateProjectRequest(BaseModel):
    path: str
    title: str
    description: str = ""
    visibility: Visibility = Visibility.PRIVATE
    kind: ProjectKind = ProjectKind.GENERAL


class ProjectResponse(BaseModel):
    project: Project


class ProjectListResponse(BaseModel):
    projects: tuple[Project, ...]


class CreateSessionRequest(BaseModel):
    slug: str
    title: str
    kind: SessionKind = SessionKind.PROJECT_CHAT


class SessionResponse(BaseModel):
    session: Session


class SessionListResponse(BaseModel):
    sessions: tuple[Session, ...]


class AppendMessageRequest(BaseModel):
    session_id: str
    role: MessageRole = MessageRole.USER
    content: str = Field(min_length=1)


class MessageResponse(BaseModel):
    message: Message


class MessageListResponse(BaseModel):
    messages: tuple[Message, ...]


class AdminStatusResponse(BaseModel):
    pid: int
    workspace_root: str
    project_count: int
    session_count: int
    log_files: tuple[str, ...]
    generated_at: datetime


class AdminLogResponse(BaseModel):
    path: str
    lines: tuple[str, ...]


class AdminAnalysisResponse(BaseModel):
    generated_at: datetime
    error_count: int
    warning_count: int
    findings: tuple[str, ...]
    metadata: dict[str, Any] = Field(default_factory=dict)
