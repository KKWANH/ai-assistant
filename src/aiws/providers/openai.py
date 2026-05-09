"""OpenAI provider using the Responses API."""

from __future__ import annotations

import json
import os
import socket
from urllib import error, request

from aiws import storage
from aiws.env import load_env

DEFAULT_OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"


class OpenAIProvider:
    name = "openai"

    def __init__(self, endpoint: str = DEFAULT_OPENAI_RESPONSES_URL, api_key: str | None = None, timeout: int = 120) -> None:
        load_env()
        self.endpoint = os.environ.get("AIWS_OPENAI_RESPONSES_URL", endpoint)
        self.api_key = api_key or os.environ.get("AIWS_OPENAI_API_KEY")
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
            raise storage.WorkspaceError("OpenAI requires AIWS_OPENAI_API_KEY.")
        if attachments:
            raise storage.WorkspaceError("OpenAI file/vision input is not enabled in AIWS yet.")
        payload = {
            "model": model,
            "instructions": system,
            "input": content,
            "max_output_tokens": 512,
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
            raise storage.WorkspaceError(openai_http_error_message(exc)) from exc
        except socket.timeout as exc:
            raise storage.WorkspaceError("OpenAI request timed out.") from exc
        except error.URLError as exc:
            raise storage.WorkspaceError(f"Could not reach OpenAI at {self.endpoint}: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise storage.WorkspaceError("OpenAI returned invalid JSON.") from exc

        output_text = response_data.get("output_text")
        if isinstance(output_text, str) and output_text.strip():
            return output_text
        chunks: list[str] = []
        for item in response_data.get("output", []):
            if not isinstance(item, dict):
                continue
            for content_item in item.get("content", []):
                if isinstance(content_item, dict) and isinstance(content_item.get("text"), str):
                    chunks.append(content_item["text"])
        text = "".join(chunks).strip()
        if not text:
            raise storage.WorkspaceError("OpenAI response did not include output text.")
        return text


def openai_http_error_message(exc: error.HTTPError) -> str:
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
    if exc.code in {401, 403}:
        return f"OpenAI API key is invalid, inactive, or billing is not enabled. {message}".strip()
    if exc.code in {400, 404}:
        return f"OpenAI model or request is invalid. {message}".strip()
    if exc.code == 429:
        return f"OpenAI rate limit or quota reached. {message}".strip()
    if 500 <= exc.code <= 599:
        return f"OpenAI service error ({exc.code}). {message}".strip()
    return f"OpenAI API error ({exc.code}). {message}".strip()
