from functools import partial
from http.server import ThreadingHTTPServer
import json
import re
from threading import Thread
from urllib import parse, request
from http.cookiejar import CookieJar
from pathlib import Path

import pytest

from aiws import attachments, automations, runner, storage
from aiws.app.routes import runtime as runtime_routes
from aiws.ui import AIWSHandler, attachment_view, validate_ui_options


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
        allow_remote=False,
        allow_network=False,
        confirm_cost=False,
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
        assert "What are we working on?" in bundle_text
        assert "search_mode" in bundle_text
        assert "Attach file" in bundle_text
        assert "Local context only" in bundle_text
        assert "Search off" in bundle_text
        assert "Web search" in bundle_text
        assert "Recent" in bundle_text
        assert "Projects" in bundle_text
        assert "Public - logged-in users" in bundle_text
        assert "AIWS prioritizes saved chats, project context, and attached files." in bundle_text
        assert "Artifacts, drafts, and generated files will appear here." not in bundle_text
        assert "Local only" in bundle_text
        assert "Very cheap" in bundle_text
        assert "Gemini 2.5 Pro" in bundle_text
        assert "Kimi thinking" in bundle_text
        assert "aiws_model_mode" in bundle_text
        assert "window.confirm" not in bundle_text
        assert "Visibility" in bundle_text
        assert "Logout" in bundle_text
        assert "multipart/form-data" in bundle_text
        assert "data-copy-codex-prompt" in bundle_text
        assert "data-pdf-preview" in bundle_text
        assert "data-markdown-renderer" in bundle_text
        assert "Project actions" in bundle_text
        assert "Suggested next actions" in bundle_text
        assert "User approval required" in bundle_text
        assert "Investment Advisor" in bundle_text
        assert "AI Workbench Studio" in bundle_text
        assert "Quick Actions" in bundle_text
        assert "Create from one input" in bundle_text
        assert "Action Library" in bundle_text
        assert "Summarize document" in bundle_text
        assert "Kwanho Kim" in bundle_text
        assert "Chungja Byun" in bundle_text
        assert "Gunwoo Kim" in bundle_text
        assert "Workbench is thinking" in bundle_text
        assert ".workbench" in style_text
        assert ".composer" in style_text
        assert ".goal-panel" in style_text
        assert ".pdf-thumb" in style_text
        assert ".waiting-notice" in style_text
        assert ".tree-heading" in style_text
        assert ".mode-badge" in style_text
        assert ".advanced-controls" in style_text

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
        openclaw_status = request.urlopen(f"{base_url}/api/openclaw", timeout=10).read().decode("utf-8")
        assert '"openclaw"' in openclaw_status
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
                    "mime": "text/plain",
                    "size": 9,
                    "is_image": False,
                    "is_pdf": False,
                    "delivery": "Sent as text context",
                        "text_available": True,
                        "extraction_status": "success",
                        "extraction_error": "",
                        "text_preview": "file body",
                        "table_preview": {},
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
        actions_page = request.urlopen(f"{base_url}/actions", timeout=5).read().decode("utf-8")
        assert '<div id="root"></div>' in actions_page
        workspace = request.urlopen(f"{base_url}/api/workspace", timeout=5).read().decode("utf-8")
        assert '"projects": []' in workspace
        assert '"model_catalog"' in workspace
        home = json.loads(request.urlopen(f"{base_url}/api/home", timeout=5).read().decode("utf-8"))
        assert "home" in home
        assert home["home"]["message"] == "Home Workbench is ready for projectless starter actions."
        assert home["home"]["runs"] == []
        assert home["home"]["views"][0]["title"] == "Home Workbench"
        actions = json.loads(request.urlopen(f"{base_url}/api/action-library", timeout=5).read().decode("utf-8"))
        assert actions["actions"][0]["id"] == "document_summary"
        assert any(item["id"] == "investment_rebalancer" for item in actions["actions"])
        models = json.loads(request.urlopen(f"{base_url}/api/models", timeout=5).read().decode("utf-8"))
        assert any(item["value"] == "local" and item["provider"] == "ollama" for item in models["models"])
        contract = json.loads(request.urlopen(f"{base_url}/api/workbench-contract", timeout=5).read().decode("utf-8"))
        assert contract["version"] == 1
        assert contract["models"]
        assert contract["actions"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_home_starter_action_creates_run_and_artifact(tmp_path):
    root = tmp_path / "workspace"
    storage.init_workspace(root)

    handler = partial(AIWSHandler, root=str(root), require_auth=False, password=None)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    try:
        boundary = "----aiws-home-boundary"
        multipart_body = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="content"\r\n\r\n'
            "Summarize this document\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="attachment"; filename="note.md"\r\n'
            "Content-Type: text/markdown\r\n\r\n"
            "# Note\r\n\r\nImportant local workspace idea.\r\n"
            f"--{boundary}--\r\n"
        ).encode("utf-8")
        req = request.Request(
            f"{base_url}/api/home-actions/document_summary/run",
            data=multipart_body,
            method="POST",
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Accept": "application/json"},
        )
        payload = json.loads(request.urlopen(req, timeout=5).read().decode("utf-8"))
        run_id = payload["run"]["run_id"]
        artifact_path = payload["run"]["artifacts"][0]["path"]

        assert payload["run"]["status"] == "completed"
        assert payload["run"]["execution_plan"]["intent"] == "document_summary"
        assert payload["run"]["workspace_id"] == "home:local"
        assert payload["run"]["session_id"] is None
        assert payload["run"]["action_label"] == "Summarize document"
        assert payload["run"]["model"] == {"provider": "ollama", "id": "qwen3:8b", "local": True}
        assert payload["run"]["context_receipt"]["privacy_mode"] == "local"
        assert artifact_path.endswith("summary.md")

        detail = json.loads(request.urlopen(f"{base_url}/api/home-run?run_id={parse.quote(run_id)}", timeout=5).read().decode("utf-8"))
        artifact = json.loads(
            request.urlopen(f"{base_url}/api/home-artifact?path={parse.quote(artifact_path)}", timeout=5).read().decode("utf-8")
        )

        assert detail["run"]["run_id"] == run_id
        assert artifact["artifact"]["viewer_type"] == "markdownViewer"
        assert "Important local workspace idea" in artifact["artifact"]["content"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_runtime_public_payload_hides_operator_details(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    workspace = storage.workspace_path(root)
    run_dir = workspace / "run"
    run_dir.mkdir(parents=True)
    status_path = workspace / "runtime-status.json"
    status_path.write_text(
        json.dumps(
            {
                "status": "running",
                "port": 8789,
                "server_pid": 123,
                "cloudflared_pid": 456,
                "log": "/tmp/aiws.log",
                "command": "scripts/aiws-admin-dashboard.sh",
                "local_url": "http://127.0.0.1:8789/",
                "public_url": "https://ai.example.test",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("AIWS_STATUS_PATH", str(status_path))
    monkeypatch.setenv("AIWS_RUN_DIR", str(run_dir))

    payload = runtime_routes.runtime_payload(root, 8789, public_view=True)
    runtime = payload["runtime"]

    assert runtime == {
        "status": "running",
        "cloudflare_url": "https://ai.example.test",
        "public_url": "https://ai.example.test",
        "public_view": True,
        "diagnostics_visible": False,
    }


def test_csv_attachment_view_includes_table_preview(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Tables")
    storage.create_session(root, "tables", "Review")

    metadata = attachments.save_attachment(
        root,
        "tables",
        "review",
        "holdings.csv",
        b"symbol,value\nVT,12000\nBND,3000\n",
    )
    view = attachment_view("tables", "review", metadata)

    assert view["table_preview"]["columns"] == ["symbol", "value"]
    assert view["table_preview"]["rows"][0]["symbol"] == "VT"
    assert view["table_preview"]["row_count"] == 2


def test_api_ask_accepts_multiple_attachments(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_project(root, "Files")
    storage.create_session(root, "files", "Multi")
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
        allow_remote=False,
        allow_network=False,
        confirm_cost=False,
    ):
        calls["content"] = content
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
        boundary = "----aiws-multi-boundary"
        multipart_body = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="provider"\r\n\r\n'
            "ollama\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="model"\r\n\r\n'
            "qwen3:8b\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="content"\r\n\r\n'
            "Read these files\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="attachment"; filename="one.txt"\r\n'
            "Content-Type: text/plain\r\n\r\n"
            "first body\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="attachment"; filename="two.txt"\r\n'
            "Content-Type: text/plain\r\n\r\n"
            "second body\r\n"
            f"--{boundary}--\r\n"
        ).encode("utf-8")
        req = request.Request(
            f"{base_url}/api/ask/files/multi",
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

    assert "Attached file: one.txt" in calls["content"]
    assert "Attached file: two.txt" in calls["content"]
    assert len(calls["user_metadata"]["attachments"]) == 2
    assert calls["provider_attachments"] == []


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
        assert "AI Workbench Studio" in page
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
        allow_remote=False,
        allow_network=False,
        confirm_cost=False,
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
            (
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
            ).encode("utf-8")
            + b"\x89PNG\r\n\x1a\nx\r\n"
            + f"--{boundary}--\r\n".encode("utf-8")
        )
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


def test_gemini_pdf_upload_is_passed_as_inline_file(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Docs")
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
        allow_remote=False,
        allow_network=False,
        confirm_cost=False,
    ):
        calls["provider"] = provider
        calls["content"] = content
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
        boundary = "----aiws-gemini-pdf-boundary"
        multipart_body = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="provider"\r\n\r\n'
            "gemini\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="model"\r\n\r\n'
            "gemini-2.5-flash-lite\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="content"\r\n\r\n'
            "Read this PDF\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="attachment"; filename="paper.pdf"\r\n'
            "Content-Type: application/pdf\r\n\r\n"
            "%PDF-1.4\n(Hello PDF)\r\n"
            f"--{boundary}--\r\n"
        ).encode("utf-8")
        req = request.Request(
            f"{base_url}/api/ask/ai-system/docs",
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

    assert calls["provider"] == "gemini"
    assert calls["provider_attachments"][0]["kind"] == "inline_data"
    assert calls["provider_attachments"][0]["mime_type"] == "application/pdf"
    assert "Extracted attachment text" not in calls["content"]
    assert calls["user_metadata"]["attachments"][0]["delivery"] == "Sent as file input"


def test_local_image_upload_returns_clear_vision_error(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Vision")

    def fake_ask(*args, **kwargs):
        raise AssertionError("local text model should not receive image bytes")

    monkeypatch.setattr(runner, "ask", fake_ask)
    handler = partial(AIWSHandler, root=str(root), require_auth=False, password=None)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    try:
        boundary = "----aiws-local-image-boundary"
        multipart_body = (
            (
                f"--{boundary}\r\n"
                'Content-Disposition: form-data; name="provider"\r\n\r\n'
                "ollama\r\n"
                f"--{boundary}\r\n"
                'Content-Disposition: form-data; name="model"\r\n\r\n'
                "qwen3:4b\r\n"
                f"--{boundary}\r\n"
                'Content-Disposition: form-data; name="content"\r\n\r\n'
                "What is in this image?\r\n"
                f"--{boundary}\r\n"
                'Content-Disposition: form-data; name="attachment"; filename="photo.png"\r\n'
                "Content-Type: image/png\r\n\r\n"
            ).encode("utf-8")
            + b"\x89PNG\r\n\x1a\nx\r\n"
            + f"--{boundary}--\r\n".encode("utf-8")
        )
        req = request.Request(
            f"{base_url}/api/ask/ai-system/vision",
            data=multipart_body,
            method="POST",
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Accept": "application/json"},
        )
        with pytest.raises(request.HTTPError) as exc:
            request.urlopen(req, timeout=5)
        body = exc.value.read().decode("utf-8")
        assert exc.value.code == 400
        assert "Gemini" in body
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


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


def test_private_project_prompt_and_attachment_require_project_access(tmp_path):
    root = tmp_path / "workspace"
    storage.create_account(root, "Owner", "owner-secret")
    storage.create_account(root, "Other", "other-secret")
    storage.create_project(root, "Private Notes", owner="owner", visibility="private")
    storage.create_session(root, "private-notes", "Secret")
    storage.append_message(root, "private-notes", "secret", role="user", content="private", actor="owner")
    attachments.save_attachment(root, "private-notes", "secret", "note.txt", b"secret attachment", actor="owner")

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
        payload = parse.urlencode({"username": "other", "password": "other-secret", "_csrf": csrf}).encode("utf-8")
        opener.open(request.Request(f"{base_url}/login", data=payload, method="POST"), timeout=5)

        with pytest.raises(request.HTTPError) as prompt_error:
            opener.open(f"{base_url}/prompt/private-notes/secret", timeout=5)
        assert prompt_error.value.code == 404

        with pytest.raises(request.HTTPError) as attachment_error:
            opener.open(f"{base_url}/attachment/private-notes/secret/note.txt", timeout=5)
        assert attachment_error.value.code == 404

        with pytest.raises(request.HTTPError) as chat_error:
            opener.open(f"{base_url}/api/chat/private-notes/secret", timeout=5)
        assert chat_error.value.code == 404
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_automation_api_requires_admin_and_returns_projects(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_account(root, "kwanho", "secret", admin=True)
    monkeypatch.setattr(automations, "list_projects", lambda root_arg: [])

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
        opener.open(request.Request(f"{base_url}/login", data=payload, method="POST"), timeout=5)

        payload = opener.open(f"{base_url}/api/automations", timeout=5).read().decode("utf-8")

        assert '"projects": []' in payload
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_project_action_preview_and_run_api(tmp_path):
    root = tmp_path / "workspace"
    storage.create_account(root, "Admin", "secret", admin=True)
    storage.create_project(root, "Tools", owner="admin")
    storage.create_session(root, "tools", "Action Chat", slug="action-chat")
    (storage.project_dir(root, "tools") / "aiws.yaml").write_text(
        """
name: Tools
root: .
commands:
  hello:
    kind: shell
    label: Hello
    command: printf hello
""",
        encoding="utf-8",
    )

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
        login = parse.urlencode({"username": "admin", "password": "secret", "_csrf": csrf}).encode("utf-8")
        opener.open(request.Request(f"{base_url}/login", data=login, method="POST"), timeout=5)

        config = opener.open(f"{base_url}/api/project-config/tools", timeout=5).read().decode("utf-8")
        assert '"hello"' in config

        preview_body = parse.urlencode({"_csrf": csrf}).encode("utf-8")
        preview = (
            opener.open(
                request.Request(f"{base_url}/api/project-actions/tools/hello/preview", data=preview_body, method="POST"),
                timeout=5,
            )
            .read()
            .decode("utf-8")
        )
        assert '"requires_confirmation": true' in preview

        run_body = parse.urlencode({"_csrf": csrf, "confirm": "1", "session_slug": "action-chat"}).encode("utf-8")
        run = (
            opener.open(
                request.Request(f"{base_url}/api/project-actions/tools/hello/run", data=run_body, method="POST"),
                timeout=5,
            )
            .read()
            .decode("utf-8")
        )
        assert '"stdout": "hello"' in run
        run_payload = json.loads(run)
        assert run_payload["message"]["role"] == "tool"
        assert "Project action completed: Hello" in run_payload["message"]["content"]
        messages = storage.read_messages(root, "tools", "action-chat")
        assert messages[-1]["role"] == "tool"
        assert messages[-1]["metadata"]["project_action"]["command"] == "hello"

        run_id = run_payload["run"]["run_id"]
        detail = (
            opener.open(
                f"{base_url}/api/project-run?project=tools&run_id={parse.quote(run_id)}",
                timeout=5,
            )
            .read()
            .decode("utf-8")
        )
        assert '"stdout": "hello"' in detail
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
