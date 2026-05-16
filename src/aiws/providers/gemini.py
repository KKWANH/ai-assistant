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
        max_output_tokens = int(os.environ.get("AIWS_GEMINI_MAX_OUTPUT_TOKENS", "2048"))
        payload = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"maxOutputTokens": max_output_tokens},
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

        text = extract_gemini_text(response_data)
        if not text:
            candidates = response_data.get("candidates", [])
            if not candidates:
                prompt_feedback = response_data.get("promptFeedback", {})
                block_reason = prompt_feedback.get("blockReason") if isinstance(prompt_feedback, dict) else None
                suffix = f" Block reason: {block_reason}." if block_reason else ""
                raise storage.WorkspaceError(f"Gemini response did not include candidates.{suffix}")
            raise storage.WorkspaceError(gemini_empty_text_message(response_data))
        return text


def extract_gemini_text(response_data: dict[str, object]) -> str:
    """Collect text from every Gemini candidate/part.

    Gemini can return several candidates, multiple text parts, or a blocked
    candidate with no text. Collecting all text parts avoids treating a valid
    second candidate or later part as an empty response.
    """
    direct_text = response_data.get("text")
    if isinstance(direct_text, str) and direct_text.strip():
        return direct_text.strip()
    for fallback_key in ("content", "message", "output_text"):
        fallback_text = response_data.get(fallback_key)
        if isinstance(fallback_text, str) and fallback_text.strip():
            return fallback_text.strip()
    chunks: list[str] = []
    candidates = response_data.get("candidates", [])
    if not isinstance(candidates, list):
        return ""
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        content = candidate.get("content", {})
        if not isinstance(content, dict):
            continue
        parts = content.get("parts", [])
        if not isinstance(parts, list):
            continue
        for part in parts:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                chunks.append(part["text"])
    return "".join(chunks).strip()


def gemini_empty_text_message(response_data: dict[str, object]) -> str:
    candidates = response_data.get("candidates", [])
    finish_reasons: list[str] = []
    part_keys: list[str] = []
    if isinstance(candidates, list):
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            finish_reason = candidate.get("finishReason")
            if finish_reason:
                finish_reasons.append(str(finish_reason))
            content = candidate.get("content", {})
            if isinstance(content, dict) and isinstance(content.get("parts"), list):
                for part in content["parts"]:
                    if isinstance(part, dict):
                        part_keys.extend(str(key) for key in part.keys())
    prompt_feedback = response_data.get("promptFeedback", {})
    block_reason = prompt_feedback.get("blockReason") if isinstance(prompt_feedback, dict) else None
    details: list[str] = []
    if finish_reasons:
        details.append(f"finishReason={','.join(finish_reasons)}")
    if block_reason:
        details.append(f"blockReason={block_reason}")
    if part_keys:
        details.append(f"partKeys={','.join(sorted(set(part_keys)))}")
    suffix = f" ({'; '.join(details)})" if details else ""
    return f"Gemini response did not include text{suffix}."


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
