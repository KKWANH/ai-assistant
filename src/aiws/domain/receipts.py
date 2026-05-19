from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from aiws.domain.enums import ContextSourceKind, NetworkMode, ProviderKind
from aiws.domain.ids import ModelId, ProjectPath, ProviderId, ReceiptId, SessionId, StableId


class ContextPolicy(BaseModel):
    model_config = ConfigDict(frozen=True)

    include_patterns: tuple[str, ...] = ()
    exclude_patterns: tuple[str, ...] = ()
    text_budget: int = Field(default=20_000, ge=0)
    chunk_budget: int = Field(default=64, ge=0)
    include_project_files: bool = True
    include_session_files: bool = True
    include_artifacts: bool = False
    allow_computed_profiles: bool = True
    allow_raw_text: bool = True


class ContextItem(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: StableId
    source_kind: ContextSourceKind
    label: str
    relative_path: str | None = None
    mime_type: str | None = None
    size: int = Field(default=0, ge=0)
    text_mode: str = "metadata"
    raw_text_included: bool = False
    computed_profile_included: bool = False
    chunk_count: int = Field(default=0, ge=0)
    token_estimate: int = Field(default=0, ge=0)
    redacted: bool = False
    excluded_reason: str | None = None


class ContextPack(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: StableId
    project_path: ProjectPath
    session_id: SessionId | None = None
    created_at: datetime
    policy: ContextPolicy
    items: tuple[ContextItem, ...] = ()
    prompt_text: str = ""
    token_estimate: int = Field(default=0, ge=0)
    warnings: tuple[str, ...] = ()


class ContextReceipt(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: ReceiptId
    created_at: datetime
    project_path: ProjectPath
    session_id: SessionId | None = None
    provider_id: ProviderId
    model_id: ModelId
    provider_kind: ProviderKind
    network_mode: NetworkMode
    local: bool
    cloud: bool
    estimated_cost_usd: float | None = Field(default=None, ge=0)
    actual_cost_usd: float | None = Field(default=None, ge=0)
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    files_used: tuple[str, ...] = ()
    chunks_used: int = Field(default=0, ge=0)
    excluded_files: tuple[str, ...] = ()
    raw_text_sent: bool = False
    computed_profiles_sent: bool = False
    artifacts_used: tuple[str, ...] = ()
    web_access: bool = False
    warnings: tuple[str, ...] = ()

    @model_validator(mode="after")
    def network_flags_match_provider(self) -> "ContextReceipt":
        if self.provider_kind == ProviderKind.LOCAL and self.cloud:
            raise ValueError("Local provider receipts cannot be marked cloud=true")
        if self.provider_kind == ProviderKind.CLOUD and self.local:
            raise ValueError("Cloud provider receipts cannot be marked local=true")
        if self.cloud and self.network_mode not in {
            NetworkMode.CLOUD_ALLOWED,
            NetworkMode.APPROVED_NETWORK,
        }:
            raise ValueError(
                "Cloud receipts require approved network or cloud_allowed network mode"
            )
        return self
