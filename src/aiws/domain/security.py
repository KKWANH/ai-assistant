from pydantic import BaseModel, ConfigDict, Field

DEFAULT_SECRET_PATTERNS: tuple[str, ...] = (
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "id_rsa",
    "id_ed25519",
    ".ssh/*",
    "secrets/*",
    "credentials/*",
    "wallets/*",
    "private/*",
    ".git/*",
)


class SecurityPolicy(BaseModel):
    model_config = ConfigDict(frozen=True)

    local_only: bool = True
    allow_cloud: bool = False
    allow_network: bool = False
    allow_shell: bool = False
    allow_python: bool = False
    allowed_paths: tuple[str, ...] = ()
    denied_paths: tuple[str, ...] = ()
    secret_patterns: tuple[str, ...] = Field(default_factory=lambda: DEFAULT_SECRET_PATTERNS)
    public_safe: bool = False
