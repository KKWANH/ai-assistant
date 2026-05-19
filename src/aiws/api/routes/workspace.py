from datetime import UTC, datetime

from fastapi import APIRouter, Request

from aiws.api.dependencies import AppContainer
from aiws.api.dto import WorkspaceInitRequest, WorkspaceResponse
from aiws.domain.models import Workspace

router = APIRouter(prefix="/api/workspace", tags=["workspace"])


@router.get("", response_model=WorkspaceResponse)
def get_workspace(request: Request) -> WorkspaceResponse:
    container: AppContainer = request.app.state.container
    try:
        workspace = container.workspace_repository.get()
    except FileNotFoundError:
        workspace = None
    return WorkspaceResponse(
        workspace=workspace,
        initialized=workspace is not None,
        workspace_root=str(container.workspace_root),
    )


@router.post("/init", response_model=WorkspaceResponse)
def init_workspace(payload: WorkspaceInitRequest, request: Request) -> WorkspaceResponse:
    container: AppContainer = request.app.state.container
    container.workspace_root.mkdir(parents=True, exist_ok=True)
    workspace = Workspace(
        id=payload.id,
        root_path=container.workspace_root,
        mode=payload.mode,
        created_at=datetime.now(UTC),
    )
    container.workspace_repository.save(workspace)
    return WorkspaceResponse(
        workspace=workspace,
        initialized=True,
        workspace_root=str(container.workspace_root),
    )
