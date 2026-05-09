from functools import partial
from http.server import ThreadingHTTPServer
import re
from threading import Thread
from urllib import parse, request
from http.cookiejar import CookieJar
from pathlib import Path

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
        provider_attachments=None,
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
        calls["provider_attachments"] = provider_attachments
        return "ok"

    monkeypatch.setattr(runner, "ask", fake_ask)

    handler = partial(AIWSHandler, root=str(root), require_auth=False, password=None)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    try:
        page = request.urlopen(f"{base_url}/project/ai-system/local-runner", timeout=5).read().decode("utf-8")
        assert '<div id="root"></div>' in page
        assert "/assets/" in page

        chat = request.urlopen(f"{base_url}/chat/ai-system/local-runner/ollama-mvp", timeout=5).read().decode("utf-8")
        assert '<div id="root"></div>' in chat

        bundle_text = "".join(path.read_text(encoding="utf-8") for path in (Path.cwd() / "web" / "dist" / "assets").glob("*.js"))
        style_text = "".join(path.read_text(encoding="utf-8") for path in (Path.cwd() / "web" / "dist" / "assets").glob("*.css"))
        assert "Workspace" in bundle_text
        assert "data-attachment-input" in bundle_text
        assert "data-remove-attachment" in bundle_text
        assert "data-lightbox" in bundle_text
        assert "data-preview-src" in bundle_text
        assert "data-api-action" in bundle_text
        assert "무엇을 도와드릴까요?" in bundle_text
        assert "search_mode" in bundle_text
        assert "Attach file" in bundle_text
        assert "로컬 컨텍스트 우선" in bundle_text
        assert "검색 안 함" in bundle_text
        assert "웹 검색 준비 중" in bundle_text
        assert "Personal chats" in bundle_text
        assert "웹 검색과 이미지 생성은 아직 꺼져 있습니다." in bundle_text
        assert "Artifacts, drafts, and generated files will appear here." not in bundle_text
        assert "local, fastest, basic" in bundle_text
        assert "공개 범위" in bundle_text
        assert "Logout" in bundle_text
        assert "multipart/form-data" in bundle_text
        assert "data-copy-codex-prompt" in bundle_text
        assert "data-pdf-preview" in bundle_text
        assert "data-markdown-renderer" in bundle_text
        assert "Kwanho Kim" in bundle_text
        assert "Chungja Byun" in bundle_text
        assert "Gunwoo Kim" in bundle_text
        assert "Assistant is thinking" in bundle_text
        assert ".workbench" in style_text
        assert ".composer" in style_text
        assert ".goal-panel" in style_text
        assert ".pdf-thumb" in style_text
        assert ".waiting-notice" in style_text
        assert ".tree-heading" in style_text
        assert ".item-kind" in style_text

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

        workspace = request.urlopen(f"{base_url}/api/workspace", timeout=5).read().decode("utf-8")
        assert "Local Runner" in workspace
        assert "Ollama MVP" in workspace
        runtime = request.urlopen(f"{base_url}/api/runtime", timeout=5).read().decode("utf-8")
        assert '"runtime"' in runtime
        assert '"port"' in runtime
        goal = request.urlopen(f"{base_url}/api/goal/ai-system/local-runner", timeout=5).read().decode("utf-8")
        assert '"goal"' in goal
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
                        "is_pdf": False,
                        "delivery": "Sent as text context",
                    }
                ]
            },
            "provider_attachments": [],
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


def test_home_renders_workspace_shell_and_empty_state(tmp_path):
    root = tmp_path / "workspace"
    storage.init_workspace(root)

    handler = partial(AIWSHandler, root=str(root), require_auth=False, password=None)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    try:
        page = request.urlopen(f"{base_url}/", timeout=5).read().decode("utf-8")
        assert '<div id="root"></div>' in page
        workspace = request.urlopen(f"{base_url}/api/workspace", timeout=5).read().decode("utf-8")
        assert '"projects": []' in workspace
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_login_uses_react_shell_and_public_assets_when_auth_required(tmp_path):
    root = tmp_path / "workspace"
    storage.init_workspace(root)

    handler = partial(AIWSHandler, root=str(root), require_auth=True, password="secret")
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    try:
        page = request.urlopen(f"{base_url}/login", timeout=5).read().decode("utf-8")
        assert '<div id="root"></div>' in page
        assert "Assistant" in page
        asset_match = re.search(r'src="([^"]*assets/[^"]+\.js)"', page)
        assert asset_match
        asset = request.urlopen(f"{base_url}{asset_match.group(1)}", timeout=5)
        assert asset.status == 200
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_api_can_create_projectless_chat(tmp_path):
    root = tmp_path / "workspace"
    storage.init_workspace(root)

    handler = partial(AIWSHandler, root=str(root), require_auth=False, password=None)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    try:
        payload = parse.urlencode({"title": ""}).encode("utf-8")
        req = request.Request(f"{base_url}/api/chats", data=payload, method="POST")
        response = request.urlopen(req, timeout=5)
        body = response.read().decode("utf-8")
        assert response.status == 200
        assert "general-chat-local" in body
        assert "new-chat" in body

        duplicate = request.urlopen(req, timeout=5).read().decode("utf-8")
        assert "new-chat-2" in duplicate

        workspace = request.urlopen(f"{base_url}/api/workspace", timeout=5).read().decode("utf-8")
        assert '"projects": []' in workspace
        assert "New chat" in workspace
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_kimi_image_upload_is_passed_as_vision_attachment(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Vision")
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
        provider_attachments=None,
    ):
        calls["provider"] = provider
        calls["provider_attachments"] = provider_attachments
        calls["user_metadata"] = user_metadata
        return "ok"

    monkeypatch.setattr(runner, "ask", fake_ask)
    handler = partial(AIWSHandler, root=str(root), require_auth=False, password=None)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    try:
        boundary = "----aiws-image-boundary"
        multipart_body = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="provider"\r\n\r\n'
            "kimi\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="model"\r\n\r\n'
            "kimi-k2.5\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="content"\r\n\r\n'
            "What is in this image?\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="attachment"; filename="photo.png"\r\n'
            "Content-Type: image/png\r\n\r\n"
        ).encode("utf-8") + b"\x89PNG\r\n\x1a\nx\r\n" + f"--{boundary}--\r\n".encode("utf-8")
        req = request.Request(
            f"{base_url}/api/ask/ai-system/vision",
            data=multipart_body,
            method="POST",
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Accept": "application/json"},
        )
        response = request.urlopen(req, timeout=5)
        assert response.status == 200
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    assert calls["provider"] == "kimi"
    assert calls["provider_attachments"][0]["kind"] == "image_data_url"
    assert calls["provider_attachments"][0]["data_url"].startswith("data:image/png;base64,")
    assert calls["user_metadata"]["attachments"][0]["delivery"] == "Sent as vision input"


def test_login_sets_secure_cookie_behind_https_and_rate_limits_failures(tmp_path):
    root = tmp_path / "workspace"
    storage.create_account(root, "Kwanho", "secret", admin=True)

    handler = partial(AIWSHandler, root=str(root), require_auth=True, password="server-secret")
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    jar = CookieJar()
    opener = request.build_opener(request.HTTPCookieProcessor(jar))
    try:
        opener.open(f"{base_url}/login", timeout=5).read()
        csrf = next(cookie.value for cookie in jar if cookie.name == "aiws_csrf")
        payload = parse.urlencode({"username": "kwanho", "password": "secret", "_csrf": csrf}).encode("utf-8")
        req = request.Request(
            f"{base_url}/login",
            data=payload,
            method="POST",
            headers={"X-Forwarded-Proto": "https"},
        )
        response = opener.open(req, timeout=5)
        assert response.status == 200
        auth_cookie = next(cookie for cookie in jar if cookie.name == "aiws_auth")
        assert auth_cookie.secure is True

        bad_jar = CookieJar()
        bad_opener = request.build_opener(request.HTTPCookieProcessor(bad_jar))
        bad_opener.open(f"{base_url}/login", timeout=5).read()
        bad_csrf = next(cookie.value for cookie in bad_jar if cookie.name == "aiws_csrf")
        for _ in range(6):
            bad_payload = parse.urlencode({"username": "parent", "password": "wrong", "_csrf": bad_csrf}).encode("utf-8")
            try:
                bad_opener.open(request.Request(f"{base_url}/login", data=bad_payload, method="POST"), timeout=5)
            except Exception:
                pass
        limited_payload = parse.urlencode({"username": "parent", "password": "wrong", "_csrf": bad_csrf}).encode("utf-8")
        with pytest.raises(Exception):
            bad_opener.open(request.Request(f"{base_url}/login", data=limited_payload, method="POST"), timeout=5)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
