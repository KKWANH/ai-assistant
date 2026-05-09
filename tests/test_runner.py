import json
from urllib import error

import pytest

from aiws import runner, storage
from aiws.providers import ollama


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self):
        return json.dumps({"message": {"content": "Use a small provider interface."}}).encode("utf-8")


def test_ask_calls_ollama_and_persists_messages(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System", skills=["andrej-karpathy-skills"])
    storage.create_project(root, "Local Runner", parent="ai-system")
    storage.create_session(root, "ai-system/local-runner", "Ollama MVP")
    captured = {}

    def fake_urlopen(req, timeout):
        captured["timeout"] = timeout
        captured["url"] = req.full_url
        captured["payload"] = json.loads(req.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr(ollama.request, "urlopen", fake_urlopen)

    response = runner.ask(
        str(root),
        "ai-system/local-runner",
        "ollama-mvp",
        provider="ollama",
        model="qwen3:8b",
        content="What should we implement next?",
    )

    assert response == "Use a small provider interface."
    assert captured["url"] in {
        "http://127.0.0.1:11434/api/chat",
        "http://localhost:11434/api/chat",
    }
    assert captured["timeout"] == 120
    assert captured["payload"]["model"] == "qwen3:8b"
    assert captured["payload"]["stream"] is False
    assert captured["payload"]["messages"][0]["role"] == "system"
    assert "andrej-karpathy-skills/CLAUDE.md" in captured["payload"]["messages"][0]["content"]
    assert captured["payload"]["messages"][1] == {
        "role": "user",
        "content": "What should we implement next?",
    }

    messages = storage.read_messages(root, "ai-system/local-runner", "ollama-mvp")
    assert [message["role"] for message in messages] == ["user", "assistant"]
    assert messages[1]["provider"] == "ollama"
    assert messages[1]["model"] == "qwen3:8b"
    assert messages[1]["content"] == "Use a small provider interface."

    markdown = (storage.session_dir(root, "ai-system/local-runner", "ollama-mvp") / "session.md").read_text(
        encoding="utf-8"
    )
    assert "## User" in markdown
    assert "## Assistant" in markdown


def test_ollama_provider_falls_back_to_ipv4_localhost(monkeypatch):
    calls = []

    def fake_urlopen(req, timeout):
        calls.append(req.full_url)
        if req.full_url.startswith("http://localhost:11434"):
            raise error.URLError("connection refused")
        return FakeResponse()

    monkeypatch.setattr(ollama.request, "urlopen", fake_urlopen)

    response = ollama.OllamaProvider(endpoint="http://localhost:11434/api/chat").chat(
        model="qwen3:4b",
        system="sys",
        content="hello",
    )

    assert response == "Use a small provider interface."
    assert calls == ["http://localhost:11434/api/chat", "http://127.0.0.1:11434/api/chat"]


def test_ask_includes_account_context(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_account(root, "Kwanho", "secret")
    storage.update_account_profile(root, "kwanho", name="Kwanho", memory="Likes Korean UI.")
    storage.create_project(root, "AI System", owner="kwanho")
    storage.create_session(root, "ai-system", "Ollama MVP")
    captured = {}

    def fake_urlopen(req, timeout):
        captured["payload"] = json.loads(req.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr(ollama.request, "urlopen", fake_urlopen)

    runner.ask(
        str(root),
        "ai-system",
        "ollama-mvp",
        provider="ollama",
        model="qwen3:0.6b",
        content="Hello",
        actor="kwanho",
    )

    system = captured["payload"]["messages"][0]["content"]
    assert "## Account Context" in system
    assert "Likes Korean UI." in system


def test_ask_updates_account_memory_for_future_context(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_account(root, "Kwanho", "secret")
    storage.create_project(root, "AI System", owner="kwanho")
    storage.create_session(root, "ai-system", "Planning")

    def fake_urlopen(req, timeout):
        return FakeResponse()

    monkeypatch.setattr(ollama.request, "urlopen", fake_urlopen)

    runner.ask(
        str(root),
        "ai-system",
        "planning",
        provider="ollama",
        model="qwen3:0.6b",
        content="나는 로컬 AI 작업실을 가족도 쉽게 쓰길 원해.",
        actor="kwanho",
    )

    memories = storage.load_account(root, "kwanho")["profile"]["memory"]
    assert memories[-1]["source"] == "auto"
    assert "가족도 쉽게" in memories[-1]["content"]


def test_unknown_provider_is_rejected(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Ollama MVP")

    try:
        runner.ask(
            str(root),
            "ai-system",
            "ollama-mvp",
            provider="unknown",
            model="x",
            content="Hello",
        )
    except storage.WorkspaceError as exc:
        assert "Unsupported provider" in str(exc)
    else:
        raise AssertionError("Expected WorkspaceError")
    assert storage.read_messages(root, "ai-system", "ollama-mvp") == []


def test_remote_provider_requires_explicit_confirmation(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Cloud")
    monkeypatch.setenv("AIWS_DISABLE_REMOTE_BY_DEFAULT", "true")

    with pytest.raises(storage.WorkspaceError, match="disabled by default"):
        runner.ask(
            str(root),
            "ai-system",
            "cloud",
            provider="gemini",
            model="gemini-2.5-flash-lite",
            content="Hello",
        )

    assert storage.read_messages(root, "ai-system", "cloud") == []


def test_remote_provider_logs_model_usage(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_account(root, "Kwanho", "secret")
    storage.create_project(root, "AI System", owner="kwanho")
    storage.create_session(root, "ai-system", "Cloud")
    monkeypatch.setenv("AIWS_DISABLE_REMOTE_BY_DEFAULT", "false")

    class FakeCloudProvider:
        def chat(self, *, model, system, content, attachments=None):
            return "Cloud response"

    monkeypatch.setattr(runner, "get_provider", lambda provider: FakeCloudProvider())

    runner.ask(
        str(root),
        "ai-system",
        "cloud",
        provider="gemini",
        model="gemini-2.5-flash-lite",
        content="Hello",
        actor="kwanho",
        allow_remote=True,
        confirm_cost=True,
    )

    usage = storage.list_model_usage(root, "kwanho")
    assert len(usage) == 1
    assert usage[0]["provider"] == "gemini"
    assert usage[0]["model"] == "gemini-2.5-flash-lite"
    assert usage[0]["actual_usd"] >= 0


def test_remote_provider_respects_daily_budget(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Cloud")
    monkeypatch.setenv("AIWS_DISABLE_REMOTE_BY_DEFAULT", "false")
    monkeypatch.setenv("AIWS_DAILY_USD_LIMIT", "0")

    with pytest.raises(storage.WorkspaceError, match="Daily API budget"):
        runner.ask(
            str(root),
            "ai-system",
            "cloud",
            provider="gemini",
            model="gemini-2.5-flash-lite",
            content="Hello",
            allow_remote=True,
            confirm_cost=True,
        )

    assert storage.read_messages(root, "ai-system", "cloud") == []
