"""Ollama chat provider."""

from __future__ import annotations

import json
from urllib import error, request

from aiws import storage

DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434/api/chat"


class OllamaProvider:
    name = "ollama"

    def __init__(self, endpoint: str = DEFAULT_OLLAMA_URL) -> None:
        self.endpoint = endpoint

    def chat(self, *, model: str, system: str, content: str) -> str:
        payload = {
            "model": model,
            "stream": False,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": content},
            ],
        }
        data = json.dumps(payload).encode("utf-8")
        req = request.Request(
            self.endpoint,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=120) as response:
                response_data = json.loads(response.read().decode("utf-8"))
        except error.URLError as exc:
            raise storage.WorkspaceError(f"Could not reach Ollama at {self.endpoint}: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise storage.WorkspaceError("Ollama returned invalid JSON.") from exc

        message = response_data.get("message", {})
        content_value = message.get("content")
        if not isinstance(content_value, str):
            raise storage.WorkspaceError("Ollama response did not include message.content.")
        return content_value
