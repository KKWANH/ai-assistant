"""Baidu Qianfan / ERNIE chat provider."""

from __future__ import annotations

import json
import os
import socket
from urllib import error, request

from aiws import storage
from aiws.env import load_env

DEFAULT_QIANFAN_BASE_URL = "https://qianfan.baidubce.com/v2"


class ErnieProvider:
    name = "ernie"

    def __init__(self, base_url: str = DEFAULT_QIANFAN_BASE_URL, api_key: str | None = None, timeout: int = 120) -> None:
        load_env()
        configured = os.environ.get("AIWS_ERNIE_BASE_URL") or os.environ.get("AIWS_QIANFAN_BASE_URL") or base_url
        self.endpoint = qianfan_chat_endpoint(configured)
        self.api_key = api_key or os.environ.get("AIWS_ERNIE_API_KEY") or os.environ.get("AIWS_QIANFAN_API_KEY")
        self.timeout = timeout

    def chat(
        self,
        *,
        model: str,
        system: str,
        content: str,
        attachments: list[dict[str, str]] | None = None,
    ) -> str:
        if not self.api_key:
            raise storage.WorkspaceError("ERNIE/Qianfan requires AIWS_ERNIE_API_KEY or AIWS_QIANFAN_API_KEY.")
        if attachments:
            raise storage.WorkspaceError("ERNIE/Qianfan file or vision input is not enabled in AIWS yet.")
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": content},
            ],
            "max_tokens": 1024,
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
            with request.urlopen(req, timeout=self.timeout) as response:
                response_data = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            raise storage.WorkspaceError(qianfan_http_error_message(exc)) from exc
        except socket.timeout as exc:
            raise storage.WorkspaceError("ERNIE/Qianfan request timed out.") from exc
        except error.URLError as exc:
            raise storage.WorkspaceError(f"Could not reach ERNIE/Qianfan at {self.endpoint}: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise storage.WorkspaceError("ERNIE/Qianfan returned invalid JSON.") from exc

        choices = response_data.get("choices", [])
        if choices and isinstance(choices[0], dict):
            message = choices[0].get("message", {})
            if isinstance(message, dict) and isinstance(message.get("content"), str):
                return message["content"]
        raise storage.WorkspaceError("ERNIE/Qianfan response did not include choices[0].message.content.")


def qianfan_chat_endpoint(base_url: str) -> str:
    cleaned = base_url.rstrip("/")
    if cleaned.endswith("/chat/completions"):
        return cleaned
    return f"{cleaned}/chat/completions"


def qianfan_http_error_message(exc: error.HTTPError) -> str:
    try:
        body = exc.read().decode("utf-8", errors="replace")
        payload = json.loads(body) if body else {}
    except (json.JSONDecodeError, OSError):
        payload = {}
    message = ""
    if isinstance(payload, dict):
        error_value = payload.get("error")
        if isinstance(error_value, dict):
            message = str(error_value.get("message") or error_value.get("code") or "")
        elif isinstance(payload.get("message"), str):
            message = str(payload["message"])
    if exc.code in {401, 403}:
        return f"ERNIE/Qianfan API key is invalid, inactive, or not authorized. {message}".strip()
    if exc.code in {400, 404}:
        return f"ERNIE/Qianfan model or request is invalid. Check that this account can access the selected model. {message}".strip()
    if exc.code == 429:
        return f"ERNIE/Qianfan rate limit or quota reached. {message}".strip()
    if 500 <= exc.code <= 599:
        return f"ERNIE/Qianfan service error ({exc.code}). {message}".strip()
    return f"ERNIE/Qianfan API error ({exc.code}). {message}".strip()
