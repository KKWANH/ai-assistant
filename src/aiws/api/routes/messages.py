from fastapi import APIRouter, Request

from aiws.api.dependencies import AppContainer
from aiws.api.dto import AppendMessageRequest, MessageListResponse, MessageResponse
from aiws.application.services.session_service import AppendMessageCommand

router = APIRouter(
    prefix="/api/projects/{project_path:path}/sessions/{session_slug}/messages",
    tags=["messages"],
)


@router.get("", response_model=MessageListResponse)
def list_messages(project_path: str, session_slug: str, request: Request) -> MessageListResponse:
    container: AppContainer = request.app.state.container
    return MessageListResponse(
        messages=container.session_service.read_messages(project_path, session_slug)
    )


@router.post("", response_model=MessageResponse)
def append_message(
    project_path: str,
    session_slug: str,
    payload: AppendMessageRequest,
    request: Request,
) -> MessageResponse:
    container: AppContainer = request.app.state.container
    message = container.session_service.append_message(
        AppendMessageCommand(
            project_path=project_path,
            session_slug=session_slug,
            session_id=payload.session_id,
            role=payload.role,
            content=payload.content,
        )
    )
    return MessageResponse(message=message)
