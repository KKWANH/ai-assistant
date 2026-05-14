"""Gemini provider using the Google Generative Language API."""

from __future__ import annotations

import json
import os
import socket
from urllib import error, parse, request

from aiws import storage
from aiws.env import load_env

DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str | None = None, base_url: str = DEFAULT_GEMINI_BASE_URL, timeout: int = 120) -> None:
        load_env()
        self.api_key = api_key or os.environ.get("AIWS_GEMINI_API_KEY")
        self.base_url = os.environ.get("AIWS_GEMINI_BASE_URL", base_url).rstrip("/")
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
            raise storage.WorkspaceError("Gemini requires AIWS_GEMINI_API_KEY.")
        parts: list[dict[str, object]] = [{"text": content}]
        for item in attachments or []:
            if item.get("kind") == "inline_data" and item.get("mime_type") and item.get("data"):
                parts.append({"inlineData": {"mimeType": item["mime_type"], "data": item["data"]}})
        url = f"{self.base_url}/models/{parse.quote(model, safe='')}:generateContent?key={parse.quote(self.api_key)}"
        payload = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"maxOutputTokens": 512},
        }
        req = request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=self.timeout) as response:
                response_data = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            raise storage.WorkspaceError(gemini_http_error_message(exc)) from exc
        except socket.timeout as exc:
            raise storage.WorkspaceError("Gemini request timed out.") from exc
        except error.URLError as exc:
            raise storage.WorkspaceError(f"Could not reach Gemini at {self.base_url}: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise storage.WorkspaceError("Gemini returned invalid JSON.") from exc

        candidates = response_data.get("candidates", [])
        if not candidates:
            raise storage.WorkspaceError("Gemini response did not include candidates.")
        parts = candidates[0].get("content", {}).get("parts", [])
        text = "".join(str(part.get("text", "")) for part in parts if isinstance(part, dict)).strip()
        if not text:
            raise storage.WorkspaceError("Gemini response did not include text.")
        return text


def gemini_http_error_message(exc: error.HTTPError) -> str:
    try:
        body = exc.read().decode("utf-8", errors="replace")
        payload = json.loads(body) if body else {}
    except (json.JSONDecodeError, OSError):
        payload = {}
    message = ""
    if isinstance(payload, dict):
        error_value = payload.get("error", {})
        if isinstance(error_value, dict):
            message = str(error_value.get("message") or error_value.get("status") or "")
    if exc.code in {400, 404}:
        return f"Gemini model or request is invalid. {message}".strip()
    if exc.code in {401, 403}:
        return f"Gemini API key is invalid or billing/API access is not enabled. {message}".strip()
    if exc.code == 429:
        return f"Gemini rate limit reached. {message}".strip()
    if 500 <= exc.code <= 599:
        return f"Gemini service error ({exc.code}). {message}".strip()
    return f"Gemini API error ({exc.code}). {message}".strip()
