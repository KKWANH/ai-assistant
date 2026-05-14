"""Local-only AIWS administrator dashboard."""

from __future__ import annotations

import argparse
import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

from . import storage
from .env import load_env


LOG_NAMES = ("aiws-server.log", "aiws-cloudflare-monitor.log", "cloudflared.log")


def default_root() -> Path:
    load_env()
    return Path(os.environ.get("AIWS_ROOT", str(Path.home() / ".ai-workspace"))).expanduser()


def admin_snapshot(root: str | Path) -> dict[str, object]:
    base = storage.workspace_path(root)
    runtime = read_json(base / "runtime-status.json")
    usage = storage.list_model_usage(root)
    recent_usage = usage[-20:]
    failed_usage = [item for item in usage if item.get("status") == "failed"][-10:]
    logs = {name: tail_text(base / "logs" / name, 80) for name in LOG_NAMES}
    return {
        "workspace": str(base),
        "runtime": runtime,
        "counts": {
            "accounts": len(storage.list_accounts(root)),
            "model_usage_records": len(usage),
            "failed_model_calls": len([item for item in usage if item.get("status") == "failed"]),
        },
        "model_usage": {
            "recent": recent_usage,
            "failed": failed_usage,
            "day_usd": storage.model_usage_total_usd(root, None, period="day"),
            "month_usd": storage.model_usage_total_usd(root, None, period="month"),
        },
        "logs": logs,
        "analysis": analyze_snapshot(runtime, failed_usage, logs),
    }


def analyze_snapshot(runtime: dict[str, object], failed_usage: list[dict[str, object]], logs: dict[str, str]) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    status = str(runtime.get("status") or "unknown")
    if status != "running":
        findings.append({"severity": "warning", "title": "Runtime is not running", "detail": status})
    if failed_usage:
        latest = failed_usage[-1]
        findings.append(
            {
                "severity": "error",
                "title": "Recent model call failed",
                "detail": f"{latest.get('provider')} {latest.get('model')}: {latest.get('error', '')}",
            }
        )
    server_log = logs.get("aiws-server.log", "")
    if "Traceback" in server_log or "ERROR" in server_log:
        findings.append({"severity": "error", "title": "Server log contains errors", "detail": "Check aiws-server.log tail."})
    tunnel_log = logs.get("cloudflared.log", "")
    if "ERR" in tunnel_log or "error" in tunnel_log.lower():
        findings.append({"severity": "warning", "title": "Cloudflare log contains warnings", "detail": "Check cloudflared.log tail."})
    if not findings:
        findings.append({"severity": "ok", "title": "No obvious local runtime problems", "detail": "Logs and model usage look clean."})
    return findings


def read_json(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return payload if isinstance(payload, dict) else {}


def tail_text(path: Path, lines: int) -> str:
    if not path.exists():
        return ""
    try:
        return "\n".join(path.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:])
    except OSError:
        return ""


def render_dashboard(snapshot: dict[str, object], analysis_result: str = "") -> str:
    runtime = snapshot.get("runtime") if isinstance(snapshot.get("runtime"), dict) else {}
    counts = snapshot.get("counts") if isinstance(snapshot.get("counts"), dict) else {}
    usage = snapshot.get("model_usage") if isinstance(snapshot.get("model_usage"), dict) else {}
    findings = snapshot.get("analysis") if isinstance(snapshot.get("analysis"), list) else []
    logs = snapshot.get("logs") if isinstance(snapshot.get("logs"), dict) else {}
    return f"""<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AIWS Local Admin</title>
  <style>
    :root {{ color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #05070b; color: #f3f7ff; }}
    body {{ margin: 0; padding: 24px; }}
    main {{ max-width: 1180px; margin: 0 auto; display: grid; gap: 16px; }}
    .grid {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }}
    section, .card {{ border: 1px solid rgba(255,255,255,.1); border-radius: 16px; padding: 14px; background: #111722; }}
    h1, h2, p {{ margin-top: 0; }}
    small, .muted {{ color: #9aabc6; }}
    pre {{ overflow: auto; white-space: pre-wrap; background: #060910; border-radius: 12px; padding: 12px; }}
    button, select, textarea {{ border: 1px solid rgba(255,255,255,.16); border-radius: 12px; padding: 10px; background: #0b0f16; color: #f3f7ff; }}
    textarea {{ width: 100%; min-height: 120px; box-sizing: border-box; }}
    form {{ display: grid; gap: 10px; }}
    .ok {{ color: #5ee2a0; }} .warning {{ color: #f0c674; }} .error {{ color: #ff6978; }}
    @media (max-width: 780px) {{ body {{ padding: 12px; }} .grid {{ grid-template-columns: 1fr; }} }}
  </style>
</head>
<body>
<main>
  <header>
    <h1>AIWS Local Admin</h1>
    <p class="muted">Local-only status, model usage, logs, and structured diagnostics.</p>
  </header>
  <div class="grid">
    <div class="card"><small>Runtime</small><h2>{escape(runtime.get("status", "unknown"))}</h2><p>{escape(runtime.get("message", ""))}</p></div>
    <div class="card"><small>Failed model calls</small><h2>{escape(counts.get("failed_model_calls", 0))}</h2><p>month USD {escape(round(float(usage.get("month_usd") or 0.0), 6))}</p></div>
    <div class="card"><small>Workspace</small><h2>{escape(counts.get("accounts", 0))} accounts</h2><p>{escape(snapshot.get("workspace", ""))}</p></div>
  </div>
  <section>
    <h2>Findings</h2>
    {''.join(f'<p class="{escape(item.get("severity", ""))}"><strong>{escape(item.get("title", ""))}</strong><br><small>{escape(item.get("detail", ""))}</small></p>' for item in findings if isinstance(item, dict))}
  </section>
  <section>
    <h2>Structured Analysis Form</h2>
    <form method="post" action="/analyze">
      <select name="kind">
        <option value="runtime">Runtime health</option>
        <option value="model-errors">Model error triage</option>
        <option value="logs">Log summary</option>
      </select>
      <textarea name="note" placeholder="Optional note for the diagnostic run"></textarea>
      <button type="submit">Run local analysis</button>
    </form>
    {f'<pre>{escape(analysis_result)}</pre>' if analysis_result else ''}
  </section>
  <section>
    <h2>Recent Model Failures</h2>
    <pre>{escape(json.dumps(usage.get("failed", []), indent=2, ensure_ascii=False))}</pre>
  </section>
  <section>
    <h2>Logs</h2>
    {''.join(f'<h3>{escape(name)}</h3><pre>{escape(text)}</pre>' for name, text in logs.items())}
  </section>
</main>
</body>
</html>"""


def structured_analysis(snapshot: dict[str, object], kind: str, note: str) -> str:
    findings = snapshot.get("analysis", [])
    usage = snapshot.get("model_usage") if isinstance(snapshot.get("model_usage"), dict) else {}
    if kind == "model-errors":
        failed = usage.get("failed", [])
        return json.dumps({"kind": kind, "note": note, "failed_count": len(failed), "recent_failed": failed}, indent=2, ensure_ascii=False)
    if kind == "logs":
        logs = snapshot.get("logs", {})
        return json.dumps({"kind": kind, "note": note, "findings": findings, "log_names": list(logs)}, indent=2, ensure_ascii=False)
    return json.dumps({"kind": "runtime", "note": note, "findings": findings, "runtime": snapshot.get("runtime", {})}, indent=2, ensure_ascii=False)


def escape(value: object) -> str:
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


class AdminHandler(BaseHTTPRequestHandler):
    root: Path

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def do_GET(self) -> None:
        snapshot = admin_snapshot(self.root)
        if self.path == "/api/status":
            self.send_json(snapshot)
            return
        self.send_html(render_dashboard(snapshot))

    def do_POST(self) -> None:
        if self.path != "/analyze":
            self.send_response(HTTPStatus.NOT_FOUND)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        data = parse_qs(self.rfile.read(length).decode("utf-8", errors="replace"))
        snapshot = admin_snapshot(self.root)
        result = structured_analysis(snapshot, (data.get("kind") or ["runtime"])[0], (data.get("note") or [""])[0])
        self.send_html(render_dashboard(snapshot, result))

    def send_json(self, payload: dict[str, object]) -> None:
        body = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, html: str) -> None:
        body = html.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def serve(root: Path, port: int) -> None:
    AdminHandler.root = root
    server = ThreadingHTTPServer(("127.0.0.1", port), AdminHandler)
    server.serve_forever()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="AIWS local admin monitor")
    parser.add_argument("--root", default=str(default_root()))
    parser.add_argument("--port", type=int, default=int(os.environ.get("AIWS_ADMIN_PORT", "8790")))
    parser.add_argument("--snapshot", action="store_true")
    args = parser.parse_args(argv)
    root = Path(args.root).expanduser()
    if args.snapshot:
        print(json.dumps(admin_snapshot(root), indent=2, ensure_ascii=False))
        return 0
    serve(root, args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
