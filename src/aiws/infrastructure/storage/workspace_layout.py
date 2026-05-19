from dataclasses import dataclass
from pathlib import Path

from aiws.domain.ids import validate_project_path, validate_slug


@dataclass(frozen=True)
class WorkspaceLayout:
    root: Path

    @property
    def workspace_json(self) -> Path:
        return self.root / "workspace.json"

    @property
    def users_json(self) -> Path:
        return self.root / "users.json"

    @property
    def settings_json(self) -> Path:
        return self.root / "settings.json"

    @property
    def projects_dir(self) -> Path:
        return self.root / "projects"

    @property
    def usage_dir(self) -> Path:
        return self.root / "usage"

    @property
    def audit_dir(self) -> Path:
        return self.root / "audit"

    def project_dir(self, project_path: str) -> Path:
        validate_project_path(project_path)
        return self.projects_dir.joinpath(*project_path.split("/"))

    def project_json(self, project_path: str) -> Path:
        return self.project_dir(project_path) / "project.json"

    def goal_json(self, project_path: str) -> Path:
        return self.project_dir(project_path) / "goal.json"

    def manifest_yaml(self, project_path: str) -> Path:
        return self.project_dir(project_path) / "aiws.yaml"

    def session_dir(self, project_path: str, session_slug: str) -> Path:
        validate_slug(session_slug)
        return self.project_dir(project_path) / "sessions" / session_slug

    def session_json(self, project_path: str, session_slug: str) -> Path:
        return self.session_dir(project_path, session_slug) / "session.json"

    def messages_jsonl(self, project_path: str, session_slug: str) -> Path:
        return self.session_dir(project_path, session_slug) / "messages.jsonl"

    def run_dir(self, project_path: str, run_id: str) -> Path:
        return self.project_dir(project_path) / "runs" / run_id

    def run_json(self, project_path: str, run_id: str) -> Path:
        return self.run_dir(project_path, run_id) / "run.json"
