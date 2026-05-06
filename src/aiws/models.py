"""Small shared data helpers for AIWS."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Message:
    role: str
    content: str
    created_at: str
    provider: str | None = None
    model: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
