from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from aiws.domain.enums import (
    MessageRole,
    ProjectKind,
    ProviderKind,
    SessionKind,
    Visibility,
    WorkspaceMode,
)
from aiws.domain.ids import (
    MessageId,
    ModelId,
    ProjectId,
    ProjectPath,
    ProviderId,
    RunId,
    SessionId,
    Slug,
    UserId,
    WorkspaceId,
)
from aiws.domain.receipts import ContextPolicy
from aiws.domain.security import SecurityPolicy
from aiws.domain.usage import UsageRecord


class WorkspaceSettings(BaseModel):
    model_config = ConfigDict(frozen=True)

    default_language: str = "en"
    default_provider_id: ProviderId | None = None
    default_model_id: ModelId | None = None


class Workspace(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: WorkspaceId
    root_path: Path
    mode: WorkspaceMode = WorkspaceMode.LOCAL
    created_at: datetime
    settings: WorkspaceSettings = Field(default_factory=WorkspaceSettings)
    users_enabled: bool = False
    public_demo: bool = False


class User(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UserId
    username: Slug
    display_name: str
    role: str = "owner"
    language: str = "en"
    avatar: str | None = None
    created_at: datetime


class ProjectGoal(BaseModel):
    model_config = ConfigDict(frozen=True)

    objective: str = ""
    current_status: str = ""
    next_actions: tuple[str, ...] = ()
    constraints: tuple[str, ...] = ()
    success_criteria: tuple[str, ...] = ()
    test_commands: tuple[str, ...] = ()
    updated_at: datetime | None = None


class Project(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: ProjectId
    path: ProjectPath
    slug: Slug
    title: str
    description: str = ""
    parent_path: ProjectPath | None = None
    owner_id: UserId | None = None
    visibility: Visibility = Visibility.PRIVATE
    kind: ProjectKind = ProjectKind.GENERAL
    created_at: datetime
    updated_at: datetime
    security_policy: SecurityPolicy = Field(default_factory=SecurityPolicy)
    selected_skills: tuple[str, ...] = ()
    manifest_status: str = "missing"
    goal: ProjectGoal = Field(default_factory=ProjectGoal)

    @model_validator(mode="after")
    def slug_matches_path_leaf(self) -> "Project":
        if self.slug != self.path.split("/")[-1]:
            raise ValueError("Project slug must match final project path segment")
        if self.parent_path and "/" in self.parent_path:
            raise ValueError("Subprojects cannot have nested parent paths")
        if "/" in self.path and self.parent_path != self.path.rsplit("/", 1)[0]:
            raise ValueError("Subproject parent_path must match parent segment")
        return self


class ModelPolicy(BaseModel):
    model_config = ConfigDict(frozen=True)

    provider_id: ProviderId | None = None
    model_id: ModelId | None = None
    prefer_local: bool = True


class Session(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: SessionId
    slug: Slug
    project_path: ProjectPath
    title: str
    kind: SessionKind = SessionKind.PROJECT_CHAT
    created_at: datetime
    updated_at: datetime
    model_policy: ModelPolicy = Field(default_factory=ModelPolicy)
    active_context_policy: ContextPolicy = Field(default_factory=ContextPolicy)
    summary: str = ""


class Attachment(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    filename: str
    relative_path: str
    mime_type: str | None = None
    size: int = Field(ge=0)
    extracted_text_available: bool = False
    delivery_mode: str = "stored"
    created_at: datetime


class Message(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: MessageId
    session_id: SessionId
    role: MessageRole
    content: str
    created_at: datetime
    actor_id: UserId | None = None
    provider_id: ProviderId | None = None
    model_id: ModelId | None = None
    context_receipt_id: str | None = None
    run_id: RunId | None = None
    attachments: tuple[Attachment, ...] = ()
    metadata: dict[str, Any] = Field(default_factory=dict)


class ModelProvider(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: ProviderId
    label: str
    kind: ProviderKind
    base_url: str | None = None
    requires_api_key: bool = False
    supports_images: bool = False
    supports_files: bool = False
    supports_tools: bool = False
    supports_streaming: bool = True
    enabled: bool = True


class ModelInfo(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: ModelId
    provider_id: ProviderId
    label: str
    context_window: int = Field(ge=0)
    input_price_per_million: float | None = Field(default=None, ge=0)
    output_price_per_million: float | None = Field(default=None, ge=0)
    local: bool = True
    recommended_for: tuple[str, ...] = ()


__all__ = [
    "Attachment",
    "Message",
    "ModelInfo",
    "ModelPolicy",
    "ModelProvider",
    "Project",
    "ProjectGoal",
    "Session",
    "UsageRecord",
    "User",
    "Workspace",
    "WorkspaceSettings",
]
