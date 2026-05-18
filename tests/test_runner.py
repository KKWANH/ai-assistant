import json
from io import BytesIO
from urllib import error

import pytest

from aiws import attachments, runner, storage
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
    receipt = messages[1]["metadata"]["context_receipt"]
    assert receipt["provider"] == "ollama"
    assert receipt["privacy_mode"] == "local"
    assert receipt["estimated_cost"] == 0.0
    assert receipt["input_tokens"] > 0
    receipts_path = storage.session_dir(root, "ai-system/local-runner", "ollama-mvp") / "context_receipts.jsonl"
    receipts = [json.loads(line) for line in receipts_path.read_text(encoding="utf-8").splitlines()]
    assert receipts[-1]["provider"] == "ollama"
    assert receipts[-1]["model_delivery"] == "local"
    work_session = storage.read_json(storage.session_dir(root, "ai-system/local-runner", "ollama-mvp") / "work_session.json")
    assert work_session["status"] == "completed"
    assert work_session["type"] == "project_task"
    assert work_session["model_calls"][-1]["model"] == "qwen3:8b"
    assert any(item["id"] == "save_answer_artifact" for item in work_session["next_actions"])

    markdown = (storage.session_dir(root, "ai-system/local-runner", "ollama-mvp") / "session.md").read_text(encoding="utf-8")
    assert "## User" in markdown
    assert "## Assistant" in markdown


def test_ask_includes_project_retrieval_context(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_project(root, "Research")
    storage.create_session(root, "research", "Question")
    files = storage.project_dir(root, "research") / "files"
    files.mkdir()
    (files / "camera.md").write_text("Canon battery door failure usually cuts power intermittently.", encoding="utf-8")
    captured = {}

    def fake_urlopen(req, timeout):
        captured["payload"] = json.loads(req.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr(ollama.request, "urlopen", fake_urlopen)

    runner.ask(
        str(root),
        "research",
        "question",
        provider="ollama",
        model="qwen3:8b",
        content="battery door failure 원인?",
    )

    system = captured["payload"]["messages"][0]["content"]
    assert "## Retrieved Project Context" in system
    assert "[R1]" in system
    assert "files/camera.md" in system
    messages = storage.read_messages(root, "research", "question")
    chunks = messages[-1]["metadata"]["context_receipt"]["included_chunks"]
    retrieval_chunks = [item for item in chunks if item.get("source") == "project_retrieval"]
    assert retrieval_chunks
    assert retrieval_chunks[0]["source_id"] == "R1"
    assert retrieval_chunks[0]["matched_terms"]
    assert retrieval_chunks[0]["rerank_score"] is not None
    used_context = storage.read_json(storage.session_dir(root, "research", "question") / "used_context.json")
    assert used_context["context_mode"] == "retrieval_first"


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


def test_ollama_model_missing_error_mentions_pull(monkeypatch):
    def fake_urlopen(req, timeout):
        body = BytesIO(json.dumps({"error": "model 'qwen3:8b' not found"}).encode("utf-8"))
        raise error.HTTPError(req.full_url, 400, "Bad Request", {}, body)

    monkeypatch.setattr(ollama.request, "urlopen", fake_urlopen)

    with pytest.raises(storage.WorkspaceError, match=r"ollama pull qwen3:8b"):
        ollama.OllamaProvider(endpoint="http://127.0.0.1:11434/api/chat").chat(
            model="qwen3:8b",
            system="sys",
            content="hello",
        )


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
    used_context = storage.read_json(storage.session_dir(root, "ai-system", "ollama-mvp") / "used_context.json")
    assert used_context["provider"] == "ollama"
    assert "Likes Korean UI." in used_context["context_preview"]


def test_ask_with_current_attachment_does_not_send_previous_files(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Images")
    attachments.save_attachment(root, "ai-system", "images", "old.txt", b"old private text", delivery="text_context")
    attachments.save_attachment(root, "ai-system", "images", "current.txt", b"current text", delivery="text_context")
    captured = {}

    def fake_urlopen(req, timeout):
        captured["payload"] = json.loads(req.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr(ollama.request, "urlopen", fake_urlopen)

    runner.ask(
        str(root),
        "ai-system",
        "images",
        provider="ollama",
        model="qwen3:4b",
        content="Read this",
        user_metadata={"attachments": [{"filename": "current.txt"}]},
    )

    system = captured["payload"]["messages"][0]["content"]
    assert "current text" in system
    assert "old private text" not in system
    receipt = storage.read_messages(root, "ai-system", "images")[-1]["metadata"]["context_receipt"]
    assert [item["filename"] for item in receipt["used_files"]] == ["current.txt"]
    assert any(item["filename"] == "old.txt" for item in receipt["unused_files"])
    assert receipt["included_chunks"][0]["filename"] == "current.txt"
    assert receipt["included_chunks"][0]["privacy"] == "local_only"
    assert any(item["filename"] == "old.txt" and item["reason"] == "not selected for this request" for item in receipt["excluded"])


def test_ask_without_active_attachment_uses_retrieval_first_not_prior_file_dump(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Images")
    attachments.save_attachment(root, "ai-system", "images", "old.txt", b"old private text", delivery="text_context")
    captured = {}

    def fake_urlopen(req, timeout):
        captured["payload"] = json.loads(req.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr(ollama.request, "urlopen", fake_urlopen)

    runner.ask(
        str(root),
        "ai-system",
        "images",
        provider="ollama",
        model="qwen3:4b",
        content="Hello",
    )

    system = captured["payload"]["messages"][0]["content"]
    assert "old private text" not in system
    receipt = storage.read_messages(root, "ai-system", "images")[-1]["metadata"]["context_receipt"]
    assert receipt["context_mode"] == "retrieval_first"


def test_ask_can_include_previous_files_when_requested(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Images")
    attachments.save_attachment(root, "ai-system", "images", "old.txt", b"old private text", delivery="text_context")
    attachments.save_attachment(root, "ai-system", "images", "current.txt", b"current text", delivery="text_context")
    captured = {}

    def fake_urlopen(req, timeout):
        captured["payload"] = json.loads(req.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setattr(ollama.request, "urlopen", fake_urlopen)

    runner.ask(
        str(root),
        "ai-system",
        "images",
        provider="ollama",
        model="qwen3:4b",
        content="Compare this with previous files",
        user_metadata={"attachments": [{"filename": "current.txt"}]},
    )

    system = captured["payload"]["messages"][0]["content"]
    assert "current text" in system
    assert "old private text" in system
    receipt = storage.read_messages(root, "ai-system", "images")[-1]["metadata"]["context_receipt"]
    assert {item["filename"] for item in receipt["used_files"]} == {"current.txt", "old.txt"}
    assert {item["filename"] for item in receipt["included_chunks"]} == {"current.txt", "old.txt"}


def test_ask_does_not_store_memory_without_explicit_request(tmp_path, monkeypatch):
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
    assert memories == []


def test_ask_updates_account_memory_for_explicit_request(tmp_path, monkeypatch):
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
        content="기억해줘. 나는 로컬 AI 작업실을 가족도 쉽게 쓰길 원해.",
        actor="kwanho",
    )

    memories = storage.load_account(root, "kwanho")["profile"]["memory"]
    assert memories[-1]["source"] == "explicit"
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


def test_web_search_requires_explicit_network_approval(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Search")
    called = {"search": False}

    def fake_search(query):
        called["search"] = True
        return []

    monkeypatch.setattr(runner.search, "web_search", fake_search)

    with pytest.raises(storage.WorkspaceError, match="network approval"):
        runner.ask(
            str(root),
            "ai-system",
            "search",
            provider="ollama",
            model="qwen3:4b",
            content="오늘 최신 뉴스 알려줘",
            search_mode="auto",
        )

    assert called["search"] is False
    assert storage.read_messages(root, "ai-system", "search") == []


def test_web_search_approval_is_recorded_in_manifest(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Search")

    class FakeProvider:
        def chat(self, *, model, system, content, attachments=None):
            return "Search response"

    monkeypatch.setattr(runner, "get_provider", lambda provider: FakeProvider())
    monkeypatch.setattr(
        runner.search,
        "web_search",
        lambda query: [runner.search.SearchResult("Result", "https://example.com", "snippet")],
    )

    runner.ask(
        str(root),
        "ai-system",
        "search",
        provider="ollama",
        model="qwen3:4b",
        content="오늘 최신 뉴스 알려줘",
        search_mode="auto",
        allow_network=True,
    )

    manifest = storage.read_json(storage.session_dir(root, "ai-system", "search") / "used_context.json")["manifest"]
    assert manifest["privacy"]["model_delivery"] == "local"
    assert manifest["privacy"]["network_used"] is True
    assert manifest["privacy"]["remote_providers"] == ["duckduckgo"]
    assert manifest["privacy"]["search_queries_sent"] == ["오늘 최신 뉴스 알려줘"]


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


def test_local_only_project_blocks_cloud_provider(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_account(root, "Kwanho", "secret")
    storage.create_project(root, "AI System", owner="kwanho")
    storage.create_session(root, "ai-system", "Cloud")
    storage.set_project_local_only(root, "ai-system", True)
    monkeypatch.setenv("AIWS_DISABLE_REMOTE_BY_DEFAULT", "false")

    with pytest.raises(storage.WorkspaceError, match="local-only"):
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


def test_remote_provider_logs_failed_usage_attempt(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_account(root, "Kwanho", "secret")
    storage.create_project(root, "AI System", owner="kwanho")
    storage.create_session(root, "ai-system", "Cloud")
    monkeypatch.setenv("AIWS_DISABLE_REMOTE_BY_DEFAULT", "false")

    class FailingCloudProvider:
        def chat(self, *, model, system, content, attachments=None):
            raise storage.WorkspaceError("token limit exceeded")

    monkeypatch.setattr(runner, "get_provider", lambda provider: FailingCloudProvider())

    with pytest.raises(storage.WorkspaceError, match="token limit"):
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
    assert usage[0]["status"] == "failed"
    assert usage[0]["estimated_usd"] is not None
    assert storage.load_account(root, "kwanho")["usage"]["asks"] == 1


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
