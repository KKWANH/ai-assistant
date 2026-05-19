from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from aiws.domain.enums import ActionKind, ApprovalStatus, RunStatus
from aiws.domain.ids import (
    ActionId,
    ArtifactId,
    ProjectPath,
    ReceiptId,
    RunId,
    SessionId,
    StableId,
    UserId,
)


class RunLog(BaseModel):
    model_config = ConfigDict(frozen=True)

    timestamp: datetime
    level: str
    event_type: str
    message: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class RunStep(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: StableId
    kind: str
    title: str
    status: RunStatus
    started_at: datetime | None = None
    finished_at: datetime | None = None
    input_summary: str | None = None
    output_summary: str | None = None
    logs: tuple[RunLog, ...] = ()
    artifacts: tuple[ArtifactId, ...] = ()
    requires_approval: bool = False


class Run(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: RunId
    project_path: ProjectPath
    session_id: SessionId | None = None
    action_id: ActionId
    kind: ActionKind
    label: str
    actor_id: UserId | None = None
    status: RunStatus = RunStatus.DRAFT
    approval: ApprovalStatus = ApprovalStatus.NOT_REQUIRED
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    input_snapshot: dict[str, Any] = Field(default_factory=dict)
    output_snapshot: dict[str, Any] = Field(default_factory=dict)
    execution_plan: tuple[str, ...] = ()
    steps: tuple[RunStep, ...] = ()
    logs: tuple[RunLog, ...] = ()
    stdout_tail: str | None = None
    stderr_tail: str | None = None
    artifacts: tuple[ArtifactId, ...] = ()
    context_receipt_id: ReceiptId | None = None
    estimated_cost: float | None = Field(default=None, ge=0)
    actual_cost: float | None = Field(default=None, ge=0)
    error: str | None = None
