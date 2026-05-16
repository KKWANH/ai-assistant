"""Small, shared redaction helpers for logs and run records."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

SECRET_PATTERNS = (
    re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]{12,}", re.IGNORECASE),
    re.compile(r"\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['\"]?[^'\"\s]{8,}", re.IGNORECASE),
    re.compile(r"\b(?:sk|ghp|github_pat|xoxb|AIza)[A-Za-z0-9_\-]{16,}"),
)


def redact_text(value: str) -> str:
    redacted = value
    for pattern in SECRET_PATTERNS:
        redacted = pattern.sub("[REDACTED_SECRET]", redacted)
    home = str(Path.home())
    if home and home != os.sep:
        redacted = redacted.replace(home, "~")
    for key, env_value in os.environ.items():
        if len(env_value) >= 12 and any(token in key.upper() for token in ("KEY", "SECRET", "TOKEN", "PASSWORD")):
            redacted = redacted.replace(env_value, "[REDACTED_ENV]")
    return redacted


def redact_value(value: Any) -> Any:
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, list):
        return [redact_value(item) for item in value]
    if isinstance(value, dict):
        return {key: redact_value(item) for key, item in value.items()}
    return value
