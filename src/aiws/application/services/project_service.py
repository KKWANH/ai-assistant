from dataclasses import dataclass

from aiws.application.ports.clock import Clock
from aiws.application.ports.id_generator import IdGenerator
from aiws.application.ports.repositories import ProjectRepository
from aiws.domain.enums import ProjectKind, Visibility
from aiws.domain.ids import validate_project_path
from aiws.domain.models import Project, ProjectGoal
from aiws.domain.security import SecurityPolicy


@dataclass(frozen=True)
class CreateProjectCommand:
    path: str
    title: str
    description: str = ""
    visibility: Visibility = Visibility.PRIVATE
    kind: ProjectKind = ProjectKind.GENERAL
    security_policy: SecurityPolicy = SecurityPolicy()


class ProjectService:
    def __init__(
        self,
        projects: ProjectRepository,
        clock: Clock,
        ids: IdGenerator,
    ) -> None:
        self.projects = projects
        self.clock = clock
        self.ids = ids

    def create_project(self, command: CreateProjectCommand) -> Project:
        path = validate_project_path(command.path)
        if "/" in path:
            raise ValueError("Use create_subproject for nested project paths")

        now = self.clock.now()
        project = Project(
            id=self.ids.new_id("project"),
            path=path,
            slug=path,
            title=command.title,
            description=command.description,
            visibility=command.visibility,
            kind=command.kind,
            created_at=now,
            updated_at=now,
            security_policy=command.security_policy,
            goal=ProjectGoal(updated_at=now),
        )
        self.projects.save(project)
        return project

    def create_subproject(self, command: CreateProjectCommand) -> Project:
        path = validate_project_path(command.path)
        if "/" not in path:
            raise ValueError("Subproject path must be parent/subproject")

        parent_path, slug = path.split("/", 1)
        self.projects.get(parent_path)
        now = self.clock.now()
        project = Project(
            id=self.ids.new_id("project"),
            path=path,
            slug=slug,
            title=command.title,
            description=command.description,
            parent_path=parent_path,
            visibility=command.visibility,
            kind=command.kind,
            created_at=now,
            updated_at=now,
            security_policy=command.security_policy,
            goal=ProjectGoal(updated_at=now),
        )
        self.projects.save(project)
        return project

    def list_projects(self) -> tuple[Project, ...]:
        return self.projects.list()

    def get_project(self, project_path: str) -> Project:
        return self.projects.get(project_path)

    def set_goal(self, project_path: str, goal: ProjectGoal) -> Project:
        project = self.projects.get(project_path)
        updated = project.model_copy(
            update={"goal": goal.model_copy(update={"updated_at": self.clock.now()})}
        )
        self.projects.save(updated)
        return updated
