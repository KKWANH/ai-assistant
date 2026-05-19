from fastapi import APIRouter, Request

from aiws.api.dependencies import AppContainer
from aiws.api.dto import HealthResponse

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    container: AppContainer = request.app.state.container
    return HealthResponse(ok=True, workspace_root=str(container.workspace_root))
