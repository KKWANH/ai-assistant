from fastapi import APIRouter, Request

from aiws.api.dependencies import AppContainer
from aiws.api.dto import CreateProjectRequest, ProjectListResponse, ProjectResponse
from aiws.application.services.project_service import CreateProjectCommand

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=ProjectListResponse)
def list_projects(request: Request) -> ProjectListResponse:
    container: AppContainer = request.app.state.container
    return ProjectListResponse(projects=container.project_service.list_projects())


@router.post("", response_model=ProjectResponse)
def create_project(payload: CreateProjectRequest, request: Request) -> ProjectResponse:
    container: AppContainer = request.app.state.container
    command = CreateProjectCommand(
        path=payload.path,
        title=payload.title,
        description=payload.description,
        visibility=payload.visibility,
        kind=payload.kind,
    )
    if "/" in payload.path:
        project = container.project_service.create_subproject(command)
    else:
        project = container.project_service.create_project(command)
    return ProjectResponse(project=project)


@router.get("/{project_path:path}", response_model=ProjectResponse)
def get_project(project_path: str, request: Request) -> ProjectResponse:
    container: AppContainer = request.app.state.container
    return ProjectResponse(project=container.project_service.get_project(project_path))
