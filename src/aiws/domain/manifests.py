from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from aiws.domain.actions import ActionDefinition


class ManifestContext(BaseModel):
    model_config = ConfigDict(frozen=True)

    include: tuple[str, ...] = ()
    exclude: tuple[str, ...] = ()
    text_budget: int = Field(default=20_000, ge=0)
    chunk_budget: int = Field(default=64, ge=0)


class Manifest(BaseModel):
    model_config = ConfigDict(frozen=True)

    version: str = "1"
    name: str
    description: str = ""
    root: str = "."
    context: ManifestContext = Field(default_factory=ManifestContext)
    actions: tuple[ActionDefinition, ...] = ()
    workflow_apps: tuple[dict[str, Any], ...] = ()
    views: tuple[dict[str, Any], ...] = ()
    permissions: dict[str, Any] = Field(default_factory=dict)
    resource_exports: tuple[dict[str, Any], ...] = ()
    resource_imports: tuple[dict[str, Any], ...] = ()
