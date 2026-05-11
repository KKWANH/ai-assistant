"""Minimal shared web UI for local and server AIWS modes."""

from __future__ import annotations

import json
import mimetypes
import os
import base64
import secrets
import time
import traceback
from functools import partial
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from . import attachments, automations, costs, openclaw
from .i18n import t
from . import runner
from . import storage

SESSION_COOKIE = "aiws_auth"
CSRF_COOKIE = "aiws_csrf"
LEGACY_SESSION_VALUE = "ok"
LOGIN_FAILURES: dict[tuple[str, str], list[float]] = {}
LOGIN_WINDOW_SECONDS = 10 * 60
LOGIN_MAX_FAILURES = 6


def validate_ui_options(mode: str, password: str | None) -> tuple[str, bool]:
    if mode == "local":
        return "127.0.0.1", False
    if mode == "server":
        if not password:
            raise storage.WorkspaceError("Server mode requires --password.")
        return "0.0.0.0", True
    raise storage.WorkspaceError("Mode must be local or server.")


class AIWSHandler(BaseHTTPRequestHandler):
    def __init__(self, *args, root: str, require_auth: bool, password: str | None, **kwargs):
        self.root = root
        self.require_auth = require_auth
        self.password = password
        self._multipart_files: dict[str, tuple[str, bytes]] = {}
        self._csrf_to_set = ""
        super().__init__(*args, **kwargs)

    def log_message(self, format: str, *args) -> None:
        return

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if self.require_auth:
            self.csrf_token()
        public_asset = path.startswith("/assets/") or path in {"/vite.svg"}
        if self.require_auth and not self.is_authenticated() and path != "/login" and not public_asset:
            self.redirect("/login")
            return
        if path == "/login":
            self.serve_spa()
        elif path == "/api/workspace":
            self.api_workspace()
        elif path == "/api/account":
            self.api_account()
        elif path == "/api/runtime":
            self.api_runtime()
        elif path == "/api/openclaw":
            self.api_openclaw()
        elif path == "/api/automations":
            self.api_automations()
        elif path.startswith("/api/goal/"):
            project_path = unquote(path.removeprefix("/api/goal/"))
            self.api_goal(project_path)
        elif path.startswith("/api/chat/"):
            parts = unquote(path.removeprefix("/api/chat/")).split("/")
            if len(parts) < 2:
                self.not_found()
            else:
                session_slug = parts[-1]
                project_path = "/".join(parts[:-1])
                self.api_chat(project_path, session_slug)
        elif path == "/":
            self.serve_spa()
        elif path == "/projects":
            self.serve_spa()
        elif path == "/projects/new":
            self.serve_spa()
        elif path == "/profile":
            self.serve_spa()
        elif path == "/admin":
            self.page("Admin", self.admin_page())
        elif path.startswith("/avatar/"):
            self.serve_avatar(unquote(path.removeprefix("/avatar/")))
        elif path.startswith("/attachment/"):
            parts = unquote(path.removeprefix("/attachment/")).split("/")
            if len(parts) < 3:
                self.not_found()
            else:
                filename = parts[-1]
                session_slug = parts[-2]
                project_path = "/".join(parts[:-2])
                self.serve_attachment(project_path, session_slug, filename)
        elif path.startswith("/chat/"):
            self.serve_spa()
        elif path.startswith("/project/"):
            self.serve_spa()
        elif path.startswith("/assets/") or path in {"/vite.svg"}:
            self.serve_static_asset(path)
        elif path.startswith("/prompt/"):
            parts = unquote(path.removeprefix("/prompt/")).split("/")
            if len(parts) < 2:
                self.not_found()
            else:
                session_slug = parts[-1]
                project_path = "/".join(parts[:-1])
                self.page("Prompt", f"<pre>{html(storage.build_prompt_context(self.root, project_path, session_slug))}</pre>")
        else:
            self.not_found()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/ask/"):
            if self.require_auth and not self.is_authenticated():
                self.send_json({"error": "Authentication required."}, status=401)
                return
            parts = unquote(parsed.path.removeprefix("/api/ask/")).split("/")
            if len(parts) < 2:
                self.send_json({"error": "Invalid chat path."}, status=404)
                return
            session_slug = parts[-1]
            project_path = "/".join(parts[:-1])
            try:
                data = self.form_data()
                self.require_csrf(data)
                self.handle_ask(project_path, session_slug, data)
                self.api_chat(project_path, session_slug)
            except storage.WorkspaceError as exc:
                self.send_json({"error": str(exc)}, status=400)
            except Exception as exc:
                self.log_internal_error("api_ask", exc)
                self.send_json(
                    {
                        "error": (
                            "PDF를 읽는 중 문제가 생겼습니다. 파일이 너무 크거나 스캔본이라 텍스트를 읽지 못했을 수 있습니다. "
                            "다시 시도하거나 다른 PDF를 올려주세요."
                        )
                    },
                    status=500,
                )
            return

        if parsed.path == "/api/logout":
            try:
                self.require_csrf({})
            except storage.WorkspaceError as exc:
                self.send_json({"error": str(exc)}, status=403)
                return
            self.send_response(303)
            self.send_header("Location", "/login")
            self.send_header("Set-Cookie", self.cookie_header(SESSION_COOKIE, "", http_only=True, max_age=0))
            self.end_headers()
            return

        if parsed.path.startswith("/api/automations/") and parsed.path.endswith("/run"):
            if self.require_auth and not self.is_authenticated():
                self.send_json({"error": "Authentication required."}, status=401)
                return
            slug = unquote(parsed.path.removeprefix("/api/automations/").removesuffix("/run"))
            try:
                data = self.form_data()
                self.require_csrf(data)
                self.require_admin()
                run = automations.run_project(self.root, slug, actor=self.current_username())
                self.send_json({"run": run, "projects": automations.list_projects(self.root)})
            except storage.WorkspaceError as exc:
                self.send_json({"error": str(exc)}, status=400)
            return

        if parsed.path.startswith("/api/sessions/"):
            if self.require_auth and not self.is_authenticated():
                self.send_json({"error": "Authentication required."}, status=401)
                return
            project_path = unquote(parsed.path.removeprefix("/api/sessions/"))
            try:
                data = self.form_data()
                self.require_csrf(data)
                if storage.has_accounts(self.root):
                    storage.ensure_project_access(self.root, project_path, self.current_username())
                title = data.get("title", "").strip() or "New chat"
                session = storage.create_session(
                    self.root,
                    project_path,
                    title,
                    slug=storage.next_available_session_slug(
                        self.root,
                        project_path,
                        storage.slugify_or_default(title, "new-chat"),
                    ),
                )
                self.send_json({"session": session})
            except storage.WorkspaceError as exc:
                self.send_json({"error": str(exc)}, status=400)
            return

        if parsed.path == "/api/chats":
            if self.require_auth and not self.is_authenticated():
                self.send_json({"error": "Authentication required."}, status=401)
                return
            try:
                data = self.form_data()
                self.require_csrf(data)
                project_path, session = storage.create_general_chat_session(
                    self.root,
                    self.current_username(),
                    data.get("title", "").strip() or "New chat",
                )
                self.send_json({"project_path": project_path, "session": session})
            except storage.WorkspaceError as exc:
                self.send_json({"error": str(exc)}, status=400)
            return

        if parsed.path.startswith("/api/session-title/"):
            if self.require_auth and not self.is_authenticated():
                self.send_json({"error": "Authentication required."}, status=401)
                return
            parts = unquote(parsed.path.removeprefix("/api/session-title/")).split("/")
            if len(parts) < 2:
                self.send_json({"error": "Invalid chat path."}, status=404)
                return
            session_slug = parts[-1]
            project_path = "/".join(parts[:-1])
            try:
                data = self.form_data()
                self.require_csrf(data)
                if storage.has_accounts(self.root):
                    storage.ensure_project_access(self.root, project_path, self.current_username())
                session = storage.update_session_title(self.root, project_path, session_slug, data.get("title", ""))
                self.send_json({"session": session})
            except storage.WorkspaceError as exc:
                self.send_json({"error": str(exc)}, status=400)
            return

        if parsed.path.startswith("/api/move-chat/"):
            if self.require_auth and not self.is_authenticated():
                self.send_json({"error": "Authentication required."}, status=401)
                return
            parts = unquote(parsed.path.removeprefix("/api/move-chat/")).split("/")
            if len(parts) < 2:
                self.send_json({"error": "Invalid chat path."}, status=404)
                return
            session_slug = parts[-1]
            source_project_path = "/".join(parts[:-1])
            try:
                data = self.form_data()
                self.require_csrf(data)
                target_project_path = data.get("target_project", "").strip()
                if not target_project_path:
                    raise storage.WorkspaceError("Target project is required.")
                username = self.current_username()
                if storage.has_accounts(self.root):
                    storage.ensure_project_access(self.root, source_project_path, username)
                    storage.ensure_project_owner(self.root, target_project_path, username)
                session = storage.move_session_to_project(self.root, source_project_path, session_slug, target_project_path)
                self.send_json({"project_path": target_project_path, "session": session})
            except storage.WorkspaceError as exc:
                self.send_json({"error": str(exc)}, status=400)
            return

        if parsed.path.startswith("/api/move-chat-out/"):
            if self.require_auth and not self.is_authenticated():
                self.send_json({"error": "Authentication required."}, status=401)
                return
            parts = unquote(parsed.path.removeprefix("/api/move-chat-out/")).split("/")
            if len(parts) < 2:
                self.send_json({"error": "Invalid chat path."}, status=404)
                return
            session_slug = parts[-1]
            source_project_path = "/".join(parts[:-1])
            try:
                data = self.form_data()
                self.require_csrf(data)
                username = self.current_username()
                if storage.has_accounts(self.root):
                    storage.ensure_project_owner(self.root, source_project_path, username)
                project_path, session = storage.move_session_to_general_chat(self.root, source_project_path, session_slug, username)
                self.send_json({"project_path": project_path, "session": session})
            except storage.WorkspaceError as exc:
                self.send_json({"error": str(exc)}, status=400)
            return

        if parsed.path.startswith("/api/delete-session/"):
            if self.require_auth and not self.is_authenticated():
                self.send_json({"error": "Authentication required."}, status=401)
                return
            parts = unquote(parsed.path.removeprefix("/api/delete-session/")).split("/")
            if len(parts) < 2:
                self.send_json({"error": "Invalid chat path."}, status=404)
                return
            session_slug = parts[-1]
            project_path = "/".join(parts[:-1])
            try:
                data = self.form_data()
                self.require_csrf(data)
                if storage.has_accounts(self.root):
                    storage.ensure_project_owner(self.root, project_path, self.current_username())
                storage.delete_session(self.root, project_path, session_slug)
                self.send_json({"ok": True})
            except storage.WorkspaceError as exc:
                self.send_json({"error": str(exc)}, status=400)
            return

        if parsed.path.startswith("/api/project-title/"):
            if self.require_auth and not self.is_authenticated():
                self.send_json({"error": "Authentication required."}, status=401)
                return
            project_path = unquote(parsed.path.removeprefix("/api/project-title/"))
            try:
                data = self.form_data()
                self.require_csrf(data)
                if storage.has_accounts(self.root):
                    storage.ensure_project_owner(self.root, project_path, self.current_username())
                project = storage.update_project_title(self.root, project_path, data.get("title", ""))
                self.send_json({"project": project})
            except storage.WorkspaceError as exc:
                self.send_json({"error": str(exc)}, status=400)
            return

        if parsed.path.startswith("/api/delete-project/"):
            if self.require_auth and not self.is_authenticated():
                self.send_json({"error": "Authentication required."}, status=401)
                return
            project_path = unquote(parsed.path.removeprefix("/api/delete-project/"))
            try:
                data = self.form_data()
                self.require_csrf(data)
                if storage.has_accounts(self.root):
                    storage.ensure_project_owner(self.root, project_path, self.current_username())
                storage.delete_project(self.root, project_path)
                self.send_json({"ok": True})
            except storage.WorkspaceError as exc:
                self.send_json({"error": str(exc)}, status=400)
            return

        if parsed.path == "/api/projects":
            if self.require_auth and not self.is_authenticated():
                self.send_json({"error": "Authentication required."}, status=401)
                return
            try:
                data = self.form_data()
                self.require_csrf(data)
                skills = [item.strip() for item in data.get("skills", "").split(",") if item.strip()]
                project = storage.create_project(
                    self.root,
                    data["title"],
                    parent=data.get("parent") or None,
                    notes=data.get("notes", ""),
                    skills=skills,
                    owner=data.get("owner") or self.current_username(),
                    visibility=data.get("visibility", "private"),
                )
                self.send_json({"project": project})
            except storage.WorkspaceError as exc:
                self.send_json({"error": str(exc)}, status=400)
            return

        if parsed.path == "/api/profile":
            if self.require_auth and not self.is_authenticated():
                self.send_json({"error": "Authentication required."}, status=401)
                return
            username = self.current_username()
            if not username or not storage.has_accounts(self.root):
                self.send_json({"error": "Profile is available after account login."}, status=400)
                return
            try:
                data = self.form_data()
                self.require_csrf(data)
                account = storage.update_account_profile(
                    self.root,
                    username,
                    name=data.get("name", ""),
                    age=data.get("age", ""),
                    job=data.get("job", ""),
                    situation=data.get("situation", ""),
                    language=data.get("language", "ko"),
                    ui_mode=data.get("ui_mode", "easy"),
                    memory=data.get("memory", ""),
                )
                avatar_upload = self._multipart_files.get("avatar")
                if avatar_upload and avatar_upload[1]:
                    storage.set_account_avatar(self.root, username, avatar_upload[0], avatar_upload[1])
                    account = storage.public_account(storage.load_account(self.root, username))
                self.send_json({"account": account})
            except storage.WorkspaceError as exc:
                self.send_json({"error": str(exc)}, status=400)
            return

        if parsed.path.startswith("/api/goal/"):
            if self.require_auth and not self.is_authenticated():
                self.send_json({"error": "Authentication required."}, status=401)
                return
            project_path = unquote(parsed.path.removeprefix("/api/goal/"))
            try:
                data = self.form_data()
                self.require_csrf(data)
                if storage.has_accounts(self.root):
                    storage.ensure_project_access(self.root, project_path, self.current_username())
                goal = storage.save_goal(
                    self.root,
                    project_path,
                    {
                        "objective": data.get("objective", ""),
                        "current_status": data.get("current_status", ""),
                        "next_actions": data.get("next_actions", ""),
                        "constraints": data.get("constraints", ""),
                        "success_criteria": data.get("success_criteria", ""),
                        "test_commands": data.get("test_commands", ""),
                    },
                )
                self.send_json({"goal": goal, "codex_prompt": storage.codex_goal_prompt(self.root, project_path)})
            except storage.WorkspaceError as exc:
                self.send_json({"error": str(exc)}, status=400)
            return

        if parsed.path == "/login":
            data = self.form_data()
            username = data.get("username", "")
            password = data.get("password", "")
            try:
                self.require_csrf(data)
            except storage.WorkspaceError:
                self.redirect("/login?error=csrf")
                return
            if self.login_is_limited(username):
                self.send_response(429)
                self.end_headers()
                self.wfile.write("Too many login attempts. Please wait and try again.".encode("utf-8"))
                return
            account = storage.authenticate_account(self.root, username, password)
            legacy_password_ok = not storage.has_accounts(self.root) and password == self.password
            if account or legacy_password_ok:
                self.clear_login_failures(username)
                cookie_value = self.signed_cookie_value(account["username"] if account else "admin")
                self.send_response(303)
                self.send_header("Location", "/")
                self.send_header("Set-Cookie", self.cookie_header(SESSION_COOKIE, cookie_value, http_only=True))
                self.end_headers()
            else:
                self.record_login_failure(username)
                self.redirect("/login?error=1")
            return

        if self.require_auth and not self.is_authenticated():
            self.redirect("/login")
            return

        data = self.form_data()
        self.require_csrf(data)
        if parsed.path == "/projects":
            skills = [item.strip() for item in data.get("skills", "").split(",") if item.strip()]
            project = storage.create_project(
                self.root,
                data["title"],
                parent=data.get("parent") or None,
                notes=data.get("notes", ""),
                skills=skills,
                owner=data.get("owner") or self.current_username(),
                visibility=data.get("visibility", "private"),
            )
            self.redirect(f"/project/{project['path']}")
        elif parsed.path.startswith("/sessions/"):
            project_path = unquote(parsed.path.removeprefix("/sessions/"))
            if storage.has_accounts(self.root):
                storage.ensure_project_access(self.root, project_path, self.current_username())
            session = storage.create_session(self.root, project_path, data["title"])
            self.redirect(f"/chat/{project_path}/{session['slug']}")
        elif parsed.path.startswith("/append/"):
            parts = unquote(parsed.path.removeprefix("/append/")).split("/")
            session_slug = parts[-1]
            project_path = "/".join(parts[:-1])
            storage.ensure_project_access(self.root, project_path, self.current_username())
            storage.append_message(
                self.root,
                project_path,
                session_slug,
                role=data["role"],
                content=data["content"],
                actor=self.current_username(),
            )
            self.redirect(f"/project/{project_path}")
        elif parsed.path.startswith("/ask/"):
            parts = unquote(parsed.path.removeprefix("/ask/")).split("/")
            session_slug = parts[-1]
            project_path = "/".join(parts[:-1])
            try:
                self.handle_ask(project_path, session_slug, data)
                self.redirect(f"/project/{project_path}")
            except storage.WorkspaceError as exc:
                self.page("Ask Failed", self.error_page("Ask failed", str(exc), f"/project/{project_path}"))
        elif parsed.path.startswith("/upload/"):
            parts = unquote(parsed.path.removeprefix("/upload/")).split("/")
            session_slug = parts[-1]
            project_path = "/".join(parts[:-1])
            storage.ensure_project_access(self.root, project_path, self.current_username())
            try:
                filename, content = self.multipart_file("attachment")
                attachments.save_attachment(
                    self.root,
                    project_path,
                    session_slug,
                    filename,
                    content,
                    actor=self.current_username(),
                )
                self.redirect(f"/project/{project_path}")
            except storage.WorkspaceError as exc:
                self.page("Upload Failed", self.error_page("Upload failed", str(exc), f"/project/{project_path}"))
        elif parsed.path == "/profile":
            username = self.current_username()
            if not username:
                self.redirect("/login")
                return
            storage.update_account_profile(
                self.root,
                username,
                name=data.get("name", ""),
                age=data.get("age", ""),
                job=data.get("job", ""),
                situation=data.get("situation", ""),
                language=data.get("language", "ko"),
                memory=data.get("memory", ""),
            )
            self.redirect("/profile")
        elif parsed.path == "/profile/avatar":
            username = self.current_username()
            if not username:
                self.redirect("/login")
                return
            try:
                filename, content = self.multipart_file("avatar")
                storage.set_account_avatar(self.root, username, filename, content)
                self.redirect("/profile")
            except storage.WorkspaceError as exc:
                self.page("Avatar Failed", self.error_page("Avatar failed", str(exc), "/profile"))
        else:
            self.not_found()

    def form_data(self) -> dict[str, str]:
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" in content_type:
            fields, files = self.multipart_form()
            self._multipart_files = files
            return fields
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        parsed = parse_qs(raw)
        return {key: values[0] for key, values in parsed.items()}

    def multipart_form(self) -> tuple[dict[str, str], dict[str, tuple[str, bytes]]]:
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type or "boundary=" not in content_type:
            raise storage.WorkspaceError("Expected multipart form upload.")
        boundary = content_type.split("boundary=", 1)[1].encode("utf-8")
        length = int(self.headers.get("Content-Length", "0"))
        if length > 36 * 1024 * 1024:
            raise storage.WorkspaceError("Upload is too large.")
        body = self.rfile.read(length)
        fields: dict[str, str] = {}
        files: dict[str, tuple[str, bytes]] = {}
        for part in body.split(b"--" + boundary):
            if b"\r\n\r\n" not in part:
                continue
            headers, content = part.split(b"\r\n\r\n", 1)
            content = content.removesuffix(b"\r\n").removesuffix(b"--")
            name = re_search_header_value(headers, b'name="')
            if not name:
                continue
            filename = re_search_filename(headers)
            if filename:
                files[name] = (filename, content)
            else:
                fields[name] = content.decode("utf-8", errors="replace")
        return fields, files

    def multipart_file(self, field_name: str) -> tuple[str, bytes]:
        if field_name in self._multipart_files:
            return self._multipart_files[field_name]
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type or "boundary=" not in content_type:
            raise storage.WorkspaceError("Expected multipart form upload.")
        boundary = content_type.split("boundary=", 1)[1].encode("utf-8")
        length = int(self.headers.get("Content-Length", "0"))
        if length > 3 * 1024 * 1024:
            raise storage.WorkspaceError("Upload is too large.")
        body = self.rfile.read(length)
        for part in body.split(b"--" + boundary):
            if b"\r\n\r\n" not in part:
                continue
            headers, content = part.split(b"\r\n\r\n", 1)
            if f'name="{field_name}"'.encode("utf-8") not in headers:
                continue
            match = re_search_filename(headers)
            if not match:
                raise storage.WorkspaceError("Upload must include a filename.")
            filename = match
            content = content.removesuffix(b"\r\n")
            content = content.removesuffix(b"--")
            return filename, content
        raise storage.WorkspaceError("No avatar file found.")

    def handle_ask(self, project_path: str, session_slug: str, data: dict[str, str]) -> None:
        if storage.has_accounts(self.root):
            storage.ensure_project_access(self.root, project_path, self.current_username())
        visible_content = data.get("content", "").strip()
        model_content = visible_content
        user_metadata: dict[str, object] = {}
        provider_attachments: list[dict[str, str]] = []
        upload = self._multipart_files.get("attachment")
        if upload and upload[1]:
            filename, file_content = upload
            provider_name = data.get("provider", "ollama")
            extension = attachments.validate_attachment(filename, file_content)
            delivery = "vision" if attachments.is_image_extension(extension) and provider_name == "kimi" else None
            saved = attachments.save_attachment(
                self.root,
                project_path,
                session_slug,
                filename,
                file_content,
                actor=self.current_username(),
                delivery=delivery,
            )
            attachment = attachment_view(project_path, session_slug, saved)
            if attachments.is_image_extension(extension) and provider_name == "kimi":
                data_url = "data:%s;base64,%s" % (
                    attachments.image_mime_type(extension),
                    base64.b64encode(file_content).decode("ascii"),
                )
                provider_attachments.append({"kind": "image_data_url", "data_url": data_url})
                attachment["delivery"] = "Sent as vision input"
            elif str(saved.get("text", "")).strip() and not attachments.is_image_extension(extension):
                attachment["delivery"] = "Sent as text context"
            else:
                attachment["delivery"] = "Attached to chat"
            user_metadata["attachments"] = [attachment]
            extracted = "" if provider_attachments else str(saved.get("text", "")).strip()
            attachment_context = f"Attached file: {saved['filename']}"
            if extracted:
                attachment_context += f"\n\nExtracted attachment text:\n{extracted[:8000]}"
            model_content = f"{visible_content}\n\n{attachment_context}".strip()
        if not model_content:
            raise storage.WorkspaceError("Message or attachment is required.")
        runner.ask(
            self.root,
            project_path,
            session_slug,
            provider=data.get("provider", "ollama"),
            model=data.get("model", "qwen3:0.6b"),
            content=model_content,
            stored_content=visible_content or "Attached file",
            user_metadata=user_metadata,
            provider_attachments=provider_attachments,
            actor=self.current_username(),
            search_mode=data.get("search_mode", "off"),
            allow_remote=data.get("allow_remote") in {"1", "true", "yes"},
            confirm_cost=data.get("confirm_cost") in {"1", "true", "yes"},
        )
        if visible_content:
            storage.maybe_update_default_session_title(self.root, project_path, session_slug, visible_content)

    def api_chat(self, project_path: str, session_slug: str) -> None:
        try:
            if storage.has_accounts(self.root):
                storage.ensure_project_access(self.root, project_path, self.current_username())
            project = storage.load_project(self.root, project_path)
            session = storage.load_session(self.root, project_path, session_slug)
            messages = storage.read_messages(self.root, project_path, session_slug)
            self.send_json(
                {
                    "project": {
                        "path": project_path,
                        "title": project["title"],
                        "hidden": bool(project.get("hidden", False)),
                        "visibility": project.get("visibility", "private"),
                    },
                    "session": {"slug": session_slug, "title": session["title"]},
                    "messages": [self.message_json(message) for message in messages],
                    "skills": storage.resolve_skill_names(self.root, project_path),
                    "attachments": [
                        attachment_view(project_path, session_slug, item)
                        for item in attachments.list_attachments(self.root, project_path, session_slug)
                    ],
                    "goal": storage.load_goal(self.root, project_path),
                    "codex_prompt": storage.codex_goal_prompt(self.root, project_path, session_slug),
                    "latest": latest_assistant_metadata(messages),
                }
            )
        except storage.WorkspaceError as exc:
            self.send_json({"error": str(exc)}, status=404)

    def api_workspace(self) -> None:
        try:
            projects = storage.list_visible_projects(self.root, self.current_username()) if storage.has_accounts(self.root) else storage.list_projects(self.root)
            chats = storage.list_visible_general_chat_projects(self.root, self.current_username())
            self.send_json(
                {
                    "projects": [self.project_json(project) for project in projects if not project.get("hidden")],
                    "chats": [self.project_json(project) for project in chats],
                    "account": self.current_account_json(),
                }
            )
        except storage.WorkspaceError as exc:
            self.send_json({"error": str(exc)}, status=400)

    def api_account(self) -> None:
        self.send_json({"account": self.current_account_json()})

    def api_goal(self, project_path: str) -> None:
        try:
            if storage.has_accounts(self.root):
                storage.ensure_project_access(self.root, project_path, self.current_username())
            self.send_json(
                {
                    "goal": storage.load_goal(self.root, project_path),
                    "codex_prompt": storage.codex_goal_prompt(self.root, project_path),
                }
            )
        except storage.WorkspaceError as exc:
            self.send_json({"error": str(exc)}, status=404)

    def api_runtime(self) -> None:
        workspace = storage.workspace_path(self.root)
        run_dir = Path(os.environ.get("AIWS_RUN_DIR", str(workspace / "run"))).expanduser()
        status_path = Path(os.environ.get("AIWS_STATUS_PATH", str(workspace / "runtime-status.json"))).expanduser()
        url_path = run_dir / "cloudflare-url.txt"
        status: dict[str, object] = {"status": "unknown", "cloudflare_url": "", "port": self.server.server_port}
        if status_path.exists():
            try:
                loaded = json.loads(status_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    status.update(loaded)
            except json.JSONDecodeError:
                status["message"] = "Runtime status file is not valid JSON."
        if url_path.exists():
            status["cloudflare_url"] = url_path.read_text(encoding="utf-8").strip()
        self.send_json({"runtime": status})

    def api_openclaw(self) -> None:
        self.send_json({"openclaw": openclaw.status()})

    def api_automations(self) -> None:
        try:
            self.require_admin()
            self.send_json({"projects": automations.list_projects(self.root)})
        except storage.WorkspaceError as exc:
            self.send_json({"error": str(exc)}, status=403)

    def log_internal_error(self, area: str, exc: Exception) -> None:
        log_dir = storage.workspace_path(self.root) / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        with (log_dir / "ui-errors.log").open("a", encoding="utf-8") as file:
            file.write(f"[{storage.utc_now()}] {area}: {type(exc).__name__}: {exc}\n")
            file.write(traceback.format_exc())
            file.write("\n")

    def current_account_json(self) -> dict[str, object]:
        username = self.current_username()
        if username and storage.has_accounts(self.root):
            try:
                account = storage.public_account(storage.load_account(self.root, username))
                avatar = account.get("profile", {}).get("avatar") if isinstance(account.get("profile"), dict) else ""
                if avatar:
                    account["avatar_url"] = f"/avatar/{username}"
                return account
            except storage.WorkspaceError:
                pass
        username = username or "local"
        nickname = storage.display_name_for_username(username)
        return {
            "username": username,
            "nickname": nickname,
            "display_name": nickname,
            "admin": False,
            "profile": {"name": nickname, "ui_mode": "power"},
        }

    def require_admin(self) -> None:
        if not storage.has_accounts(self.root):
            return
        if not storage.is_admin(self.root, self.current_username()):
            raise storage.WorkspaceError("Admin access is required.")

    def project_json(self, project: dict[str, object]) -> dict[str, object]:
        project_path = str(project["path"])
        sessions = storage.list_sessions(self.root, project_path)
        first_session_url = f"/chat/{project_path}/{sessions[0]['slug']}" if sessions else ""
        return {
            "path": project_path,
            "title": project.get("title", project_path),
            "created_at": project.get("created_at", ""),
            "parent": project.get("parent", ""),
            "level": 1 if project.get("parent") else 0,
            "owner": project.get("owner", ""),
            "owner_display": storage.display_name_for_username(str(project.get("owner", "") or "local")),
            "visibility": project.get("visibility", "private"),
            "hidden": bool(project.get("hidden", False)),
            "firstSessionUrl": first_session_url,
            "sessions": [
                {
                    "slug": session["slug"],
                    "title": session["title"],
                    "created_at": session.get("created_at", ""),
                }
                for session in sessions
            ],
        }

    def serve_spa(self) -> None:
        index = web_dist_path() / "index.html"
        if not index.exists():
            self.page("Assistant", '<div id="root"></div><p>Build the React UI with <code>cd web && npm run build</code>.</p>')
            return
        self.serve_file(index, "text/html; charset=utf-8")

    def serve_static_asset(self, path: str) -> None:
        dist = web_dist_path()
        target = (dist / path.removeprefix("/")).resolve()
        if not str(target).startswith(str(dist.resolve())) or not target.exists() or not target.is_file():
            self.not_found()
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.serve_file(target, content_type)

    def serve_file(self, path: Path, content_type: str) -> None:
        content = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def send_json(self, payload: dict[str, object], *, status: int = 200) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def is_authenticated(self) -> bool:
        if not self.require_auth:
            return True
        return self.current_username() is not None

    def current_username(self) -> str | None:
        header = self.headers.get("Cookie", "")
        jar = cookies.SimpleCookie(header)
        morsel = jar.get(SESSION_COOKIE)
        if not morsel:
            return None
        value = morsel.value
        if value == LEGACY_SESSION_VALUE and not storage.has_accounts(self.root):
            return "admin"
        try:
            username, signature = value.split(".", 1)
        except ValueError:
            return None
        expected = self.sign_username(username)
        if not hmac.compare_digest(signature, expected):
            return None
        return username

    def signed_cookie_value(self, username: str) -> str:
        return f"{username}.{self.sign_username(username)}"

    def sign_username(self, username: str) -> str:
        secret = storage.load_config(self.root)["auth_secret"]
        return hmac.new(secret.encode("utf-8"), username.encode("utf-8"), "sha256").hexdigest()

    def redirect(self, location: str) -> None:
        self.send_response(303)
        self.send_header("Location", location)
        self.end_headers()

    def page(self, title: str, body: str, *, layout: str = "app") -> None:
        language = self.language()
        body_class = "chat-body" if layout == "chat" else ""
        if layout == "chat":
            nav_links = f'<a href="/profile">{html(t(language, "profile"))}</a>{self.admin_link()}'
        else:
            nav_links = (
                f'<a href="/">{html(t(language, "home"))}</a>'
                f'<a href="/projects">{html(t(language, "projects"))}</a>'
                f'<a href="/projects/new">{html(t(language, "create_project"))}</a>'
                f'<a href="/profile">{html(t(language, "profile"))}</a>{self.admin_link()}'
            )
        html_body = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html(title)}</title>
  <style>
    :root {{
      color-scheme: dark;
      --desk-bg: #15100d;
      --desk-grain: rgba(255, 255, 255, .024);
      --paper: #f1e3c7;
      --paper-warm: #dfc99f;
      --paper-edge: #9e7e4e;
      --ink: #241b14;
      --muted-ink: #6e5c48;
      --leather: #17100e;
      --leather-dark: #090706;
      --brass: #c49a43;
      --brass-dark: #7d5a22;
      --graphite: #111820;
      --glass: rgba(42, 35, 28, .64);
      --highlight: rgba(255, 247, 218, .55);
      --border: rgba(137, 105, 59, .36);
      --muted: #b8a98d;
      --soft: #f2e8d4;
      --blue: #91b7ff;
      --green: #64c98e;
      --green-2: #2e8153;
      --danger: #d06a62;
      --radius-card: 18px;
      --radius-button: 13px;
      --shadow-low: 0 3px 8px rgba(0, 0, 0, .24), inset 0 1px 0 rgba(255,255,255,.08);
      --shadow-mid: 0 14px 32px rgba(0, 0, 0, .34), inset 0 1px 0 rgba(255,255,255,.12);
      --shadow-high: 0 28px 70px rgba(0, 0, 0, .44), inset 0 1px 0 rgba(255,255,255,.14);
      --inner-shadow: inset 0 2px 8px rgba(0, 0, 0, .32), inset 0 1px 0 rgba(255,255,255,.08);
      --bg: var(--desk-bg);
      --surface: #211915;
      --surface-2: #f0dfbd;
      --surface-3: #241c16;
      --shadow: var(--shadow-mid);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      min-height: 100vh;
      margin: 0;
      color: var(--soft);
      background:
        radial-gradient(circle at 18% 0%, rgba(255, 225, 160, .18), transparent 28rem),
        radial-gradient(circle at 80% 18%, rgba(95, 65, 28, .16), transparent 30rem),
        repeating-linear-gradient(104deg, transparent 0 14px, var(--desk-grain) 15px 16px),
        linear-gradient(140deg, #201712 0%, #0e0b09 54%, #17100d 100%);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
    }}
    body.chat-body {{ overflow: hidden; height: 100vh; }}
    header {{
      position: sticky;
      top: 0;
      z-index: 10;
      border-bottom: 1px solid rgba(255, 255, 255, .08);
      background: linear-gradient(180deg, rgba(26, 18, 14, .94), rgba(12, 9, 7, .9));
      backdrop-filter: blur(18px);
      box-shadow: var(--shadow-low);
    }}
    nav {{ max-width: none; margin: 0; padding: 10px 16px; display: flex; gap: 8px; align-items: center; flex-wrap: nowrap; }}
    .brand {{ margin-right: auto; color: var(--ink); text-decoration: none; font-weight: 900; font-size: 15px; letter-spacing: 0; }}
    nav a {{ color: var(--soft); text-decoration: none; font-weight: 700; padding: 7px 9px; border-radius: 999px; }}
    nav a:hover {{ background: rgba(255, 255, 255, .08); color: #fff; }}
    main {{ max-width: 1180px; margin: 0 auto; padding: 30px 20px 52px; }}
    .chat-body main {{ max-width: none; height: calc(100vh - 45px); padding: 0; overflow: hidden; }}
    h1 {{ margin: 0 0 10px; font-size: clamp(28px, 4vw, 44px); line-height: 1.08; }}
    h2 {{ margin-top: 30px; font-size: 22px; }}
    h3 {{ margin: 0 0 8px; }}
    h4 {{ margin: 18px 0 8px; }}
    a {{ color: var(--blue); }}
    input, textarea, select {{
      width: 100%;
      padding: 11px 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: rgba(12, 10, 8, .72);
      color: var(--soft);
      font: inherit;
      outline: none;
      box-shadow: var(--inner-shadow);
    }}
    input:focus, textarea:focus, select:focus {{ border-color: rgba(114, 167, 255, .8); box-shadow: 0 0 0 3px rgba(114, 167, 255, .16); }}
    textarea {{ min-height: 112px; resize: vertical; }}
    button {{
      padding: 10px 16px;
      border: 1px solid rgba(255, 232, 165, .28);
      border-radius: var(--radius-button);
      background: linear-gradient(180deg, #d6ae57, #986d25);
      color: #19110b;
      font-weight: 800;
      cursor: pointer;
      box-shadow: var(--shadow-low);
    }}
    button:active, .physical-button:active {{ transform: translateY(1px); box-shadow: var(--inner-shadow); }}
    pre {{ white-space: pre-wrap; background: #0d131b; color: var(--soft); padding: 16px; overflow: auto; border: 1px solid var(--border); border-radius: 12px; }}
    code {{ background: rgba(255, 255, 255, .08); color: var(--soft); padding: 2px 5px; border-radius: 5px; }}
    label {{ display: block; font-weight: 800; margin-bottom: 7px; color: var(--soft); }}
    .muted {{ color: var(--muted); }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }}
    .surface, .panel {{ border: 1px solid var(--border); border-radius: var(--radius-card); padding: 18px; background: linear-gradient(155deg, rgba(255,239,203,.08), rgba(39,27,20,.78)); box-shadow: var(--shadow-mid); }}
    .desk-panel {{ border: 1px solid rgba(255, 230, 176, .16); border-radius: 24px; background: linear-gradient(145deg, rgba(42,29,21,.84), rgba(13,10,8,.9)); box-shadow: var(--shadow-high); }}
    .leather-rail {{ background: radial-gradient(circle at 12% 0%, rgba(255,226,174,.09), transparent 15rem), repeating-linear-gradient(70deg, rgba(255,255,255,.025) 0 1px, transparent 1px 7px), linear-gradient(180deg, #1b1210, #080706); }}
    .paper-surface {{ background: linear-gradient(145deg, #f6e8ca, #ddc596); color: var(--ink); border-color: rgba(110,82,40,.34); box-shadow: var(--shadow-mid); }}
    .graphite-surface {{ background: linear-gradient(145deg, #18212b, #0c1117); color: var(--soft); box-shadow: var(--inner-shadow); }}
    .workbench-panel {{ border-left: 1px solid rgba(255, 230, 176, .18); background: linear-gradient(160deg, rgba(55,45,35,.72), rgba(21,17,14,.86)); backdrop-filter: blur(18px); box-shadow: inset 1px 0 0 rgba(255,255,255,.08); overflow: auto; padding: 16px; }}
    .workbench-section {{ margin-bottom: 14px; }}
    .workbench-section h3, .section-label {{ margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }}
    .workbench-tabs {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 12px; }}
    .workbench-tabs button {{ padding: 7px 6px; font-size: 12px; color: var(--soft); background: rgba(255,255,255,.05); border-color: rgba(255,255,255,.08); }}
    .workbench-tabs button.active {{ background: linear-gradient(180deg, #e4bd62, #9f7228); color: #1b1209; box-shadow: var(--inner-shadow); }}
    .physical-button {{ background: linear-gradient(180deg, rgba(255,248,224,.12), rgba(0,0,0,.18)); border: 1px solid var(--border); border-radius: var(--radius-button); box-shadow: var(--shadow-low); }}
    .brass-button {{ background: linear-gradient(180deg, #e4bd62, #9f7228); color: #1b1209; }}
    .inset-field {{ box-shadow: var(--inner-shadow); background: rgba(10,8,7,.62); }}
    .toolbar {{ display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0; }}
    .button-link {{ display: inline-block; padding: 10px 14px; border-radius: 999px; background: var(--green-2); color: #fff; text-decoration: none; font-weight: 800; }}
    .secondary {{ background: rgba(255, 255, 255, .06); color: var(--soft); border: 1px solid var(--border); }}
    .form-grid {{ display: grid; grid-template-columns: 1fr 180px; gap: 10px; align-items: end; }}
    .field {{ margin-bottom: 12px; }}
    .pill {{ display: inline-block; padding: 4px 9px; border: 1px solid var(--border); border-radius: 999px; margin: 0 4px 4px 0; background: rgba(255, 255, 255, .06); font-size: 13px; }}
    .message-row {{ display: flex; margin: 16px 0; }}
    .message-row.user {{ justify-content: flex-end; }}
    .message-row.assistant, .message-row.system, .message-row.tool {{ justify-content: flex-start; }}
    .message {{
      max-width: min(760px, 82%);
      padding: 13px 15px;
      border: 1px solid var(--border);
      border-radius: 18px;
      background: linear-gradient(145deg, #f4e6c8, #ddc493);
      color: var(--ink);
      overflow-wrap: anywhere;
      box-shadow: var(--shadow-mid);
    }}
    .message.user {{ background: linear-gradient(145deg, #efe0bb, #cfae72); border-color: rgba(159,114,40,.52); border-bottom-right-radius: 5px; }}
    .message.assistant {{ background: linear-gradient(145deg, #fff0ce, #e2c791); border-bottom-left-radius: 5px; }}
    .message.system, .message.tool {{ background: linear-gradient(145deg, #1b242e, #0d1218); color: var(--soft); }}
    .message-role {{ font-weight: 900; text-transform: uppercase; font-size: 11px; letter-spacing: .06em; color: rgba(83, 60, 29, .72); margin-bottom: 4px; }}
    .message.system .message-role, .message.tool .message-role {{ color: var(--muted); }}
    .error {{ border-color: rgba(255, 107, 122, .7); background: rgba(255, 107, 122, .08); }}
    .cost-note {{ font-size: 13px; color: var(--muted); margin-top: -6px; }}
    table {{ border-collapse: collapse; width: 100%; }}
    th, td {{ border-bottom: 1px solid var(--border); padding: 8px; text-align: left; }}
    .hero {{ display: flex; justify-content: space-between; gap: 20px; align-items: end; margin-bottom: 22px; }}
    .hero p {{ max-width: 720px; }}
    .session-list {{ display: grid; gap: 12px; }}
    .session-card {{ display: block; color: var(--ink); text-decoration: none; border: 1px solid var(--border); border-radius: 16px; padding: 16px; background: rgba(16, 23, 32, .82); }}
    .session-card:hover {{ border-color: rgba(114, 167, 255, .55); background: rgba(21, 31, 44, .96); }}
    .chat-shell {{ height: 100%; min-height: 0; display: grid; grid-template-columns: 312px minmax(0, 1fr) 340px; position: relative; }}
    .sidebar-toggle {{ position: absolute; opacity: 0; pointer-events: none; }}
    .sidebar-button {{ display: inline-grid; place-items: center; width: 34px; height: 34px; border: 1px solid var(--border); border-radius: 10px; background: rgba(255, 255, 255, .06); color: var(--soft); cursor: pointer; }}
    .chat-sidebar {{ min-height: 0; border-right: 1px solid var(--border); padding: 14px; overflow: auto; }}
    .chat-sidebar.leather-rail {{ background: radial-gradient(circle at 18% 0%, rgba(255,226,174,.1), transparent 18rem), repeating-linear-gradient(78deg, rgba(255,255,255,.03) 0 1px, transparent 1px 8px), linear-gradient(180deg, #1b1210, #070605); }}
    .chat-sidebar-top {{ display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }}
    .chat-sidebar h2 {{ margin: 0; font-size: 17px; flex: 1; }}
    .tree-group {{ margin: 8px 0 10px; }}
    .folder-card, .tree-project {{ display: block; position: relative; padding: 11px 12px; border-radius: 12px; color: #fff; text-decoration: none; font-weight: 800; background: linear-gradient(145deg, rgba(70,47,31,.92), rgba(31,22,17,.92)); border: 1px solid rgba(255, 226, 174, .15); box-shadow: var(--shadow-low); }}
    .folder-card::before, .tree-project::before {{ content: ""; position: absolute; top: -7px; left: 14px; width: 72px; height: 10px; border-radius: 8px 8px 0 0; background: linear-gradient(180deg, #9f7435, #5b3d21); border: 1px solid rgba(255,226,174,.18); border-bottom: 0; }}
    .tree-subproject {{ display: block; padding: 9px 10px 9px 24px; border-radius: 12px; color: var(--soft); text-decoration: none; background: rgba(255,255,255,.035); }}
    .tree-project.active, .tree-subproject.active, .tree-session.active {{ background: var(--surface-2); }}
    .session-slip, .tree-session {{ display: block; padding: 9px 10px 9px 36px; border-radius: 12px; color: var(--soft); text-decoration: none; background: linear-gradient(145deg, rgba(244,224,184,.08), rgba(255,255,255,.025)); border: 1px solid transparent; }}
    .tree-date {{ display: block; margin-top: 1px; color: var(--muted); font-size: 12px; font-weight: 500; }}
    .tree-project:hover, .tree-subproject:hover, .tree-session:hover {{ filter: brightness(1.08); border-color: rgba(228,189,98,.28); }}
    .sidebar-actions {{ display: grid; gap: 8px; margin: 10px 0 16px; }}
    .sidebar-actions details {{ border: 1px solid var(--border); border-radius: 12px; background: rgba(255,255,255,.04); padding: 10px; }}
    .sidebar-actions summary {{ cursor: pointer; font-weight: 800; color: var(--soft); }}
    .sidebar-actions input, .sidebar-actions textarea, .sidebar-actions select {{ margin-top: 8px; padding: 8px 9px; font-size: 14px; }}
    .sidebar-actions button {{ width: 100%; margin-top: 8px; padding: 8px 10px; }}
    .project-filter {{ margin: 8px 0 12px; }}
    .sidebar-toggle:checked ~ .chat-sidebar {{ display: none; }}
    .sidebar-toggle:checked ~ .chat-main {{ grid-column: 1 / -1; }}
    .chat-main {{ min-width: 0; min-height: 0; height: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: linear-gradient(145deg, rgba(29,20,15,.62), rgba(9,8,7,.68)); }}
    .home-shell .chat-main {{ display: grid; place-items: center; }}
    .home-start {{ text-align: center; max-width: 760px; padding: 24px; }}
    .home-start h1 {{ font-size: clamp(30px, 5vw, 46px); }}
    .chat-top {{ padding: 14px 20px; border-bottom: 1px solid var(--border); background: linear-gradient(180deg, rgba(45,31,22,.76), rgba(19,14,11,.76)); display: flex; gap: 12px; align-items: center; }}
    .chat-title {{ min-width: 0; }}
    .chat-top h1 {{ font-size: clamp(22px, 3vw, 34px); margin-bottom: 4px; }}
    .chat-feed {{ min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 22px 24px; scroll-behavior: smooth; }}
    .empty-chat {{ min-height: 42vh; display: grid; place-items: center; text-align: center; color: var(--muted); }}
    .composer {{ border-top: 1px solid var(--border); background: linear-gradient(180deg, rgba(20,15,12,.96), rgba(10,8,7,.98)); padding: 12px 18px 14px; z-index: 3; }}
    .composer-panel {{ max-width: 920px; margin: 0 auto; border: 1px solid var(--border); border-radius: 20px; padding: 12px; background: linear-gradient(145deg, #e9d5aa, #b89152); box-shadow: var(--shadow-high); }}
    .composer-panel textarea {{ color: var(--ink); background: linear-gradient(145deg, #fff0ce, #e7cfa0); border-radius: 14px; }}
    .composer textarea {{ min-height: 74px; border: 0; background: transparent; box-shadow: none; padding: 8px; }}
    .composer-actions {{ display: grid; grid-template-columns: auto 1fr 150px 132px auto; gap: 10px; align-items: center; }}
    .attach-button {{ display: inline-grid; place-items: center; width: 42px; height: 42px; border-radius: 12px; border: 1px solid var(--border); background: rgba(255,255,255,.06); color: var(--soft); cursor: pointer; font-weight: 900; }}
    .file-input {{ position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }}
    .file-chip {{ min-height: 20px; color: var(--muted); font-size: 13px; padding: 0 8px 8px; }}
    .composer-preview {{ display: inline-flex; gap: 8px; align-items: center; padding: 6px 8px; border: 1px solid var(--border); border-radius: 12px; background: rgba(255,255,255,.05); }}
    .composer-preview img {{ width: 52px; height: 52px; border-radius: 10px; object-fit: cover; border: 1px solid rgba(255,255,255,.12); }}
    .composer-preview.file-only {{ display: inline-block; }}
    .remove-attachment {{ width: 26px; height: 26px; border-radius: 999px; padding: 0; border-color: var(--border); background: rgba(255,255,255,.08); color: var(--soft); line-height: 1; }}
    .attachment-preview, .attachment-file {{ display: block; margin-top: 10px; color: var(--soft); text-decoration: none; }}
    .attachment-preview {{ padding: 0; border: 0; background: transparent; cursor: zoom-in; text-align: left; }}
    .attachment-preview img {{ display: block; max-width: min(420px, 100%); max-height: 320px; border-radius: 14px; border: 1px solid rgba(255,255,255,.14); object-fit: contain; background: #05080d; }}
    .attachment-preview span, .attachment-file {{ font-size: 13px; color: var(--muted); }}
    button:disabled {{ opacity: .58; cursor: progress; }}
    .typing {{ display: inline-flex; gap: 5px; align-items: center; height: 22px; }}
    .typing span {{ width: 7px; height: 7px; border-radius: 999px; background: var(--muted); animation: typing-pulse 1s infinite ease-in-out; }}
    .typing span:nth-child(2) {{ animation-delay: .16s; }}
    .typing span:nth-child(3) {{ animation-delay: .32s; }}
    @keyframes typing-pulse {{ 0%, 80%, 100% {{ opacity: .28; transform: translateY(0); }} 40% {{ opacity: 1; transform: translateY(-4px); }} }}
    .drop-overlay {{ position: fixed; inset: 0; z-index: 100; display: none; place-items: center; background: rgba(4, 8, 13, .78); border: 3px dashed rgba(114, 167, 255, .7); color: #fff; font-size: clamp(22px, 5vw, 44px); font-weight: 900; }}
    body.dragging .drop-overlay {{ display: grid; }}
    .image-lightbox {{ position: fixed; inset: 0; display: none; place-items: center; z-index: 120; padding: 28px; background: rgba(0,0,0,.82); }}
    .image-lightbox.open {{ display: grid; }}
    .image-lightbox img {{ max-width: min(96vw, 1200px); max-height: 86vh; object-fit: contain; border-radius: 16px; box-shadow: var(--shadow); }}
    .image-lightbox button {{ position: fixed; top: 18px; right: 18px; width: 42px; height: 42px; border-radius: 999px; padding: 0; background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.2); }}
    .status-lamp {{ display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: var(--green); box-shadow: 0 0 12px rgba(100,201,142,.8); margin-right: 6px; }}
    .skill-card {{ display: block; padding: 9px 10px; margin: 6px 0; border-radius: 12px; background: linear-gradient(145deg, #eddbb5, #caa66d); color: var(--ink); border: 1px solid rgba(104,74,31,.28); box-shadow: var(--shadow-low); font-weight: 800; }}
    .context-strip {{ display: flex; flex-wrap: wrap; gap: 7px; margin-top: 8px; }}
    .status-chip {{ display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 999px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.09); color: var(--muted); font-size: 12px; }}
    .archive-hint {{ display: block; padding: 8px 9px; border-radius: 12px; background: rgba(0,0,0,.18); border: 1px solid rgba(255,255,255,.08); color: var(--muted); font-size: 12px; }}
    .code-block {{ background: linear-gradient(145deg, #131b23, #070a0d); color: #e6edf5; border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 12px; overflow: auto; box-shadow: var(--inner-shadow); }}
    @media (prefers-reduced-motion: reduce) {{ * {{ animation: none !important; transition: none !important; }} }}
    .compact-form {{ display: flex; gap: 10px; align-items: end; }}
    @media (max-width: 860px) {{
      body.chat-body {{ overflow: hidden; }}
      main {{ padding: 20px 14px 38px; }}
      .hero {{ display: block; }}
      .form-grid, .composer-actions {{ grid-template-columns: 1fr; }}
      .chat-body main {{ height: calc(100vh - 89px); min-height: 0; padding: 0; }}
      .chat-shell {{ grid-template-columns: 1fr; }}
      .chat-sidebar {{ display: none; position: absolute; inset: 0 auto 0 0; width: min(86vw, 330px); z-index: 8; box-shadow: var(--shadow); }}
      .workbench-panel {{ display: none; }}
      .sidebar-toggle:checked ~ .chat-sidebar {{ display: block; }}
      .sidebar-toggle:checked ~ .chat-main {{ grid-column: auto; }}
      .chat-main {{ min-height: 0; }}
      .chat-feed {{ padding: 16px 12px; }}
      .message {{ max-width: 92%; }}
      nav {{ padding: 10px 12px; }}
      nav strong {{ width: auto; margin-right: auto; }}
      nav a[href="/projects"], nav a[href="/projects/new"] {{ display: none; }}
    }}
  </style>
  <script>
    document.addEventListener("DOMContentLoaded", () => {{
      const body = document.body;
      const fileInput = document.querySelector("[data-attachment-input]");
      const fileChip = document.querySelector("[data-file-chip]");
      const feed = document.querySelector(".chat-feed");
      const composer = document.querySelector(".composer");
      const textarea = composer ? composer.querySelector("textarea") : null;
      const lightbox = document.querySelector("[data-lightbox]");
      const lightboxImage = document.querySelector("[data-lightbox-image]");
      const quickSearch = document.querySelector("[data-project-filter]");
      const workbenchTabs = document.querySelectorAll("[data-workbench-tab]");
      const workbenchPanels = document.querySelectorAll("[data-workbench-panel]");
      let sending = false;
      let previewUrl = null;
      if (feed) feed.scrollTop = feed.scrollHeight;
      function autosize() {{
        if (!textarea) return;
        textarea.style.height = "auto";
        textarea.style.height = Math.min(textarea.scrollHeight, 210) + "px";
      }}
      function clearSelectedFile() {{
        if (fileInput) fileInput.value = "";
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        if (fileChip) fileChip.innerHTML = "";
      }}
      function showFileName() {{
        if (!fileInput || !fileChip) return;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        fileChip.innerHTML = "";
        const file = fileInput.files && fileInput.files.length ? fileInput.files[0] : null;
        if (!file) return;
        const name = escapeHtml(file.name);
        if (file.type.startsWith("image/")) {{
          previewUrl = URL.createObjectURL(file);
          fileChip.innerHTML = `<span class="composer-preview"><img src="${{previewUrl}}" alt="${{name}}"><span>${{name}}</span><button class="remove-attachment" type="button" data-remove-attachment aria-label="Remove attachment">×</button></span>`;
        }} else {{
          fileChip.innerHTML = `<span class="composer-preview file-only">${{name}} <button class="remove-attachment" type="button" data-remove-attachment aria-label="Remove attachment">×</button></span>`;
        }}
      }}
      function escapeHtml(value) {{
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }}
      function renderAttachments(attachments) {{
        if (!attachments || !attachments.length) return "";
        return attachments.map((item) => {{
          const name = escapeHtml(item.filename || "attachment");
          const url = escapeHtml(item.url || "#");
          if (item.is_image) {{
            return `<button class="attachment-preview" type="button" data-preview-src="${{url}}" data-preview-name="${{name}}"><img src="${{url}}" alt="${{name}}"><span>${{name}}</span></button>`;
          }}
          return `<a class="attachment-file" href="${{url}}" target="_blank" rel="noopener">${{name}}</a>`;
        }}).join("");
      }}
      function renderMessage(message) {{
        const role = escapeHtml(message.role || "message");
        const content = renderContent(message.content || "");
        const meta = [message.provider, message.model].filter(Boolean).map(escapeHtml).join(" ");
        const cost = message.estimated_cost !== null && message.estimated_cost !== undefined ? `<div class="muted">estimated cost: USD ${{escapeHtml(message.estimated_cost)}}</div>` : "";
        return `<div class="message-row ${{role}}"><div class="message ${{role}}"><div class="message-role">${{role}}</div><div>${{content}}</div>${{renderAttachments(message.attachments)}}${{meta ? `<div class="muted">${{meta}}</div>` : ""}}${{cost}}</div></div>`;
      }}
      function renderContent(value) {{
        const parts = String(value).split(/```/);
        return parts.map((part, index) => {{
          if (index % 2 === 1) return `<pre class="code-block"><code>${{escapeHtml(part).trim()}}</code></pre>`;
          return escapeHtml(part).replaceAll("\\n", "<br>");
        }}).join("");
      }}
      function setMessages(messages) {{
        if (!feed) return;
        feed.innerHTML = messages.length ? messages.map(renderMessage).join("") : '<div class="empty-chat"><div><h2>무엇을 도와드릴까요?</h2><p>아래 입력창에 질문을 쓰면 대화가 이 세션에 저장됩니다.</p></div></div>';
        feed.scrollTop = feed.scrollHeight;
      }}
      function appendOptimistic() {{
        if (!feed || !textarea) return false;
        const file = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
        const attachments = file ? [{{
          filename: file.name,
          url: URL.createObjectURL(file),
          is_image: file.type.startsWith("image/")
        }}] : [];
        const content = textarea.value.trim() || (file ? "Attached file" : "");
        if (!content && !file) return false;
        const empty = feed.querySelector(".empty-chat");
        if (empty) feed.innerHTML = "";
        feed.insertAdjacentHTML("beforeend", renderMessage({{role: "user", content, attachments}}));
        feed.insertAdjacentHTML("beforeend", '<div class="message-row assistant" data-pending><div class="message assistant"><div class="message-role">assistant</div><div class="typing"><span></span><span></span><span></span></div></div></div>');
        feed.scrollTop = feed.scrollHeight;
        return true;
      }}
      if (fileInput) fileInput.addEventListener("change", showFileName);
      document.addEventListener("click", (event) => {{
        const remove = event.target.closest("[data-remove-attachment]");
        if (remove) {{
          event.preventDefault();
          clearSelectedFile();
          if (textarea) textarea.focus();
          return;
        }}
        const preview = event.target.closest("[data-preview-src]");
        if (preview && lightbox && lightboxImage) {{
          event.preventDefault();
          lightboxImage.src = preview.dataset.previewSrc;
          lightboxImage.alt = preview.dataset.previewName || "";
          lightbox.classList.add("open");
        }}
        if (event.target.closest("[data-lightbox-close]") || event.target === lightbox) {{
          lightbox.classList.remove("open");
          if (lightboxImage) lightboxImage.src = "";
        }}
      }});
      document.addEventListener("keydown", (event) => {{
        if (event.key === "Escape" && lightbox) {{
          lightbox.classList.remove("open");
          if (lightboxImage) lightboxImage.src = "";
        }}
      }});
      if (composer) composer.addEventListener("submit", async (event) => {{
        event.preventDefault();
        if (sending) return;
        const hasFile = fileInput && fileInput.files && fileInput.files.length > 0;
        if (!textarea.value.trim() && !hasFile) return;
        sending = true;
        const button = composer.querySelector('button[type="submit"]');
        if (button) button.disabled = true;
        const formData = new FormData(composer);
        appendOptimistic();
        textarea.value = "";
        autosize();
        clearSelectedFile();
        try {{
          const response = await fetch(composer.dataset.apiAction || composer.action, {{
            method: "POST",
            body: formData,
            headers: {{"Accept": "application/json"}}
          }});
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "Send failed.");
          setMessages(payload.messages || []);
        }} catch (error) {{
          const pending = feed ? feed.querySelector("[data-pending]") : null;
          if (pending) pending.outerHTML = renderMessage({{role: "system", content: error.message}});
        }} finally {{
          sending = false;
          if (button) button.disabled = false;
          if (textarea) textarea.focus();
        }}
      }});
      if (textarea) textarea.addEventListener("keydown", (event) => {{
        if (event.key === "Enter" && (!event.shiftKey || event.metaKey || event.ctrlKey)) {{
          event.preventDefault();
          composer.requestSubmit();
        }}
      }});
      if (textarea) textarea.addEventListener("input", autosize);
      autosize();
      if (quickSearch) quickSearch.addEventListener("input", () => {{
        const needle = quickSearch.value.trim().toLowerCase();
        document.querySelectorAll("[data-tree-item]").forEach((item) => {{
          item.style.display = item.textContent.toLowerCase().includes(needle) ? "" : "none";
        }});
      }});
      document.addEventListener("keydown", (event) => {{
        if (event.key === "/" && quickSearch && document.activeElement !== textarea) {{
          event.preventDefault();
          quickSearch.focus();
        }}
      }});
      function selectWorkbenchTab(name) {{
        if (!name) return;
        workbenchTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.workbenchTab === name));
        workbenchPanels.forEach((panel) => panel.hidden = panel.dataset.workbenchPanel !== name);
        localStorage.setItem("aiws-workbench-tab", name);
      }}
      workbenchTabs.forEach((tab) => tab.addEventListener("click", () => selectWorkbenchTab(tab.dataset.workbenchTab)));
      selectWorkbenchTab(localStorage.getItem("aiws-workbench-tab") || "context");
      let dragDepth = 0;
      window.addEventListener("dragenter", (event) => {{
        if (!fileInput) return;
        event.preventDefault();
        dragDepth += 1;
        body.classList.add("dragging");
      }});
      window.addEventListener("dragover", (event) => {{
        if (!fileInput) return;
        event.preventDefault();
      }});
      window.addEventListener("dragleave", () => {{
        if (!fileInput) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) body.classList.remove("dragging");
      }});
      window.addEventListener("drop", (event) => {{
        if (!fileInput) return;
        event.preventDefault();
        dragDepth = 0;
        body.classList.remove("dragging");
          if (event.dataTransfer && event.dataTransfer.files.length) {{
          fileInput.files = event.dataTransfer.files;
          showFileName();
          const textarea = document.querySelector(".composer textarea");
          if (textarea) textarea.focus();
        }}
      }});
    }});
  </script>
</head>
<body class="{body_class}">
  <header><nav><a class="brand" href="/">Assistant</a>{nav_links}<span class="muted">{html(self.current_username() or 'local')}</span></nav></header>
  <div class="drop-overlay">Drop file to attach</div>
  <div class="image-lightbox" data-lightbox><button type="button" data-lightbox-close>×</button><img data-lightbox-image alt=""></div>
  <main>{body}</main>
</body>
</html>"""
        encoded = html_body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def login_form(self, error: str = "") -> str:
        language = self.language()
        return f"""<h1>{html(t(language, 'login'))}</h1>
<p>{html(error)}</p>
<form method="post" action="/login">
  <label>{html(t(language, 'username'))}</label>
  <input name="username" autocomplete="username">
  <label>{html(t(language, 'password'))}</label>
  <input type="password" name="password" autocomplete="current-password">
  <button type="submit">{html(t(language, 'login'))}</button>
</form>"""

    def home(self) -> str:
        return f"""<div class="chat-shell home-shell">
  <input class="sidebar-toggle" id="sidebar-toggle" type="checkbox">
  <aside class="chat-sidebar leather-rail">
    <div class="chat-sidebar-top">
      <h2>Workspace</h2>
      <label class="sidebar-button" for="sidebar-toggle" title="Toggle sidebar">☰</label>
    </div>
    {self.workspace_tree("", "")}
  </aside>
  <section class="chat-main">
    <div class="home-start">
      <h1>무엇을 도와드릴까요?</h1>
      <p class="muted">왼쪽에서 프로젝트와 세션을 고르거나 새 프로젝트를 만들면 바로 대화를 시작할 수 있습니다.</p>
    </div>
  </section>
  {self.render_workbench()}
</div>"""

    def projects(self) -> str:
        items = []
        projects = storage.list_visible_projects(self.root, self.current_username()) if storage.has_accounts(self.root) else storage.list_projects(self.root)
        for project in projects:
            items.append(
                f"""<div class="panel"><h3><a href="/project/{project['path']}">{html(project['title'])}</a></h3>
<div class="muted"><code>{html(project['path'])}</code></div>
<p>{html(project.get('notes', ''))}</p>
<p class="muted">owner={html(project.get('owner') or '-')} · {html(project.get('visibility', 'private'))}</p>
{self.skill_pills(project.get('skills', []))}</div>"""
            )
        return """<h1>Projects</h1>
<div class="toolbar"><a class="button-link" href="/projects/new">Create Project</a></div>
<div class="grid">""" + "".join(items or ['<div class="panel muted">No projects yet.</div>']) + "</div>"

    def project_form(self) -> str:
        skill_text = ", ".join(storage.list_skills(self.root))
        return f"""<h1>Create Project</h1>
<p class="muted">Create a root project or one subproject below an existing root project.</p>
<form method="post" action="/projects">
  <div class="field"><label>Title</label><input name="title" required></div>
  <div class="field"><label>Parent project slug, optional</label><input name="parent" placeholder="ai-system"></div>
  <div class="field"><label>Notes</label><textarea name="notes"></textarea></div>
  <div class="field"><label>Skills, comma-separated</label><input name="skills" placeholder="{html(skill_text)}"></div>
  <div class="form-grid">
    <div class="field"><label>Owner</label><input name="owner" value="{html(self.current_username() or '')}"></div>
    <div class="field"><label>Visibility</label><select name="visibility"><option>private</option><option>public</option></select></div>
  </div>
  <button type="submit">Create</button>
</form>"""

    def project_detail(self, project_path: str) -> str:
        if storage.has_accounts(self.root):
            storage.ensure_project_access(self.root, project_path, self.current_username())
        project = storage.load_project(self.root, project_path)
        sessions = storage.list_sessions(self.root, project_path)
        active_skills = storage.resolve_skill_names(self.root, project_path)
        session_items = []
        for session in sessions:
            messages = storage.read_messages(self.root, project_path, session["slug"])
            preview = ""
            if messages:
                preview = str(messages[-1].get("content", ""))[:140]
            session_items.append(
                f"""<a class="session-card" href="/chat/{project_path}/{session['slug']}">
  <h3>{html(session['title'])}</h3>
  <div class="muted"><code>{html(session['slug'])}</code> · {len(messages)} messages</div>
  <p class="muted">{html(preview) if preview else 'No messages yet.'}</p>
</a>"""
            )
        language = self.language()
        skill_cards = "".join(f'<div class="skill-card">{html(skill)}</div>' for skill in active_skills)
        return f"""<section class="hero">
  <div>
    <h1>{html(project['title'])}</h1>
    <p class="muted"><code>{html(project_path)}</code> · owner={html(project.get('owner') or '-')} · {html(project.get('visibility', 'private'))}</p>
    <p>{html(project.get('notes', ''))}</p>
  </div>
  <a class="button-link secondary" href="/projects">Projects</a>
</section>
<div class="grid">
  <div class="panel"><strong>{html(t(language, 'active_skills'))}</strong><div>{skill_cards or '<span class="muted">No skills selected.</span>'}</div></div>
  <form class="panel" method="post" action="/sessions/{project_path}">
    <h3>Create Session</h3>
    <div class="compact-form">
      <div class="field" style="flex:1"><label>Title</label><input name="title" required></div>
      <button type="submit">Create</button>
    </div>
  </form>
</div>
<h2>Sessions</h2>
<div class="session-list">{''.join(session_items or ['<div class="panel muted">No sessions yet.</div>'])}</div>"""

    def chat_page(self, project_path: str, session_slug: str) -> str:
        if storage.has_accounts(self.root):
            storage.ensure_project_access(self.root, project_path, self.current_username())
        project = storage.load_project(self.root, project_path)
        session = storage.load_session(self.root, project_path, session_slug)
        messages = storage.read_messages(self.root, project_path, session_slug)
        rendered_messages = "".join(self.message_block(message) for message in messages)
        return f"""<div class="chat-shell">
  <input class="sidebar-toggle" id="sidebar-toggle" type="checkbox">
  <aside class="chat-sidebar leather-rail">
    <div class="chat-sidebar-top">
      <h2>Workspace</h2>
      <label class="sidebar-button" for="sidebar-toggle" title="Toggle sidebar">☰</label>
    </div>
    {self.workspace_tree(project_path, session_slug)}
  </aside>
  <section class="chat-main">
    <div class="chat-top">
      <label class="sidebar-button" for="sidebar-toggle" title="Toggle sidebar">☰</label>
      <div class="chat-title">
        <h1>{html(session['title'])}</h1>
        <div class="muted">{html(project['title'])} · <code>{html(project_path)}</code> · <a href="/prompt/{project_path}/{session_slug}">prompt context</a></div>
        <div class="context-strip">{self.context_chips(project_path, session_slug, messages)}</div>
      </div>
    </div>
    <div class="chat-feed">
      {rendered_messages or '<div class="empty-chat"><div><h2>무엇을 도와드릴까요?</h2><p>아래 입력창에 질문을 쓰면 대화가 이 세션에 저장됩니다.</p></div></div>'}
    </div>
    <form class="composer" method="post" action="/ask/{project_path}/{session_slug}" data-api-action="/api/ask/{project_path}/{session_slug}" enctype="multipart/form-data">
      <div class="composer-panel">
        <textarea name="content" placeholder="메시지를 입력하세요. 파일은 이 창으로 끌어오거나 + 버튼으로 첨부할 수 있습니다."></textarea>
        <div class="file-chip">{self.attachment_chips(project_path, session_slug)}<span data-file-chip></span></div>
        <div class="composer-actions">
          <label class="attach-button" title="Attach file">+
            <input class="file-input" data-attachment-input type="file" name="attachment" accept=".txt,.md,.pdf,.docx,image/png,image/jpeg,image/gif,image/webp">
          </label>
          {self.model_select()}
          <select name="provider"><option>ollama</option><option>kimi</option></select>
          <select name="search_mode"><option>off</option><option>auto</option><option>always</option></select>
          <button type="submit">Send</button>
        </div>
        <div class="cost-note">Local Ollama is $0 API cost. Kimi estimates are stored with each assistant response.</div>
      </div>
    </form>
  </section>
  {self.render_workbench(project_path, session_slug, project=project, session=session, messages=messages)}
</div>"""

    def workspace_tree(self, active_project_path: str, active_session_slug: str) -> str:
        projects = storage.list_visible_projects(self.root, self.current_username()) if storage.has_accounts(self.root) else storage.list_projects(self.root)
        root_projects = [project for project in projects if not project.get("parent")]
        by_parent: dict[str, list[dict[str, object]]] = {}
        for project in projects:
            parent = str(project.get("parent") or "")
            if parent:
                by_parent.setdefault(parent, []).append(project)

        groups = []
        for project in root_projects:
            groups.append(self.project_tree_block(project, active_project_path, active_session_slug, level="root"))
            for child in by_parent.get(str(project["path"]), []):
                groups.append(self.project_tree_block(child, active_project_path, active_session_slug, level="child"))
        empty = """<div class="surface">
  <strong>No projects yet.</strong>
  <p class="muted">Create your first project. Projects hold sessions, skills, files, and context.</p>
</div>"""
        return (
            self.sidebar_actions(active_project_path)
            + '<input class="project-filter inset-field" data-project-filter placeholder="Search workspace">'
            + ("".join(groups) or empty)
        )

    def sidebar_actions(self, active_project_path: str) -> str:
        owner = html(self.current_username() or "")
        new_session = ""
        if active_project_path:
            new_session = f"""<details>
  <summary>New chat</summary>
  <form method="post" action="/sessions/{html(active_project_path)}">
    <input name="title" placeholder="Chat title" required>
    <button type="submit">Create chat</button>
  </form>
</details>"""
        return f"""<div class="sidebar-actions">
  {new_session}
  <details>
    <summary>New project</summary>
    <form method="post" action="/projects">
      <input name="title" placeholder="Project title" required>
      <input name="owner" value="{owner}" placeholder="Owner">
      <select name="visibility"><option>private</option><option>public</option></select>
      <textarea name="notes" placeholder="Notes"></textarea>
      <button type="submit">Create project</button>
    </form>
  </details>
</div>"""

    def project_tree_block(self, project: dict[str, object], active_project_path: str, active_session_slug: str, *, level: str) -> str:
        project_path = str(project["path"])
        active = " active" if project_path == active_project_path else ""
        project_class = "tree-project" if level == "root" else "tree-subproject"
        sessions = storage.list_sessions(self.root, project_path)
        session_links = []
        for session in sessions:
            session_active = " active" if project_path == active_project_path and session["slug"] == active_session_slug else ""
            session_links.append(
                f"""<a class="tree-session{session_active}" data-tree-item href="/chat/{project_path}/{session['slug']}">
  {html(session['title'])}
  <span class="tree-date">{html(short_date(session.get('created_at')))}</span>
</a>"""
            )
        return f"""<div class="tree-group">
  <a class="{project_class}{active}" data-tree-item href="/project/{project_path}">
    {html(project['title'])}
    <span class="tree-date">{html(short_date(project.get('created_at')))}</span>
  </a>
  {''.join(session_links)}
</div>"""

    def context_chips(self, project_path: str, session_slug: str, messages: list[dict[str, object]]) -> str:
        skills = storage.resolve_skill_names(self.root, project_path)
        attachment_count = len(attachments.list_attachments(self.root, project_path, session_slug))
        latest = latest_assistant_metadata(messages)
        provider = html(str(latest.get("provider") or "ollama"))
        model = html(str(latest.get("model") or "qwen3:0.6b"))
        search_mode = html(str(latest.get("search_mode") or "off"))
        return (
            f'<span class="status-chip"><span class="status-lamp"></span>{provider}</span>'
            f'<span class="status-chip">{model}</span>'
            f'<span class="status-chip">Search {search_mode}</span>'
            f'<span class="status-chip">{len(skills)} skills</span>'
            f'<span class="status-chip">{attachment_count} files</span>'
        )

    def render_workbench(
        self,
        project_path: str | None = None,
        session_slug: str | None = None,
        *,
        project: dict[str, object] | None = None,
        session: dict[str, object] | None = None,
        messages: list[dict[str, object]] | None = None,
    ) -> str:
        if not project_path or not session_slug or not project or not session:
            return """<aside class="workbench-panel">
  <div class="workbench-section">
    <h3>Workbench</h3>
    <div class="surface">Artifacts, drafts, and generated files will appear here.</div>
  </div>
</aside>"""
        messages = messages or []
        skills = storage.resolve_skill_names(self.root, project_path)
        skill_cards = "".join(f'<div class="skill-card">{html(skill)}</div>' for skill in skills) or '<p class="muted">No active skills.</p>'
        file_cards = self.attachment_workbench_cards(project_path, session_slug)
        latest = latest_assistant_metadata(messages)
        return f"""<aside class="workbench-panel" aria-label="Workbench">
  <div class="workbench-tabs">
    <button type="button" data-workbench-tab="context">Context</button>
    <button type="button" data-workbench-tab="files">Files</button>
    <button type="button" data-workbench-tab="prompt">Prompt</button>
    <button type="button" data-workbench-tab="dev">Dev</button>
  </div>
  <section class="workbench-section" data-workbench-panel="context">
    <h3>Context</h3>
    <div class="surface">
      <p><strong>{html(project['title'])}</strong></p>
      <p class="muted"><code>{html(project_path)}</code> · <code>{html(session_slug)}</code></p>
      <p>{html(project.get('notes', '') or 'No project notes yet.')}</p>
    </div>
    <h3>Active Skills / 활성 스킬</h3>
    {skill_cards}
  </section>
  <section class="workbench-section" data-workbench-panel="files" hidden>
    <h3>Files</h3>
    {file_cards}
  </section>
  <section class="workbench-section" data-workbench-panel="prompt" hidden>
    <h3>Prompt Context</h3>
    <a class="physical-button button-link secondary" href="/prompt/{project_path}/{session_slug}">Open prompt context</a>
    <p class="archive-hint">Project metadata, notes, inherited skills, session metadata, messages, and selected attachment text are assembled here.</p>
  </section>
  <section class="workbench-section" data-workbench-panel="dev" hidden>
    <h3>Dev</h3>
    <div class="graphite-surface surface">
      <p><span class="status-lamp"></span>{html(str(latest.get('provider') or 'provider pending'))}</p>
      <p>Model: <code>{html(str(latest.get('model') or 'not selected'))}</code></p>
      <p>Search: <code>{html(str(latest.get('search_mode') or 'off'))}</code></p>
      <p>Cost: <code>{html(str(latest.get('cost') if latest.get('cost') is not None else 'n/a'))}</code></p>
    </div>
    <p class="archive-hint">JSONL and Markdown archives live under the session folder in the local workspace.</p>
    <pre class="code-block"><code>aiws prompt {html(project_path)} {html(session_slug)} --root ~/.ai-workspace</code></pre>
  </section>
</aside>"""

    def attachment_workbench_cards(self, project_path: str, session_slug: str) -> str:
        items = attachments.list_attachments(self.root, project_path, session_slug)
        if not items:
            return '<div class="surface">Drop files here or use Attach file. No files yet.</div>'
        cards = []
        for item in items[-8:]:
            view = attachment_view(project_path, session_slug, item)
            name = html(view["filename"])
            url = html(view["url"])
            if view["is_image"]:
                cards.append(
                    f'<button class="attachment-card attachment-preview" type="button" data-preview-src="{url}" data-preview-name="{name}">'
                    f'<img src="{url}" alt="{name}"><span>{name}</span></button>'
                )
            else:
                cards.append(f'<a class="attachment-card attachment-file surface" href="{url}" target="_blank" rel="noopener">{name}</a>')
        return "".join(cards)

    def profile_page(self) -> str:
        username = self.current_username()
        if not username:
            return self.login_form()
        account = storage.public_account(storage.load_account(self.root, username))
        profile = account.get("profile", {})
        language = self.language()
        avatar = profile.get("avatar", "")
        avatar_html = f'<img src="/avatar/{html(username)}" alt="" style="width:96px;height:96px;border-radius:50%;object-fit:cover;border:1px solid var(--border)">' if avatar else '<div class="muted">No profile photo.</div>'
        memories = "".join(f"<li>{html(item.get('content', ''))}</li>" for item in profile.get("memory", [])[-10:])
        return f"""<h1>{html(t(language, 'profile'))}</h1>
<div class="grid">
  <div class="panel">{avatar_html}
    <form method="post" action="/profile/avatar" enctype="multipart/form-data">
      <div class="field"><label>{html(t(language, 'avatar'))}</label><input type="file" name="avatar" accept="image/png,image/jpeg,image/gif,image/webp" required></div>
      <button type="submit">{html(t(language, 'save'))}</button>
    </form>
  </div>
  <div class="panel">
    <form method="post" action="/profile">
      <div class="field"><label>{html(t(language, 'name'))}</label><input name="name" value="{html(profile.get('name', ''))}"></div>
      <div class="field"><label>{html(t(language, 'age'))}</label><input name="age" value="{html(profile.get('age', ''))}"></div>
      <div class="field"><label>{html(t(language, 'job'))}</label><input name="job" value="{html(profile.get('job', ''))}"></div>
      <div class="field"><label>{html(t(language, 'situation'))}</label><textarea name="situation">{html(profile.get('situation', ''))}</textarea></div>
      <div class="field"><label>{html(t(language, 'language'))}</label><select name="language"><option value="ko" {selected(profile.get('language'), 'ko')}>한국어</option><option value="en" {selected(profile.get('language'), 'en')}>English</option></select></div>
      <div class="field"><label>{html(t(language, 'memory'))}</label><textarea name="memory" placeholder="새 메모리를 추가합니다."></textarea></div>
      <button type="submit">{html(t(language, 'save'))}</button>
    </form>
  </div>
</div>
<h2>{html(t(language, 'memory'))}</h2>
<div class="panel"><ul>{memories or '<li class="muted">No saved memory yet.</li>'}</ul></div>"""

    def serve_avatar(self, username: str) -> None:
        try:
            account = storage.load_account(self.root, username)
            avatar = account.get("profile", {}).get("avatar", "")
            workspace = storage.workspace_path(self.root)
            path = (workspace / avatar).resolve()
            if not str(path).startswith(str(workspace.resolve())):
                self.not_found()
                return
            if not avatar or not path.exists():
                self.not_found()
                return
            content = path.read_bytes()
        except storage.WorkspaceError:
            self.not_found()
            return
        self.send_response(200)
        self.send_header("Content-Type", image_content_type(path.suffix))
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def serve_attachment(self, project_path: str, session_slug: str, filename: str) -> None:
        try:
            storage.ensure_project_access(self.root, project_path, self.current_username())
            storage.load_session(self.root, project_path, session_slug)
            root_dir = attachments.attachment_dir(self.root, project_path, session_slug).resolve()
            path = (root_dir / attachments.safe_filename(filename)).resolve()
            if not str(path).startswith(str(root_dir)):
                self.not_found()
                return
            if not path.exists():
                self.not_found()
                return
            content = path.read_bytes()
        except storage.WorkspaceError:
            self.not_found()
            return
        self.send_response(200)
        self.send_header("Content-Type", attachment_content_type(path.suffix))
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def require_csrf(self, data: dict[str, str]) -> None:
        if not self.require_auth:
            return
        expected = self.csrf_token()
        supplied = self.headers.get("X-CSRF-Token") or data.get("_csrf", "")
        if not supplied or not hmac.compare_digest(supplied, expected):
            raise storage.WorkspaceError("Invalid CSRF token.")

    def csrf_token(self) -> str:
        header = self.headers.get("Cookie", "")
        jar = cookies.SimpleCookie(header)
        morsel = jar.get(CSRF_COOKIE)
        if morsel and morsel.value:
            return morsel.value
        if not self._csrf_to_set:
            self._csrf_to_set = secrets.token_urlsafe(24)
        return self._csrf_to_set

    def end_headers(self) -> None:
        if self._csrf_to_set:
            self.send_header("Set-Cookie", self.cookie_header(CSRF_COOKIE, self._csrf_to_set, http_only=False))
        super().end_headers()

    def cookie_header(self, name: str, value: str, *, http_only: bool, max_age: int | None = None) -> str:
        parts = [f"{name}={value}", "Path=/", "SameSite=Lax"]
        if http_only:
            parts.append("HttpOnly")
        if self.is_https_request():
            parts.append("Secure")
        if max_age is not None:
            parts.append(f"Max-Age={max_age}")
        return "; ".join(parts)

    def is_https_request(self) -> bool:
        return self.headers.get("X-Forwarded-Proto", "").lower() == "https"

    def login_key(self, username: str) -> tuple[str, str]:
        forwarded = self.headers.get("CF-Connecting-IP") or self.headers.get("X-Forwarded-For", "")
        ip = (forwarded.split(",", 1)[0].strip() or self.client_address[0])
        return ip, storage.slugify(username or "unknown")

    def login_is_limited(self, username: str) -> bool:
        now = time.time()
        key = self.login_key(username)
        attempts = [item for item in LOGIN_FAILURES.get(key, []) if now - item < LOGIN_WINDOW_SECONDS]
        LOGIN_FAILURES[key] = attempts
        return len(attempts) >= LOGIN_MAX_FAILURES

    def record_login_failure(self, username: str) -> None:
        key = self.login_key(username)
        LOGIN_FAILURES.setdefault(key, []).append(time.time())

    def clear_login_failures(self, username: str) -> None:
        LOGIN_FAILURES.pop(self.login_key(username), None)

    def language(self) -> str:
        return storage.get_account_language(self.root, self.current_username())

    def skill_pills(self, skills: list[str]) -> str:
        return "".join(f'<span class="pill">{html(skill)}</span>' for skill in skills)

    def message_block(self, message: dict[str, object]) -> str:
        role = str(message.get("role", "message"))
        provider = message.get("provider")
        model = message.get("model")
        meta = ""
        if provider or model:
            meta = f'<div class="muted">{html(provider or "")} {html(model or "")}</div>'
        metadata = message.get("metadata", {})
        if isinstance(metadata, dict) and isinstance(metadata.get("cost"), dict):
            cost = metadata["cost"]
            if cost.get("estimated_cost") is not None:
                meta += (
                    f'<div class="muted">estimated cost: '
                    f'{html(cost.get("currency", "USD"))} {html(cost.get("estimated_cost"))}</div>'
                )
        content = render_content(message.get("content", ""))
        return f"""<div class="message-row {html(role)}"><div class="message {html(role)}">
<div class="message-role">{html(role)}</div>
<div>{content}</div>
{self.message_attachments(message)}
{meta}
</div></div>"""

    def message_json(self, message: dict[str, object]) -> dict[str, object]:
        metadata = message.get("metadata", {})
        cost = metadata.get("cost", {}) if isinstance(metadata, dict) else {}
        return {
            "role": message.get("role", "message"),
            "content": message.get("content", ""),
            "created_at": message.get("created_at"),
            "actor": message.get("actor"),
            "actor_display": storage.display_name_for_username(str(message.get("actor") or "")),
            "provider": message.get("provider"),
            "model": message.get("model"),
            "attachments": message_attachments_data(metadata),
            "estimated_cost": cost.get("estimated_cost") if isinstance(cost, dict) else None,
        }

    def message_attachments(self, message: dict[str, object]) -> str:
        metadata = message.get("metadata", {})
        items = []
        for item in message_attachments_data(metadata):
            filename = html(item["filename"])
            url = html(item["url"])
            if item["is_image"]:
                items.append(
                    f'<button class="attachment-preview" type="button" data-preview-src="{url}" data-preview-name="{filename}">'
                    f'<img src="{url}" alt="{filename}"><span>{filename}</span></button>'
                )
            else:
                items.append(f'<a class="attachment-file" href="{url}" target="_blank" rel="noopener">{filename}</a>')
        return "".join(items)

    def model_select(self) -> str:
        options = []
        for item in costs.list_model_costs():
            label = f"{item.model} ({item.provider}, ${item.input_per_million}/M in, ${item.output_per_million}/M out)"
            selected_attr = " selected" if item.model == "qwen3:0.6b" else ""
            options.append(f'<option value="{html(item.model)}"{selected_attr}>{html(label)}</option>')
        return f'<select name="model">{"".join(options)}</select>'

    def attachment_items(self, project_path: str, session_slug: str) -> str:
        items = []
        for item in attachments.list_attachments(self.root, project_path, session_slug):
            url = f"/attachment/{project_path}/{session_slug}/{item['filename']}"
            preview = html(str(item.get("text", ""))[:240]) or "No extracted text."
            items.append(
                f"""<div class="panel"><a href="{html(url)}">{html(item['filename'])}</a>
<div class="muted">{html(item.get('content_type', 'file'))} · {html(item.get('size', 0))} bytes</div>
<pre>{preview}</pre></div>"""
            )
        return "".join(items) or '<p class="muted">No attachments yet.</p>'

    def attachment_chips(self, project_path: str, session_slug: str) -> str:
        items = attachments.list_attachments(self.root, project_path, session_slug)
        if not items:
            return ""
        chips = []
        for item in items[-3:]:
            url = f"/attachment/{project_path}/{session_slug}/{item['filename']}"
            chips.append(f'<a class="pill" href="{html(url)}">{html(item["filename"])}</a>')
        return "".join(chips)

    def admin_link(self) -> str:
        if storage.is_admin(self.root, self.current_username()):
            return '<a href="/admin">Admin</a>'
        return ""

    def admin_page(self) -> str:
        if not storage.is_admin(self.root, self.current_username()):
            return self.error_page("Forbidden", "Admin access is required.", "/")
        rows = []
        for account in storage.list_accounts(self.root):
            usage = account.get("usage", {})
            rows.append(
                f"""<tr><td>{html(account['username'])}</td><td>{html(account['admin'])}</td>
<td>{html(usage.get('messages', 0))}</td><td>{html(usage.get('asks', 0))}</td></tr>"""
            )
        return f"""<h1>Admin Dashboard</h1>
<div class="panel"><table>
<thead><tr><th>User</th><th>Admin</th><th>Messages</th><th>Asks</th></tr></thead>
<tbody>{''.join(rows)}</tbody>
</table></div>
<h2>Model Costs</h2>
<div class="panel"><pre>{html(model_cost_table())}</pre></div>"""

    def error_page(self, title: str, detail: str, back_url: str) -> str:
        return f"""<h1>{html(title)}</h1>
<div class="panel error"><p>{html(detail)}</p></div>
<p><a class="button-link secondary" href="{html(back_url)}">Back</a></p>"""

    def not_found(self) -> None:
        self.send_response(404)
        self.end_headers()
        self.wfile.write(b"Not found")


def html(value: object) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def render_content(value: object) -> str:
    parts = str(value).split("```")
    rendered = []
    for index, part in enumerate(parts):
        if index % 2 == 1:
            rendered.append(f'<pre class="code-block"><code>{html(part.strip())}</code></pre>')
        else:
            rendered.append(html(part).replace("\n", "<br>"))
    return "".join(rendered)


def latest_assistant_metadata(messages: list[dict[str, object]]) -> dict[str, object]:
    for message in reversed(messages):
        if message.get("role") != "assistant":
            continue
        metadata = message.get("metadata", {})
        cost = metadata.get("cost", {}) if isinstance(metadata, dict) else {}
        search = metadata.get("search", {}) if isinstance(metadata, dict) else {}
        return {
            "provider": message.get("provider"),
            "model": message.get("model"),
            "cost": cost.get("estimated_cost") if isinstance(cost, dict) else None,
            "search_mode": search.get("mode") if isinstance(search, dict) else None,
        }
    return {}


def selected(value: object, expected: str) -> str:
    return "selected" if value == expected else ""


def short_date(value: object) -> str:
    text = str(value or "")
    return text[:10] if len(text) >= 10 else text


def web_dist_path() -> Path:
    return Path(__file__).resolve().parents[2] / "web" / "dist"


def image_content_type(extension: str) -> str:
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }.get(extension.lower(), "application/octet-stream")


def attachment_content_type(extension: str) -> str:
    if extension.lower() in {".txt", ".md"}:
        return "text/plain; charset=utf-8"
    if extension.lower() == ".pdf":
        return "application/pdf"
    if extension.lower() == ".docx":
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    return image_content_type(extension)


def attachment_view(project_path: str, session_slug: str, metadata: dict[str, object]) -> dict[str, object]:
    content_type = str(metadata.get("content_type", ""))
    filename = str(metadata.get("filename", "attachment"))
    extraction_status = str(metadata.get("extraction_status", "stored"))
    extraction_error = str(metadata.get("extraction_error", ""))
    delivery = {
        "vision": "Sent as vision input",
        "text_context": "Sent as text context",
        "stored_only": "Attached to chat",
    }.get(str(metadata.get("delivery", "")), str(metadata.get("delivery", "Attached to chat")))
    return {
        "filename": filename,
        "url": f"/attachment/{project_path}/{session_slug}/{filename}",
        "content_type": content_type,
        "size": metadata.get("size", 0),
        "is_image": content_type in {"png", "jpg", "jpeg", "gif", "webp"},
        "is_pdf": content_type == "pdf",
        "delivery": delivery,
        "text_available": bool(metadata.get("text_available", False)),
        "extraction_status": extraction_status,
        "extraction_error": extraction_error,
    }


def message_attachments_data(metadata: object) -> list[dict[str, object]]:
    if not isinstance(metadata, dict):
        return []
    attachments_value = metadata.get("attachments", [])
    if not isinstance(attachments_value, list):
        return []
    items = []
    for item in attachments_value:
        if isinstance(item, dict):
            items.append(
                {
                    "filename": str(item.get("filename", "attachment")),
                    "url": str(item.get("url", "#")),
                    "content_type": str(item.get("content_type", "")),
                    "size": item.get("size", 0),
                    "is_image": bool(item.get("is_image")),
                    "is_pdf": bool(item.get("is_pdf")),
                    "delivery": str(item.get("delivery", "Attached to chat")),
                    "text_available": bool(item.get("text_available", False)),
                    "extraction_status": str(item.get("extraction_status", "stored")),
                    "extraction_error": str(item.get("extraction_error", "")),
                }
            )
    return items


def model_cost_table() -> str:
    lines = ["provider\tmodel\tinput $/M\toutput $/M\tnote"]
    for item in costs.list_model_costs():
        lines.append(f"{item.provider}\t{item.model}\t{item.input_per_million}\t{item.output_per_million}\t{item.note}")
    return "\n".join(lines)


def re_search_filename(headers: bytes) -> str | None:
    return re_search_header_value(headers, b'filename="')


def re_search_header_value(headers: bytes, marker: bytes) -> str | None:
    start = headers.find(marker)
    if start == -1:
        return None
    start += len(marker)
    end = headers.find(b'"', start)
    if end == -1:
        return None
    return headers[start:end].decode("utf-8", errors="ignore")


def start_ui(root: str, *, mode: str, port: int, password: str | None = None) -> None:
    storage.init_workspace(root)
    if mode == "server" and not password and storage.has_accounts(root):
        host, require_auth = "0.0.0.0", True
    else:
        host, require_auth = validate_ui_options(mode, password)
    if mode == "local" and storage.has_accounts(root):
        require_auth = True
    handler = partial(AIWSHandler, root=root, require_auth=require_auth, password=password)
    server = ThreadingHTTPServer((host, port), handler)
    print(f"Assistant running at http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
