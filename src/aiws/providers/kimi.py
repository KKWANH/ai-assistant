"""Kimi provider using Moonshot's OpenAI-compatible API."""

from __future__ import annotations

import json
import os
from urllib import error, request

from aiws import storage
from aiws.env import load_env

DEFAULT_KIMI_URL = "https://api.moonshot.ai/v1/chat/completions"


class KimiProvider:
    name = "kimi"

    def __init__(self, endpoint: str = DEFAULT_KIMI_URL, api_key: str | None = None) -> None:
        load_env()
        self.endpoint = endpoint
        self.api_key = api_key or os.environ.get("AIWS_KIMI_API_KEY") or os.environ.get("MOONSHOT_API_KEY")

    def chat(self, *, model: str, system: str, content: str) -> str:
        if not self.api_key:
            raise storage.WorkspaceError("Kimi requires AIWS_KIMI_API_KEY or MOONSHOT_API_KEY.")
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": content},
            ],
        }
        req = request.Request(
            self.endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=120) as response:
                response_data = json.loads(response.read().decode("utf-8"))
        except error.URLError as exc:
            raise storage.WorkspaceError(f"Could not reach Kimi at {self.endpoint}: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise storage.WorkspaceError("Kimi returned invalid JSON.") from exc

        choices = response_data.get("choices", [])
        if not choices:
            raise storage.WorkspaceError("Kimi response did not include choices.")
        content_value = choices[0].get("message", {}).get("content")
        if not isinstance(content_value, str):
            raise storage.WorkspaceError("Kimi response did not include message.content.")
        return content_value
