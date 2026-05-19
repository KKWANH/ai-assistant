import re
from typing import Annotated, NewType

from pydantic import AfterValidator

WorkspaceId = NewType("WorkspaceId", str)
UserId = NewType("UserId", str)
ProjectId = NewType("ProjectId", str)
SessionId = NewType("SessionId", str)
MessageId = NewType("MessageId", str)
ActionId = NewType("ActionId", str)
RunId = NewType("RunId", str)
ArtifactId = NewType("ArtifactId", str)
ProviderId = NewType("ProviderId", str)
ModelId = NewType("ModelId", str)
ReceiptId = NewType("ReceiptId", str)

MAX_PROJECT_DEPTH = 2
SLUG_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")


def validate_slug(value: str) -> str:
    if not SLUG_PATTERN.fullmatch(value):
        msg = "Slug must be lowercase kebab-case, 1-63 chars, and start with a letter/number"
        raise ValueError(msg)
    if "--" in value:
        raise ValueError("Slug must not contain consecutive hyphens")
    return value


Slug = Annotated[str, AfterValidator(validate_slug)]


def validate_id(value: str) -> str:
    if not ID_PATTERN.fullmatch(value):
        raise ValueError("ID must be 1-128 URL-safe-ish characters")
    return value


StableId = Annotated[str, AfterValidator(validate_id)]


def validate_project_path(value: str) -> str:
    normalized = value.strip("/")
    if normalized != value:
        raise ValueError("Project path must not start or end with '/'")
    if not normalized:
        raise ValueError("Project path must not be empty")
    if "\\" in normalized or "//" in normalized:
        raise ValueError("Project path must use single forward slashes")

    parts = normalized.split("/")
    if len(parts) > MAX_PROJECT_DEPTH:
        raise ValueError("Project path supports only project or project/subproject")
    for part in parts:
        validate_slug(part)
    return normalized


ProjectPath = Annotated[str, AfterValidator(validate_project_path)]
