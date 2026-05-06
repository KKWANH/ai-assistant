"""Minimal shared web UI for local and server AIWS modes."""

from __future__ import annotations

import json
from functools import partial
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
from urllib.parse import parse_qs, unquote, urlparse

from . import attachments, costs
from .i18n import t
from . import runner
from . import storage

SESSION_COOKIE = "aiws_auth"
LEGACY_SESSION_VALUE = "ok"


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
        super().__init__(*args, **kwargs)

    def log_message(self, format: str, *args) -> None:
        return

    def do_GET(self) -> None:
        if self.require_auth and not self.is_authenticated() and self.path != "/login":
            self.redirect("/login")
            return
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/login":
            self.page("Login", self.login_form())
        elif path.startswith("/api/chat/"):
            parts = unquote(path.removeprefix("/api/chat/")).split("/")
            if len(parts) < 2:
                self.not_found()
            else:
                session_slug = parts[-1]
                project_path = "/".join(parts[:-1])
                self.api_chat(project_path, session_slug)
        elif path == "/":
            self.page("Assistant", self.home(), layout="chat")
        elif path == "/projects":
            self.page("Projects", self.projects())
        elif path == "/projects/new":
            self.page("Create Project", self.project_form())
        elif path == "/profile":
            self.page("Profile", self.profile_page())
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
            parts = unquote(path.removeprefix("/chat/")).split("/")
            if len(parts) < 2:
                self.not_found()
            else:
                session_slug = parts[-1]
                project_path = "/".join(parts[:-1])
                self.page("Chat", self.chat_page(project_path, session_slug), layout="chat")
        elif path.startswith("/project/"):
            project_path = unquote(path.removeprefix("/project/"))
            self.page("Project", self.project_detail(project_path))
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
                self.handle_ask(project_path, session_slug, data)
                self.api_chat(project_path, session_slug)
            except storage.WorkspaceError as exc:
                self.send_json({"error": str(exc)}, status=400)
            return

        if parsed.path == "/login":
            data = self.form_data()
            username = data.get("username", "")
            password = data.get("password", "")
            account = storage.authenticate_account(self.root, username, password)
            legacy_password_ok = not storage.has_accounts(self.root) and password == self.password
            if account or legacy_password_ok:
                cookie_value = self.signed_cookie_value(account["username"] if account else "admin")
                self.send_response(303)
                self.send_header("Location", "/")
                self.send_header("Set-Cookie", f"{SESSION_COOKIE}={cookie_value}; HttpOnly; SameSite=Lax")
                self.end_headers()
            else:
                self.page("Login", self.login_form("Invalid password."))
            return

        if self.require_auth and not self.is_authenticated():
            self.redirect("/login")
            return

        data = self.form_data()
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
        if length > 18 * 1024 * 1024:
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
        upload = self._multipart_files.get("attachment")
        if upload and upload[1]:
            filename, file_content = upload
            saved = attachments.save_attachment(
                self.root,
                project_path,
                session_slug,
                filename,
                file_content,
                actor=self.current_username(),
            )
            attachment = attachment_view(project_path, session_slug, saved)
            user_metadata["attachments"] = [attachment]
            extracted = str(saved.get("text", "")).strip()
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
            actor=self.current_username(),
            search_mode=data.get("search_mode", "off"),
        )

    def api_chat(self, project_path: str, session_slug: str) -> None:
        try:
            if storage.has_accounts(self.root):
                storage.ensure_project_access(self.root, project_path, self.current_username())
            project = storage.load_project(self.root, project_path)
            session = storage.load_session(self.root, project_path, session_slug)
            self.send_json(
                {
                    "project": {"path": project_path, "title": project["title"]},
                    "session": {"slug": session_slug, "title": session["title"]},
                    "messages": [self.message_json(message) for message in storage.read_messages(self.root, project_path, session_slug)],
                }
            )
        except storage.WorkspaceError as exc:
            self.send_json({"error": str(exc)}, status=404)

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
      --bg: #0b0f14;
      --surface: #101720;
      --surface-2: #151f2c;
      --surface-3: #1b2837;
      --border: #273545;
      --muted: #92a2b5;
      --ink: #eef4fb;
      --soft: #cdd8e6;
      --blue: #72a7ff;
      --green: #40d27f;
      --green-2: #16894c;
      --danger: #ff6b7a;
      --shadow: 0 22px 70px rgba(0, 0, 0, .32);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      min-height: 100vh;
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at 18% 0%, rgba(64, 210, 127, .10), transparent 28rem),
        linear-gradient(180deg, #0b0f14 0%, #0e141c 100%);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
    }}
    body.chat-body {{ overflow: hidden; height: 100vh; }}
    header {{
      position: sticky;
      top: 0;
      z-index: 10;
      border-bottom: 1px solid rgba(255, 255, 255, .08);
      background: rgba(11, 15, 20, .82);
      backdrop-filter: blur(18px);
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
      background: #0d131b;
      color: var(--ink);
      font: inherit;
      outline: none;
    }}
    input:focus, textarea:focus, select:focus {{ border-color: rgba(114, 167, 255, .8); box-shadow: 0 0 0 3px rgba(114, 167, 255, .16); }}
    textarea {{ min-height: 112px; resize: vertical; }}
    button {{
      padding: 10px 16px;
      border: 1px solid var(--green-2);
      border-radius: 10px;
      background: linear-gradient(180deg, #25b963, #16894c);
      color: #fff;
      font-weight: 800;
      cursor: pointer;
    }}
    pre {{ white-space: pre-wrap; background: #0d131b; color: var(--soft); padding: 16px; overflow: auto; border: 1px solid var(--border); border-radius: 12px; }}
    code {{ background: rgba(255, 255, 255, .08); color: var(--soft); padding: 2px 5px; border-radius: 5px; }}
    label {{ display: block; font-weight: 800; margin-bottom: 7px; color: var(--soft); }}
    .muted {{ color: var(--muted); }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }}
    .panel {{ border: 1px solid var(--border); border-radius: 16px; padding: 18px; background: rgba(16, 23, 32, .84); box-shadow: var(--shadow); }}
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
      background: var(--surface-2);
      color: var(--ink);
      overflow-wrap: anywhere;
    }}
    .message.user {{ background: #1f6f50; border-color: #2c9a69; border-bottom-right-radius: 5px; }}
    .message.assistant {{ background: #172231; border-bottom-left-radius: 5px; }}
    .message.system, .message.tool {{ background: #111923; color: var(--soft); }}
    .message-role {{ font-weight: 800; text-transform: uppercase; font-size: 11px; letter-spacing: .04em; color: rgba(238, 244, 251, .72); margin-bottom: 4px; }}
    .error {{ border-color: rgba(255, 107, 122, .7); background: rgba(255, 107, 122, .08); }}
    .cost-note {{ font-size: 13px; color: var(--muted); margin-top: -6px; }}
    table {{ border-collapse: collapse; width: 100%; }}
    th, td {{ border-bottom: 1px solid var(--border); padding: 8px; text-align: left; }}
    .hero {{ display: flex; justify-content: space-between; gap: 20px; align-items: end; margin-bottom: 22px; }}
    .hero p {{ max-width: 720px; }}
    .session-list {{ display: grid; gap: 12px; }}
    .session-card {{ display: block; color: var(--ink); text-decoration: none; border: 1px solid var(--border); border-radius: 16px; padding: 16px; background: rgba(16, 23, 32, .82); }}
    .session-card:hover {{ border-color: rgba(114, 167, 255, .55); background: rgba(21, 31, 44, .96); }}
    .chat-shell {{ height: 100%; min-height: 0; display: grid; grid-template-columns: 312px minmax(0, 1fr); position: relative; }}
    .sidebar-toggle {{ position: absolute; opacity: 0; pointer-events: none; }}
    .sidebar-button {{ display: inline-grid; place-items: center; width: 34px; height: 34px; border: 1px solid var(--border); border-radius: 10px; background: rgba(255, 255, 255, .06); color: var(--soft); cursor: pointer; }}
    .chat-sidebar {{ min-height: 0; border-right: 1px solid var(--border); background: #070c12; padding: 14px; overflow: auto; }}
    .chat-sidebar-top {{ display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }}
    .chat-sidebar h2 {{ margin: 0; font-size: 17px; flex: 1; }}
    .tree-group {{ margin: 8px 0 10px; }}
    .tree-project {{ display: block; padding: 11px 12px; border-radius: 12px; color: #fff; text-decoration: none; font-weight: 800; }}
    .tree-subproject {{ display: block; padding: 9px 10px 9px 24px; border-radius: 12px; color: var(--soft); text-decoration: none; }}
    .tree-project.active, .tree-subproject.active, .tree-session.active {{ background: var(--surface-2); }}
    .tree-session {{ display: block; padding: 9px 10px 9px 36px; border-radius: 12px; color: var(--soft); text-decoration: none; }}
    .tree-date {{ display: block; margin-top: 1px; color: var(--muted); font-size: 12px; font-weight: 500; }}
    .tree-project:hover, .tree-subproject:hover, .tree-session:hover {{ background: rgba(255, 255, 255, .06); }}
    .sidebar-actions {{ display: grid; gap: 8px; margin: 10px 0 16px; }}
    .sidebar-actions details {{ border: 1px solid var(--border); border-radius: 12px; background: rgba(255,255,255,.04); padding: 10px; }}
    .sidebar-actions summary {{ cursor: pointer; font-weight: 800; color: var(--soft); }}
    .sidebar-actions input, .sidebar-actions textarea, .sidebar-actions select {{ margin-top: 8px; padding: 8px 9px; font-size: 14px; }}
    .sidebar-actions button {{ width: 100%; margin-top: 8px; padding: 8px 10px; }}
    .sidebar-toggle:checked ~ .chat-sidebar {{ display: none; }}
    .sidebar-toggle:checked ~ .chat-main {{ grid-column: 1 / -1; }}
    .chat-main {{ min-width: 0; min-height: 0; height: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }}
    .home-shell .chat-main {{ display: grid; place-items: center; }}
    .home-start {{ text-align: center; max-width: 760px; padding: 24px; }}
    .home-start h1 {{ font-size: clamp(30px, 5vw, 46px); }}
    .chat-top {{ padding: 14px 20px; border-bottom: 1px solid var(--border); background: rgba(13, 19, 27, .72); display: flex; gap: 12px; align-items: center; }}
    .chat-title {{ min-width: 0; }}
    .chat-top h1 {{ font-size: clamp(22px, 3vw, 34px); margin-bottom: 4px; }}
    .chat-feed {{ min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 22px 24px; scroll-behavior: smooth; }}
    .empty-chat {{ min-height: 42vh; display: grid; place-items: center; text-align: center; color: var(--muted); }}
    .composer {{ border-top: 1px solid var(--border); background: rgba(11, 15, 20, .98); padding: 12px 18px 14px; z-index: 3; }}
    .composer-panel {{ max-width: 920px; margin: 0 auto; border: 1px solid var(--border); border-radius: 18px; padding: 12px; background: var(--surface); }}
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
    .compact-form {{ display: flex; gap: 10px; align-items: end; }}
    @media (max-width: 860px) {{
      body.chat-body {{ overflow: hidden; }}
      main {{ padding: 20px 14px 38px; }}
      .hero {{ display: block; }}
      .form-grid, .composer-actions {{ grid-template-columns: 1fr; }}
      .chat-body main {{ height: calc(100vh - 89px); min-height: 0; padding: 0; }}
      .chat-shell {{ grid-template-columns: 1fr; }}
      .chat-sidebar {{ display: none; position: absolute; inset: 0 auto 0 0; width: min(86vw, 330px); z-index: 8; box-shadow: var(--shadow); }}
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
      let sending = false;
      let previewUrl = null;
      if (feed) feed.scrollTop = feed.scrollHeight;
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
        const content = escapeHtml(message.content || "").replaceAll("\\n", "<br>");
        const meta = [message.provider, message.model].filter(Boolean).map(escapeHtml).join(" ");
        const cost = message.estimated_cost !== null && message.estimated_cost !== undefined ? `<div class="muted">estimated cost: USD ${{escapeHtml(message.estimated_cost)}}</div>` : "";
        return `<div class="message-row ${{role}}"><div class="message ${{role}}"><div class="message-role">${{role}}</div><div>${{content}}</div>${{renderAttachments(message.attachments)}}${{meta ? `<div class="muted">${{meta}}</div>` : ""}}${{cost}}</div></div>`;
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
        if (event.key === "Enter" && !event.shiftKey) {{
          event.preventDefault();
          composer.requestSubmit();
        }}
      }});
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
  <aside class="chat-sidebar">
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
        return f"""<section class="hero">
  <div>
    <h1>{html(project['title'])}</h1>
    <p class="muted"><code>{html(project_path)}</code> · owner={html(project.get('owner') or '-')} · {html(project.get('visibility', 'private'))}</p>
    <p>{html(project.get('notes', ''))}</p>
  </div>
  <a class="button-link secondary" href="/projects">Projects</a>
</section>
<div class="grid">
  <div class="panel"><strong>{html(t(language, 'active_skills'))}</strong><div>{self.skill_pills(active_skills) or '<span class="muted">No skills selected.</span>'}</div></div>
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
  <aside class="chat-sidebar">
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
        return self.sidebar_actions(active_project_path) + ("".join(groups) or '<p class="muted">No projects yet.</p>')

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
                f"""<a class="tree-session{session_active}" href="/chat/{project_path}/{session['slug']}">
  {html(session['title'])}
  <span class="tree-date">{html(short_date(session.get('created_at')))}</span>
</a>"""
            )
        return f"""<div class="tree-group">
  <a class="{project_class}{active}" href="/project/{project_path}">
    {html(project['title'])}
    <span class="tree-date">{html(short_date(project.get('created_at')))}</span>
  </a>
  {''.join(session_links)}
</div>"""

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
            path = storage.workspace_path(self.root) / avatar
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
            path = attachments.attachment_dir(self.root, project_path, session_slug) / attachments.safe_filename(filename)
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
        content = html(message.get("content", "")).replace("\n", "<br>")
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


def selected(value: object, expected: str) -> str:
    return "selected" if value == expected else ""


def short_date(value: object) -> str:
    text = str(value or "")
    return text[:10] if len(text) >= 10 else text


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
    return {
        "filename": filename,
        "url": f"/attachment/{project_path}/{session_slug}/{filename}",
        "content_type": content_type,
        "size": metadata.get("size", 0),
        "is_image": content_type in {"png", "jpg", "jpeg", "gif", "webp"},
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
