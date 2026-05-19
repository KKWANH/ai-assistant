from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from aiws.domain.enums import ArtifactKind
from aiws.domain.ids import ArtifactId, ProjectPath, RunId, SessionId


class Artifact(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: ArtifactId
    project_path: ProjectPath
    run_id: RunId | None = None
    session_id: SessionId | None = None
    name: str
    relative_path: str
    kind: ArtifactKind
    mime_type: str | None = None
    size: int = Field(ge=0)
    created_at: datetime
    summary: str | None = None
    viewer_type: str | None = None
    available_actions: tuple[str, ...] = ()
    checksum: str | None = None
