import json
from urllib import error

import pytest

from aiws import storage
from aiws.providers import ernie, gemini, openai


class FakeGeminiResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self):
        return json.dumps({"candidates": [{"content": {"parts": [{"text": "Gemini response"}]}}]}).encode("utf-8")


class FakeOpenAIResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self):
        return json.dumps({"output_text": "OpenAI response"}).encode("utf-8")


class FakeErnieResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self):
        return json.dumps({"choices": [{"message": {"content": "ERNIE response"}}]}).encode("utf-8")


def test_gemini_requires_api_key(monkeypatch):
    monkeypatch.setattr(gemini, "load_env", lambda *args, **kwargs: None)
    monkeypatch.delenv("AIWS_GEMINI_API_KEY", raising=False)

    with pytest.raises(storage.WorkspaceError, match="AIWS_GEMINI_API_KEY"):
        gemini.GeminiProvider().chat(model="gemini-2.5-flash-lite", system="s", content="c")


def test_gemini_chat_uses_generate_content(monkeypatch):
    captured = {}

    def fake_urlopen(req, timeout):
        captured["url"] = req.full_url
        captured["payload"] = json.loads(req.data.decode("utf-8"))
        captured["timeout"] = timeout
        return FakeGeminiResponse()

    monkeypatch.setattr(gemini.request, "urlopen", fake_urlopen)

    response = gemini.GeminiProvider(api_key="test-key").chat(
        model="gemini-2.5-flash-lite",
        system="sys",
        content="hello",
    )

    assert response == "Gemini response"
    assert "/models/gemini-2.5-flash-lite:generateContent" in captured["url"]
    assert "key=test-key" in captured["url"]
    assert captured["payload"]["systemInstruction"]["parts"][0]["text"] == "sys"
    assert captured["payload"]["contents"][0]["parts"][0]["text"] == "hello"


def test_gemini_chat_can_send_inline_file_data(monkeypatch):
    captured = {}

    def fake_urlopen(req, timeout):
        captured["payload"] = json.loads(req.data.decode("utf-8"))
        return FakeGeminiResponse()

    monkeypatch.setattr(gemini.request, "urlopen", fake_urlopen)

    gemini.GeminiProvider(api_key="test-key").chat(
        model="gemini-2.5-flash-lite",
        system="sys",
        content="read this",
        attachments=[{"kind": "inline_data", "mime_type": "application/pdf", "data": "JVBERi0x"}],
    )

    parts = captured["payload"]["contents"][0]["parts"]
    assert parts[0]["text"] == "read this"
    assert parts[1]["inlineData"]["mimeType"] == "application/pdf"
    assert parts[1]["inlineData"]["data"] == "JVBERi0x"


def test_openai_requires_api_key(monkeypatch):
    monkeypatch.setattr(openai, "load_env", lambda *args, **kwargs: None)
    monkeypatch.delenv("AIWS_OPENAI_API_KEY", raising=False)

    with pytest.raises(storage.WorkspaceError, match="AIWS_OPENAI_API_KEY"):
        openai.OpenAIProvider().chat(model="gpt-5.1-codex", system="s", content="c")


def test_openai_chat_uses_responses_api(monkeypatch):
    captured = {}

    def fake_urlopen(req, timeout):
        captured["url"] = req.full_url
        captured["headers"] = dict(req.header_items())
        captured["payload"] = json.loads(req.data.decode("utf-8"))
        return FakeOpenAIResponse()

    monkeypatch.setattr(openai.request, "urlopen", fake_urlopen)

    response = openai.OpenAIProvider(api_key="test-key").chat(
        model="gpt-5.1-codex",
        system="sys",
        content="hello",
    )

    assert response == "OpenAI response"
    assert captured["url"] == "https://api.openai.com/v1/responses"
    assert captured["headers"]["Authorization"] == "Bearer test-key"
    assert captured["payload"]["model"] == "gpt-5.1-codex"
    assert captured["payload"]["instructions"] == "sys"


def test_openai_quota_error_is_clear(monkeypatch):
    def fake_urlopen(req, timeout):
        raise error.HTTPError(req.full_url, 429, "Too Many Requests", {}, None)

    monkeypatch.setattr(openai.request, "urlopen", fake_urlopen)

    with pytest.raises(storage.WorkspaceError, match="quota|rate limit"):
        openai.OpenAIProvider(api_key="test-key").chat(model="gpt-5.1-codex", system="sys", content="hello")


def test_ernie_requires_api_key(monkeypatch):
    monkeypatch.setattr(ernie, "load_env", lambda *args, **kwargs: None)
    monkeypatch.delenv("AIWS_ERNIE_API_KEY", raising=False)
    monkeypatch.delenv("AIWS_QIANFAN_API_KEY", raising=False)

    with pytest.raises(storage.WorkspaceError, match="AIWS_ERNIE_API_KEY|AIWS_QIANFAN_API_KEY"):
        ernie.ErnieProvider().chat(model="ernie-5.1", system="s", content="c")


def test_ernie_chat_uses_qianfan_openai_compatible_api(monkeypatch):
    captured = {}

    def fake_urlopen(req, timeout):
        captured["url"] = req.full_url
        captured["headers"] = dict(req.header_items())
        captured["payload"] = json.loads(req.data.decode("utf-8"))
        captured["timeout"] = timeout
        return FakeErnieResponse()

    monkeypatch.setattr(ernie.request, "urlopen", fake_urlopen)

    response = ernie.ErnieProvider(api_key="test-key").chat(model="ernie-5.1", system="sys", content="hello")

    assert response == "ERNIE response"
    assert captured["url"] == "https://qianfan.baidubce.com/v2/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer test-key"
    assert captured["payload"]["model"] == "ernie-5.1"
    assert captured["payload"]["messages"][0] == {"role": "system", "content": "sys"}
