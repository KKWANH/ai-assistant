from functools import partial
from http.server import ThreadingHTTPServer
from threading import Thread
from urllib import parse, request

import pytest

from aiws import runner, storage
from aiws.ui import AIWSHandler, validate_ui_options


def test_local_mode_binds_loopback_without_auth():
    host, require_auth = validate_ui_options("local", None)

    assert host == "127.0.0.1"
    assert require_auth is False


def test_server_mode_requires_password():
    with pytest.raises(storage.WorkspaceError, match="requires --password"):
        validate_ui_options("server", None)


def test_server_mode_binds_all_interfaces_with_auth():
    host, require_auth = validate_ui_options("server", "change-me")

    assert host == "0.0.0.0"
    assert require_auth is True


def test_project_page_exposes_ask_form_and_posts_to_runner(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System", skills=["andrej-karpathy-skills"])
    storage.create_project(root, "Local Runner", parent="ai-system")
    storage.create_session(root, "ai-system/local-runner", "Ollama MVP")
    calls = {}

    def fake_ask(
        root_arg,
        project_path,
        session_slug,
        *,
        provider,
        model,
        content,
        actor=None,
        search_mode="off",
        user_metadata=None,
        stored_content=None,
    ):
        calls["root"] = root_arg
        calls["project_path"] = project_path
        calls["session_slug"] = session_slug
        calls["provider"] = provider
        calls["model"] = model
        calls["content"] = content
        calls["actor"] = actor
        calls["search_mode"] = search_mode
        calls["stored_content"] = stored_content
        calls["user_metadata"] = user_metadata
        return "ok"

    monkeypatch.setattr(runner, "ask", fake_ask)

    handler = partial(AIWSHandler, root=str(root), require_auth=False, password=None)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    try:
        page = request.urlopen(f"{base_url}/project/ai-system/local-runner", timeout=5).read().decode("utf-8")
        assert "Sessions" in page
        assert "/chat/ai-system/local-runner/ollama-mvp" in page
        assert "활성 스킬" in page

        chat = request.urlopen(f"{base_url}/chat/ai-system/local-runner/ollama-mvp", timeout=5).read().decode("utf-8")
        assert "chat-shell" in chat
        assert "Workspace" in chat
        assert "data-attachment-input" in chat
        assert 'class="brand" href="/">Assistant</a>' in chat
        assert "data-remove-attachment" in chat
        assert "data-lightbox" in chat
        assert "data-preview-src" in chat
        assert 'data-api-action="/api/ask/ai-system/local-runner/ollama-mvp"' in chat
        assert "fetch(composer.dataset.apiAction" in chat
        assert 'enctype="multipart/form-data"' in chat
        assert "무엇을 도와드릴까요?" in chat
        assert "search_mode" in chat
        assert "Attach file" in chat

        payload = parse.urlencode(
            {
                "provider": "ollama",
                "model": "qwen3:0.6b",
                "content": "Hello from UI",
            }
        ).encode("utf-8")
        req = request.Request(f"{base_url}/ask/ai-system/local-runner/ollama-mvp", data=payload, method="POST")
        opener = request.build_opener(request.HTTPRedirectHandler)
        response = opener.open(req, timeout=5)
        assert response.status == 200

        boundary = "----aiws-test-boundary"
        multipart_body = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="provider"\r\n\r\n'
            "ollama\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="model"\r\n\r\n'
            "qwen3:0.6b\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="search_mode"\r\n\r\n'
            "auto\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="content"\r\n\r\n'
            "Read this file\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="attachment"; filename="note.txt"\r\n'
            "Content-Type: text/plain\r\n\r\n"
            "file body\r\n"
            f"--{boundary}--\r\n"
        ).encode("utf-8")
        req = request.Request(
            f"{base_url}/api/ask/ai-system/local-runner/ollama-mvp",
            data=multipart_body,
            method="POST",
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Accept": "application/json"},
        )
        response = opener.open(req, timeout=5)
        assert response.status == 200
        assert response.headers["Content-Type"].startswith("application/json")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    assert calls == {
        "root": str(root),
        "project_path": "ai-system/local-runner",
        "session_slug": "ollama-mvp",
        "provider": "ollama",
        "model": "qwen3:0.6b",
        "content": "Read this file\n\nAttached file: note.txt\n\nExtracted attachment text:\nfile body",
            "actor": None,
            "search_mode": "auto",
            "stored_content": "Read this file",
            "user_metadata": {
                "attachments": [
                    {
                        "filename": "note.txt",
                        "url": "/attachment/ai-system/local-runner/ollama-mvp/note.txt",
                        "content_type": "txt",
                        "size": 9,
                        "is_image": False,
                    }
                ]
            },
        }


def test_admin_dashboard_requires_admin_and_shows_usage(tmp_path):
    root = tmp_path / "workspace"
    storage.create_account(root, "Admin", "secret", admin=True)
    storage.record_usage(root, "admin", messages=2, asks=1)

    handler = partial(AIWSHandler, root=str(root), require_auth=False, password=None)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    try:
        # No cookie means no admin even when auth is disabled.
        page = request.urlopen(f"{base_url}/admin", timeout=5).read().decode("utf-8")
        assert "Forbidden" in page
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
