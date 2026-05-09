"""Kimi provider using Moonshot's OpenAI-compatible API."""

from __future__ import annotations

import json
import os
import socket
from urllib import error, request

from aiws import storage
from aiws.env import load_env

DEFAULT_KIMI_URL = "https://api.moonshot.ai/v1/chat/completions"
DEFAULT_KIMI_MODELS = ("kimi-k2.5", "kimi-k2.6", "kimi-k2-thinking")


class KimiProvider:
    name = "kimi"

    def __init__(
        self,
        endpoint: str = DEFAULT_KIMI_URL,
        api_key: str | None = None,
        models: list[str] | None = None,
        timeout: int = 120,
    ) -> None:
        load_env()
        self.endpoint = endpoint
        self.api_key = api_key or os.environ.get("AIWS_KIMI_API_KEY") or os.environ.get("MOONSHOT_API_KEY")
        configured_models = os.environ.get("AIWS_KIMI_MODELS", "")
        self.models = models or [item.strip() for item in configured_models.split(",") if item.strip()] or list(DEFAULT_KIMI_MODELS)
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
            raise storage.WorkspaceError("Kimi requires AIWS_KIMI_API_KEY or MOONSHOT_API_KEY.")
        if model not in self.models:
            raise storage.WorkspaceError(
                f"Kimi model is not configured: {model}. Set AIWS_KIMI_MODELS to enable it."
            )
        user_content: str | list[dict[str, object]] = content
        if attachments:
            user_content = [{"type": "text", "text": content}]
            for item in attachments:
                if item.get("kind") == "image_data_url" and item.get("data_url"):
                    user_content.append({"type": "image_url", "image_url": {"url": item["data_url"]}})
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user_content},
            ],
        }
        if "thinking" in model and os.environ.get("AIWS_KIMI_THINKING", "").lower() in {"1", "true", "yes"}:
            payload["thinking"] = {"type": "enabled"}
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
            raise storage.WorkspaceError(kimi_http_error_message(exc)) from exc
        except socket.timeout as exc:
            raise storage.WorkspaceError("Kimi request timed out.") from exc
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


def kimi_http_error_message(exc: error.HTTPError) -> str:
    try:
        body = exc.read().decode("utf-8", errors="replace")
        payload = json.loads(body) if body else {}
    except (json.JSONDecodeError, OSError):
        payload = {}
    message = ""
    if isinstance(payload, dict):
        error_value = payload.get("error", {})
        if isinstance(error_value, dict):
            message = str(error_value.get("message") or error_value.get("code") or "")
        elif error_value:
            message = str(error_value)
    if exc.code in {401, 403}:
        return f"Kimi API key is invalid, inactive, or payment is not enabled. {message}".strip()
    if exc.code == 404:
        return f"Kimi model or endpoint was not found. {message}".strip()
    if exc.code == 429:
        return f"Kimi rate limit reached. {message}".strip()
    if 500 <= exc.code <= 599:
        return f"Kimi service error ({exc.code}). {message}".strip()
    return f"Kimi API error ({exc.code}). {message}".strip()
