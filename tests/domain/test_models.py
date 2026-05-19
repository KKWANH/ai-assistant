from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from aiws.domain.actions import ActionDefinition, ApprovalPolicy
from aiws.domain.enums import ActionKind, Capability, NetworkMode, ProviderKind, Visibility
from aiws.domain.models import Project
from aiws.domain.receipts import ContextReceipt

NOW = datetime(2026, 5, 19, tzinfo=UTC)


def test_project_slug_must_match_path_leaf() -> None:
    with pytest.raises(ValidationError):
        Project(
            id="project_1",
            path="research",
            slug="other",
            title="Research",
            visibility=Visibility.PRIVATE,
            created_at=NOW,
            updated_at=NOW,
        )


def test_subproject_parent_path_must_match_parent_segment() -> None:
    project = Project(
        id="project_1",
        path="research/brief",
        slug="brief",
        parent_path="research",
        title="Brief",
        created_at=NOW,
        updated_at=NOW,
    )
    assert project.parent_path == "research"


def test_shell_action_requires_capability_and_approval() -> None:
    with pytest.raises(ValidationError):
        ActionDefinition(
            id="action_shell",
            kind=ActionKind.SHELL,
            label="Run tests",
            command="pytest",
        )

    action = ActionDefinition(
        id="action_shell",
        kind=ActionKind.SHELL,
        label="Run tests",
        command="pytest",
        required_capabilities=(Capability.RUN_SHELL,),
        approval_policy=ApprovalPolicy(required=True),
    )
    assert action.approval_policy.required is True


def test_prompt_recipe_requires_prompt() -> None:
    with pytest.raises(ValidationError):
        ActionDefinition(id="action_prompt", kind=ActionKind.PROMPT_RECIPE, label="Summarize")


def test_cloud_context_receipt_requires_cloud_network_mode() -> None:
    with pytest.raises(ValidationError):
        ContextReceipt(
            id="receipt_1",
            created_at=NOW,
            project_path="research",
            provider_id="openai",
            model_id="gpt-4.1",
            provider_kind=ProviderKind.CLOUD,
            network_mode=NetworkMode.NONE,
            local=False,
            cloud=True,
        )

    receipt = ContextReceipt(
        id="receipt_1",
        created_at=NOW,
        project_path="research",
        provider_id="openai",
        model_id="gpt-4.1",
        provider_kind=ProviderKind.CLOUD,
        network_mode=NetworkMode.CLOUD_ALLOWED,
        local=False,
        cloud=True,
        raw_text_sent=True,
    )
    assert receipt.cloud is True
