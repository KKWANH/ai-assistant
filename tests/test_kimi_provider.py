import json
from urllib import error

import pytest

from aiws import storage
from aiws.providers import kimi


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self):
        return json.dumps({"choices": [{"message": {"content": "Kimi response"}}]}).encode("utf-8")


def test_kimi_requires_api_key(monkeypatch):
    monkeypatch.delenv("AIWS_KIMI_API_KEY", raising=False)
    monkeypatch.delenv("MOONSHOT_API_KEY", raising=False)

    with pytest.raises(storage.WorkspaceError):
        kimi.KimiProvider().chat(model="kimi-k2.5", system="s", content="c")


def test_kimi_chat_uses_openai_compatible_endpoint(monkeypatch):
    captured = {}

    def fake_urlopen(req, timeout):
        captured["url"] = req.full_url
        captured["headers"] = dict(req.header_items())
        captured["payload"] = json.loads(req.data.decode("utf-8"))
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr(kimi.request, "urlopen", fake_urlopen)

    response = kimi.KimiProvider(api_key="test-key").chat(model="kimi-k2.5", system="sys", content="hello")

    assert response == "Kimi response"
    assert captured["url"] == "https://api.moonshot.ai/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer test-key"
    assert captured["payload"]["model"] == "kimi-k2.5"
    assert captured["payload"]["messages"][0]["role"] == "system"


def test_kimi_chat_sends_image_data_url(monkeypatch):
    captured = {}

    def fake_urlopen(req, timeout):
        captured["payload"] = json.loads(req.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr(kimi.request, "urlopen", fake_urlopen)

    kimi.KimiProvider(api_key="test-key").chat(
        model="kimi-k2.5",
        system="sys",
        content="what is this?",
        attachments=[{"kind": "image_data_url", "data_url": "data:image/png;base64,abcd"}],
    )

    content = captured["payload"]["messages"][1]["content"]
    assert content[0] == {"type": "text", "text": "what is this?"}
    assert content[1] == {"type": "image_url", "image_url": {"url": "data:image/png;base64,abcd"}}


def test_kimi_rejects_unconfigured_model():
    with pytest.raises(storage.WorkspaceError, match="not configured"):
        kimi.KimiProvider(api_key="test-key", models=["kimi-k2.5"]).chat(
            model="unknown",
            system="sys",
            content="hello",
        )


def test_kimi_rate_limit_error_is_clear(monkeypatch):
    def fake_urlopen(req, timeout):
        raise error.HTTPError(req.full_url, 429, "Too Many Requests", {}, None)

    monkeypatch.setattr(kimi.request, "urlopen", fake_urlopen)

    with pytest.raises(storage.WorkspaceError, match="rate limit"):
        kimi.KimiProvider(api_key="test-key").chat(model="kimi-k2.5", system="sys", content="hello")
