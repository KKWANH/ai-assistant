"""Provider protocol for AIWS model calls."""

from __future__ import annotations

from typing import Protocol


class ChatProvider(Protocol):
    name: str

    def chat(self, *, model: str, system: str, content: str) -> str:
        """Return an assistant response for one user turn."""
