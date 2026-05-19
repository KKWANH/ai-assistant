from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from aiws.domain.enums import NetworkMode
from aiws.domain.ids import ModelId, ProjectPath, ProviderId, RunId, SessionId, StableId, UserId


class UsageRecord(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: StableId
    timestamp: datetime
    user_id: UserId | None = None
    project_path: ProjectPath | None = None
    session_id: SessionId | None = None
    run_id: RunId | None = None
    provider_id: ProviderId
    model_id: ModelId
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    estimated_cost_usd: float | None = Field(default=None, ge=0)
    actual_cost_usd: float | None = Field(default=None, ge=0)
    local: bool = True
    network_mode: NetworkMode = NetworkMode.NONE
