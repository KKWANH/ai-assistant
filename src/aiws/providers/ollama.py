"""Ollama chat provider."""

from __future__ import annotations

import json
import os
from urllib import error, request
from urllib.parse import urlparse, urlunparse

from aiws import storage
from aiws.env import load_env

DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434/api/chat"


class OllamaProvider:
    name = "ollama"

    def __init__(self, endpoint: str | None = None) -> None:
        load_env()
        base_url = os.environ.get("AIWS_OLLAMA_BASE_URL", "").rstrip("/")
        self.endpoint = endpoint or (f"{base_url}/api/chat" if base_url else DEFAULT_OLLAMA_URL)

    def chat(
        self,
        *,
        model: str,
        system: str,
        content: str,
        attachments: list[dict[str, str]] | None = None,
    ) -> str:
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
            fallback = localhost_ipv4_fallback(self.endpoint)
            if fallback and fallback != self.endpoint:
                try:
                    fallback_req = request.Request(
                        fallback,
                        data=data,
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    with request.urlopen(fallback_req, timeout=120) as response:
                        response_data = json.loads(response.read().decode("utf-8"))
                except error.URLError as fallback_exc:
                    raise storage.WorkspaceError(
                        f"Could not reach Ollama at {self.endpoint} or {fallback}: {fallback_exc}"
                    ) from fallback_exc
                except json.JSONDecodeError as json_exc:
                    raise storage.WorkspaceError("Ollama returned invalid JSON.") from json_exc
            else:
                raise storage.WorkspaceError(f"Could not reach Ollama at {self.endpoint}: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise storage.WorkspaceError("Ollama returned invalid JSON.") from exc

        message = response_data.get("message", {})
        content_value = message.get("content")
        if not isinstance(content_value, str):
            raise storage.WorkspaceError("Ollama response did not include message.content.")
        return content_value


def localhost_ipv4_fallback(endpoint: str) -> str | None:
    parsed = urlparse(endpoint)
    if parsed.hostname != "localhost":
        return None
    netloc = "127.0.0.1"
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"
    return urlunparse(parsed._replace(netloc=netloc))
