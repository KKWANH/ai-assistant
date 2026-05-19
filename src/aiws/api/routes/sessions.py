from fastapi import APIRouter, Request

from aiws.api.dependencies import AppContainer
from aiws.api.dto import CreateSessionRequest, SessionListResponse, SessionResponse
from aiws.application.services.session_service import CreateSessionCommand

router = APIRouter(prefix="/api/projects/{project_path:path}/sessions", tags=["sessions"])


@router.get("", response_model=SessionListResponse)
def list_sessions(project_path: str, request: Request) -> SessionListResponse:
    container: AppContainer = request.app.state.container
    return SessionListResponse(sessions=container.session_service.list_sessions(project_path))


@router.post("", response_model=SessionResponse)
def create_session(
    project_path: str,
    payload: CreateSessionRequest,
    request: Request,
) -> SessionResponse:
    container: AppContainer = request.app.state.container
    session = container.session_service.create_session(
        CreateSessionCommand(
            project_path=project_path,
            slug=payload.slug,
            title=payload.title,
            kind=payload.kind,
        )
    )
    return SessionResponse(session=session)
