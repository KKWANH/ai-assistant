from enum import StrEnum


class WorkspaceMode(StrEnum):
    LOCAL = "local"
    SERVER = "server"
    PUBLIC_DEMO = "public_demo"


class Visibility(StrEnum):
    PRIVATE = "private"
    PUBLIC = "public"


class ProjectKind(StrEnum):
    GENERAL = "general"
    STRUCTURED = "structured"
    WORKFLOW_APP = "workflow_app"


class SessionKind(StrEnum):
    CHAT = "chat"
    PROJECT_CHAT = "project_chat"
    ACTION_THREAD = "action_thread"


class MessageRole(StrEnum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class ActionKind(StrEnum):
    PROMPT_RECIPE = "prompt_recipe"
    SHELL = "shell"
    PYTHON = "python"
    FILE_INDEX = "file_index"
    CODEX_PROMPT = "codex_prompt"
    MODEL_CALL = "model_call"
    WORKFLOW = "workflow"
    OPENCLAW_STATUS = "openclaw_status"


class RunStatus(StrEnum):
    DRAFT = "draft"
    WAITING_APPROVAL = "waiting_approval"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ApprovalStatus(StrEnum):
    NOT_REQUIRED = "not_required"
    REQUIRED = "required"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"


class ProviderKind(StrEnum):
    LOCAL = "local"
    CLOUD = "cloud"
    HYBRID = "hybrid"


class NetworkMode(StrEnum):
    NONE = "none"
    LOCAL_ONLY = "local_only"
    APPROVED_NETWORK = "approved_network"
    CLOUD_ALLOWED = "cloud_allowed"


class ArtifactKind(StrEnum):
    MARKDOWN = "markdown"
    TEXT = "text"
    JSON = "json"
    CSV = "csv"
    IMAGE = "image"
    PDF = "pdf"
    CODE = "code"
    CHART = "chart"
    REPORT = "report"
    BINARY = "binary"


class ContextSourceKind(StrEnum):
    PROJECT_FILE = "project_file"
    SESSION_ATTACHMENT = "session_attachment"
    GENERATED_ARTIFACT = "generated_artifact"
    COMPUTED_PROFILE = "computed_profile"
    MANUAL_TEXT = "manual_text"
    WEB_RESULT = "web_result"
    PREVIOUS_MESSAGE = "previous_message"
    SKILL_FILE = "skill_file"


class Capability(StrEnum):
    READ_FILES = "read_files"
    WRITE_ARTIFACTS = "write_artifacts"
    WRITE_PROJECT_FILES = "write_project_files"
    RUN_SHELL = "run_shell"
    RUN_PYTHON = "run_python"
    ALLOW_NETWORK = "allow_network"
    ALLOW_CLOUD = "allow_cloud"
    ALLOW_EXTERNAL_PATHS = "allow_external_paths"
