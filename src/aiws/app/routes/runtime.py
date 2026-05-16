"""Runtime status API payload builders."""

from __future__ import annotations

import json
import os
from pathlib import Path

from aiws import openclaw, storage


def env_flag(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def runtime_payload(root: str | Path, port: int, *, public_view: bool = False) -> dict[str, object]:
    workspace = storage.workspace_path(root)
    run_dir = Path(os.environ.get("AIWS_RUN_DIR", str(workspace / "run"))).expanduser()
    status_path = Path(os.environ.get("AIWS_STATUS_PATH", str(workspace / "runtime-status.json"))).expanduser()
    url_path = run_dir / "cloudflare-url.txt"
    status: dict[str, object] = {"status": "unknown", "cloudflare_url": "", "port": port}
    if status_path.exists():
        try:
            loaded = json.loads(status_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                status.update(loaded)
        except json.JSONDecodeError:
            status["message"] = "Runtime status file is not valid JSON."
    if url_path.exists():
        status["cloudflare_url"] = url_path.read_text(encoding="utf-8").strip()
    if public_view:
        public_url = status.get("public_url") or status.get("cloudflare_url") or ""
        return {
            "runtime": {
                "status": status.get("status", "unknown"),
                "cloudflare_url": public_url,
                "public_url": public_url,
                "public_view": True,
                "diagnostics_visible": False,
            }
        }
    if not env_flag("AIWS_SHOW_DIAGNOSTICS", True):
        return {
            "runtime": {
                "status": status.get("status", "unknown"),
                "cloudflare_url": status.get("cloudflare_url", ""),
                "public_url": status.get("public_url") or status.get("cloudflare_url", ""),
                "public_view": False,
                "diagnostics_visible": False,
            }
        }
    return {"runtime": status}


def openclaw_payload() -> dict[str, object]:
    return {"openclaw": openclaw.status()}
