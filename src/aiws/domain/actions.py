from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from aiws.domain.enums import ActionKind, Capability
from aiws.domain.ids import ActionId, ProjectPath, StableId


class ApprovalPolicy(BaseModel):
    model_config = ConfigDict(frozen=True)

    required: bool = False
    reason: str | None = None
    expires_after_seconds: int | None = Field(default=None, ge=1)


class RunPolicy(BaseModel):
    model_config = ConfigDict(frozen=True)

    timeout_seconds: int | None = Field(default=None, ge=1)
    cwd: str | None = None
    network: bool = False


class ActionDefinition(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: ActionId
    kind: ActionKind
    label: str
    description: str = ""
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    required_capabilities: tuple[Capability, ...] = ()
    approval_policy: ApprovalPolicy = Field(default_factory=ApprovalPolicy)
    run_policy: RunPolicy = Field(default_factory=RunPolicy)
    command: str | None = None
    script: str | None = None
    prompt: str | None = None
    expected_inputs: tuple[str, ...] = ()
    expected_outputs: tuple[str, ...] = ()
    workflow_app_id: StableId | None = None

    @model_validator(mode="after")
    def risky_actions_require_approval(self) -> "ActionDefinition":
        if self.kind == ActionKind.SHELL:
            if Capability.RUN_SHELL not in self.required_capabilities:
                raise ValueError("Shell actions require run_shell capability")
            if not self.approval_policy.required:
                raise ValueError("Shell actions require approval")
            if not self.command:
                raise ValueError("Shell actions require command")
        if self.kind == ActionKind.PYTHON:
            if Capability.RUN_PYTHON not in self.required_capabilities:
                raise ValueError("Python actions require run_python capability")
            if not self.approval_policy.required:
                raise ValueError("Python actions require approval")
            if not self.script:
                raise ValueError("Python actions require script")
        if self.kind in {ActionKind.PROMPT_RECIPE, ActionKind.CODEX_PROMPT} and not self.prompt:
            raise ValueError(f"{self.kind.value} actions require prompt")
        return self


class ActionPreview(BaseModel):
    model_config = ConfigDict(frozen=True)

    action_id: ActionId
    project_path: ProjectPath
    kind: ActionKind
    label: str
    description: str = ""
    cwd: str | None = None
    expected_inputs: tuple[str, ...] = ()
    expected_outputs: tuple[str, ...] = ()
    required_capabilities: tuple[Capability, ...] = ()
    approval_required: bool = False
    risk_level: Literal["low", "medium", "high"] = "low"
    warnings: tuple[str, ...] = ()
