from dataclasses import dataclass

from aiws.application.ports.clock import Clock
from aiws.application.ports.id_generator import IdGenerator
from aiws.application.ports.repositories import (
    MessageRepository,
    ProjectRepository,
    SessionRepository,
)
from aiws.domain.enums import MessageRole, SessionKind
from aiws.domain.ids import validate_slug
from aiws.domain.models import Message, Session


@dataclass(frozen=True)
class CreateSessionCommand:
    project_path: str
    slug: str
    title: str
    kind: SessionKind = SessionKind.PROJECT_CHAT


@dataclass(frozen=True)
class AppendMessageCommand:
    project_path: str
    session_slug: str
    session_id: str
    role: MessageRole
    content: str


class SessionService:
    def __init__(
        self,
        projects: ProjectRepository,
        sessions: SessionRepository,
        messages: MessageRepository,
        clock: Clock,
        ids: IdGenerator,
    ) -> None:
        self.projects = projects
        self.sessions = sessions
        self.messages = messages
        self.clock = clock
        self.ids = ids

    def create_session(self, command: CreateSessionCommand) -> Session:
        self.projects.get(command.project_path)
        slug = validate_slug(command.slug)
        now = self.clock.now()
        session = Session(
            id=self.ids.new_id("session"),
            slug=slug,
            project_path=command.project_path,
            title=command.title,
            kind=command.kind,
            created_at=now,
            updated_at=now,
        )
        self.sessions.save(session)
        return session

    def list_sessions(self, project_path: str) -> tuple[Session, ...]:
        self.projects.get(project_path)
        return self.sessions.list_for_project(project_path)

    def append_message(self, command: AppendMessageCommand) -> Message:
        self.sessions.get(command.project_path, command.session_slug)
        message = Message(
            id=self.ids.new_id("message"),
            session_id=command.session_id,
            role=command.role,
            content=command.content,
            created_at=self.clock.now(),
        )
        self.messages.append(command.project_path, command.session_slug, message)
        return message

    def read_messages(self, project_path: str, session_slug: str) -> tuple[Message, ...]:
        self.sessions.get(project_path, session_slug)
        return self.messages.list_for_session(project_path, session_slug)
