"""Read-only OpenClaw integration helpers."""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_TIMEOUT = 8


@dataclass
class CommandResult:
    ok: bool
    stdout: str
    stderr: str
    returncode: int | None


def executable() -> str | None:
    return shutil.which("openclaw")


def run_openclaw(args: list[str], *, timeout: int = DEFAULT_TIMEOUT) -> CommandResult:
    binary = executable()
    if not binary:
        return CommandResult(False, "", "openclaw is not installed.", None)
    try:
        completed = subprocess.run(
            [binary, "--no-color", *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        return CommandResult(False, exc.stdout or "", exc.stderr or "openclaw command timed out.", None)
    return CommandResult(completed.returncode == 0, completed.stdout, completed.stderr, completed.returncode)


def version() -> str:
    result = run_openclaw(["--version"], timeout=4)
    return result.stdout.strip() if result.ok else ""


def gateway_status() -> dict[str, Any]:
    result = run_openclaw(["gateway", "status", "--json"], timeout=8)
    output = "\n".join(part for part in (result.stdout.strip(), result.stderr.strip()) if part)
    if output.startswith("{"):
        try:
            payload = json.loads(output)
            rpc = payload.get("rpc", {}) if isinstance(payload, dict) else {}
            gateway = payload.get("gateway", {}) if isinstance(payload, dict) else {}
            summary = {
                "runtime": str(payload.get("service", {}).get("runtime", {}).get("status", "")) if isinstance(payload.get("service"), dict) else "",
                "gateway": f"{gateway.get('bindHost', '')}:{gateway.get('port', '')}".strip(":") if isinstance(gateway, dict) else "",
                "connectivity_probe": "ok" if rpc.get("ok") else "failed",
                "capability": str(rpc.get("capability", "")),
                "dashboard": f"http://127.0.0.1:{gateway.get('port')}/" if isinstance(gateway, dict) and gateway.get("port") else "",
            }
            return {
                "ok": bool(result.ok and rpc.get("ok")),
                "returncode": result.returncode,
                "summary": {key: value for key, value in summary.items() if value},
                "output": output[-4000:],
            }
        except json.JSONDecodeError:
            pass
    if not output:
        fallback = run_openclaw(["gateway", "status"], timeout=8)
        output = "\n".join(part for part in (fallback.stdout.strip(), fallback.stderr.strip()) if part)
    return {
        "ok": result.ok,
        "returncode": result.returncode,
        "summary": parse_gateway_status(output),
        "output": output[-4000:],
    }


def sessions(limit: int = 10) -> dict[str, Any]:
    result = run_openclaw(["sessions", "--json", "--limit", str(limit)], timeout=8)
    output = result.stdout.strip()
    if result.ok and output:
        try:
            payload = json.loads(output)
            if isinstance(payload, dict):
                return payload
        except json.JSONDecodeError:
            pass
    return {
        "path": "",
        "count": 0,
        "totalCount": 0,
        "limitApplied": limit,
        "hasMore": False,
        "activeMinutes": None,
        "sessions": [],
        "error": (result.stderr or result.stdout).strip()[-1000:],
    }


def status() -> dict[str, Any]:
    binary = executable()
    installed = bool(binary)
    status_payload = {
        "installed": installed,
        "binary": binary or "",
        "version": version() if installed else "",
        "state_dir": str(Path.home() / ".openclaw"),
        "gateway": gateway_status() if installed else {"ok": False, "summary": {"runtime": "not installed"}, "output": ""},
        "sessions": sessions() if installed else {"count": 0, "totalCount": 0, "sessions": []},
    }
    return status_payload


def parse_gateway_status(output: str) -> dict[str, str]:
    summary: dict[str, str] = {}
    for line in output.splitlines():
        stripped = line.strip()
        if not stripped or ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        normalized = key.strip().lower().replace(" ", "_")
        if normalized in {
            "service",
            "file_logs",
            "config_(cli)",
            "config_(service)",
            "gateway",
            "probe_target",
            "dashboard",
            "runtime",
            "connectivity_probe",
            "capability",
        }:
            summary[normalized] = value.strip()
    if "connectivity_probe" not in summary and "ECONNREFUSED" in output:
        summary["connectivity_probe"] = "failed"
    return summary
