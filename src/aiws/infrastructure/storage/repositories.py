from pathlib import Path

from pydantic import TypeAdapter

from aiws.domain.models import Message, Project, Session, User, Workspace
from aiws.domain.runs import Run
from aiws.infrastructure.storage.file_store import JsonFileStore
from aiws.infrastructure.storage.workspace_layout import WorkspaceLayout


class FileWorkspaceRepository:
    def __init__(self, layout: WorkspaceLayout, store: JsonFileStore | None = None) -> None:
        self.layout = layout
        self.store = store or JsonFileStore()

    def save(self, workspace: Workspace) -> None:
        self.store.write_json(self.layout.workspace_json, workspace.model_dump(mode="json"))

    def get(self) -> Workspace:
        return Workspace.model_validate(self.store.read_json(self.layout.workspace_json))


class FileUserRepository:
    def __init__(self, layout: WorkspaceLayout, store: JsonFileStore | None = None) -> None:
        self.layout = layout
        self.store = store or JsonFileStore()
        self._adapter = TypeAdapter(tuple[User, ...])

    def save_many(self, users: tuple[User, ...]) -> None:
        data = {"users": [user.model_dump(mode="json") for user in users]}
        self.store.write_json(self.layout.users_json, data)

    def list(self) -> tuple[User, ...]:
        data = self.store.read_json(self.layout.users_json)
        return self._adapter.validate_python(data.get("users", []))


class FileProjectRepository:
    def __init__(self, layout: WorkspaceLayout, store: JsonFileStore | None = None) -> None:
        self.layout = layout
        self.store = store or JsonFileStore()

    def save(self, project: Project) -> None:
        project_dir = self.layout.project_dir(project.path)
        (project_dir / "files").mkdir(parents=True, exist_ok=True)
        (project_dir / "sessions").mkdir(parents=True, exist_ok=True)
        (project_dir / "runs").mkdir(parents=True, exist_ok=True)
        (project_dir / "artifacts").mkdir(parents=True, exist_ok=True)
        (project_dir / "indexes").mkdir(parents=True, exist_ok=True)
        self.store.write_json(
            self.layout.project_json(project.path),
            project.model_dump(mode="json"),
        )
        self.store.write_json(
            self.layout.goal_json(project.path),
            project.goal.model_dump(mode="json"),
        )

    def get(self, project_path: str) -> Project:
        return Project.model_validate(self.store.read_json(self.layout.project_json(project_path)))

    def list(self) -> tuple[Project, ...]:
        projects: list[Project] = []
        if not self.layout.projects_dir.exists():
            return ()
        for project_json in sorted(self.layout.projects_dir.glob("*/project.json")):
            projects.append(Project.model_validate(self.store.read_json(project_json)))
        for project_json in sorted(self.layout.projects_dir.glob("*/*/project.json")):
            projects.append(Project.model_validate(self.store.read_json(project_json)))
        return tuple(projects)


class FileSessionRepository:
    def __init__(self, layout: WorkspaceLayout, store: JsonFileStore | None = None) -> None:
        self.layout = layout
        self.store = store or JsonFileStore()

    def save(self, session: Session) -> None:
        self.store.write_json(
            self.layout.session_json(session.project_path, session.slug),
            session.model_dump(mode="json"),
        )

    def get(self, project_path: str, session_slug: str) -> Session:
        return Session.model_validate(
            self.store.read_json(self.layout.session_json(project_path, session_slug))
        )

    def list_for_project(self, project_path: str) -> tuple[Session, ...]:
        session_root = self.layout.project_dir(project_path) / "sessions"
        if not session_root.exists():
            return ()
        return tuple(
            Session.model_validate(self.store.read_json(path))
            for path in sorted(session_root.glob("*/session.json"))
        )


class FileMessageRepository:
    def __init__(self, layout: WorkspaceLayout, store: JsonFileStore | None = None) -> None:
        self.layout = layout
        self.store = store or JsonFileStore()

    def append(self, project_path: str, session_slug: str, message: Message) -> None:
        self.store.append_jsonl(
            self.layout.messages_jsonl(project_path, session_slug),
            message.model_dump(mode="json"),
        )

    def list_for_session(self, project_path: str, session_slug: str) -> tuple[Message, ...]:
        return tuple(
            Message.model_validate(record)
            for record in self.store.read_jsonl(
                self.layout.messages_jsonl(project_path, session_slug)
            )
        )


class FileRunRepository:
    def __init__(self, layout: WorkspaceLayout, store: JsonFileStore | None = None) -> None:
        self.layout = layout
        self.store = store or JsonFileStore()

    def save(self, run: Run) -> None:
        self.store.write_json(
            self.layout.run_json(run.project_path, run.id),
            run.model_dump(mode="json"),
        )

    def get(self, project_path: str, run_id: str) -> Run:
        return Run.model_validate(self.store.read_json(self.layout.run_json(project_path, run_id)))


def default_repositories(root: Path) -> tuple[
    FileWorkspaceRepository,
    FileUserRepository,
    FileProjectRepository,
    FileSessionRepository,
    FileMessageRepository,
    FileRunRepository,
]:
    layout = WorkspaceLayout(root)
    store = JsonFileStore()
    return (
        FileWorkspaceRepository(layout, store),
        FileUserRepository(layout, store),
        FileProjectRepository(layout, store),
        FileSessionRepository(layout, store),
        FileMessageRepository(layout, store),
        FileRunRepository(layout, store),
    )
