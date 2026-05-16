"""aiws.yaml parsing and local project action execution."""

from __future__ import annotations

import fnmatch
import json
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aiws import openclaw, storage
from aiws.core import contracts
from aiws.infra import file_store
from aiws.infra.paths import resolve_under_root
from aiws.tools import python_script, shell

ACTION_KINDS = {"prompt_recipe", "shell", "python", "file_index", "codex_prompt", "openclaw_status"}
SECRET_PATTERNS = {
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "id_rsa",
    "id_ed25519",
    ".ssh/*",
    "secrets/*",
    "secret/*",
    "credentials/*",
    "wallets/*",
    "private/*",
    "Library/Application Support/Google/Chrome/*",
    "Library/Application Support/BraveSoftware/*",
}

CAPABILITY_KEYS = {
    "read_files",
    "write_files",
    "run_shell",
    "run_python",
    "allow_network",
    "allow_cloud",
    "allow_external_paths",
}


@dataclass(frozen=True)
class ActionCapability:
    read_files: bool = False
    write_files: bool = False
    run_shell: bool = False
    run_python: bool = False
    allow_network: bool = False
    allow_cloud: bool = False
    allow_external_paths: bool = False

    def to_dict(self) -> dict[str, bool]:
        return {
            "read_files": self.read_files,
            "write_files": self.write_files,
            "run_shell": self.run_shell,
            "run_python": self.run_python,
            "allow_network": self.allow_network,
            "allow_cloud": self.allow_cloud,
            "allow_external_paths": self.allow_external_paths,
        }

    def enabled(self) -> list[str]:
        return [key for key, value in self.to_dict().items() if value]


def config_path(root: str | Path, project_path: str) -> Path:
    return storage.project_dir(root, project_path) / "aiws.yaml"


def has_config(root: str | Path, project_path: str) -> bool:
    return config_path(root, project_path).exists()


def load_config(root: str | Path, project_path: str) -> dict[str, Any]:
    storage.ensure_project_exists(root, project_path)
    path = config_path(root, project_path)
    if not path.exists():
        return default_config(root, project_path)
    loaded = parse_simple_yaml(path.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise storage.WorkspaceError("aiws.yaml must contain a mapping.")
    return validate_config(root, project_path, loaded)


def default_config(root: str | Path, project_path: str) -> dict[str, Any]:
    project = storage.load_project(root, project_path)
    return validate_config(
        root,
        project_path,
        {
            "name": project.get("title", project_path),
            "description": project.get("notes", ""),
            "root": ".",
            "permissions": {"file_read": True, "file_write": "confirm", "shell": "confirm", "network": False},
            "context": {"include": [], "exclude": list(sorted(SECRET_PATTERNS))},
            "panels": ["files", "memory", "commands", "runs", "artifacts"],
            "commands": {},
        },
    )


def validate_config(root: str | Path, project_path: str, config: dict[str, Any]) -> dict[str, Any]:
    project_root = storage.project_dir(root, project_path)
    version = int(config.get("version", 1))
    if version != 1:
        raise storage.WorkspaceError(f"Unsupported aiws.yaml version: {version}")
    project_config = config.get("project") if isinstance(config.get("project"), dict) else {}
    configured_root = str(config.get("root") or project_config.get("root") or ".")
    workspace_root = resolve_project_root(project_root, configured_root)
    if not workspace_root.is_relative_to(project_root.resolve()) and not bool(config.get("allow_external_root", False)):
        raise storage.WorkspaceError("aiws.yaml root must stay inside the project unless allow_external_root is true.")
    commands = config.get("actions") if isinstance(config.get("actions"), dict) else config.get("commands") or {}
    if not isinstance(commands, dict):
        raise storage.WorkspaceError("aiws.yaml actions/commands must be a mapping.")
    normalized_commands: dict[str, Any] = {}
    for name, command in commands.items():
        if not isinstance(command, dict):
            raise storage.WorkspaceError(f"Command must be a mapping: {name}")
        kind = str(command.get("kind", "prompt_recipe"))
        if kind not in ACTION_KINDS:
            raise storage.WorkspaceError(f"Unsupported project action kind: {kind}")
        normalized = dict(command)
        normalized["kind"] = kind
        normalized["name"] = str(name)
        normalized.setdefault("label", str(name).replace("_", " ").title())
        normalized.setdefault("description", "")
        normalized.setdefault("permission", permission_for_kind(kind))
        normalized["permissions"] = normalize_action_permissions(kind, normalized.get("permissions"))
        normalized["output_type"] = normalize_output_type(normalized)
        normalized["outputs"] = normalize_outputs(normalized)
        assert_no_secret_references(workspace_root, normalized)
        normalized_commands[str(name)] = normalized
    context = config.get("context") if isinstance(config.get("context"), dict) else {}
    permissions = config.get("permissions") if isinstance(config.get("permissions"), dict) else {}
    return {
        "version": version,
        "name": str(config.get("name") or storage.load_project(root, project_path).get("title", project_path)),
        "description": str(config.get("description", "")),
        "root": configured_root,
        "resolved_root": str(workspace_root),
        "permissions": {
            "file_read": permissions.get("file_read", True),
            "file_write": permissions.get("file_write", "confirm"),
            "shell": permissions.get("shell", "confirm"),
            "network": permissions.get("network", False),
        },
        "context": {
            "include": list(context.get("include") or []),
            "exclude": list(context.get("exclude") or sorted(SECRET_PATTERNS)),
        },
        "panels": list(config.get("panels") or ["files", "memory", "commands", "runs", "artifacts"]),
        "views": normalize_views(config),
        "actions": normalized_commands,
        "commands": normalized_commands,
    }


def normalize_action_permissions(kind: str, value: object) -> dict[str, bool]:
    base = {
        "file_read": False,
        "file_write": False,
        "network": False,
        "shell": False,
        "python": False,
    }
    if kind in {"prompt_recipe", "file_index", "codex_prompt", "openclaw_status"}:
        base["file_read"] = True
    if kind == "shell":
        base["shell"] = True
    if kind == "python":
        base["python"] = True
    if isinstance(value, dict):
        for key in base:
            if key in value:
                base[key] = bool(value[key])
    return base


def capabilities_for_action(command: dict[str, Any]) -> ActionCapability:
    raw_permissions = command.get("permissions")
    permissions = raw_permissions if isinstance(raw_permissions, dict) else {}
    inputs = normalize_string_list(command.get("input") or command.get("inputs"))
    outputs = normalize_outputs(command)
    return ActionCapability(
        read_files=bool(permissions.get("file_read")) or bool(inputs),
        write_files=bool(permissions.get("file_write")) or bool(outputs),
        run_shell=bool(permissions.get("shell")),
        run_python=bool(permissions.get("python")),
        allow_network=bool(permissions.get("network")),
        allow_cloud=bool(permissions.get("cloud") or permissions.get("allow_cloud")),
        allow_external_paths=bool(permissions.get("external_paths") or permissions.get("allow_external_paths")),
    )


def ensure_capabilities(command: dict[str, Any], capabilities: ActionCapability, *, approved: bool) -> None:
    kind = str(command.get("kind", ""))
    if kind == "shell" and not capabilities.run_shell:
        raise storage.WorkspaceError("Shell action requires run_shell capability.")
    if kind == "python" and not capabilities.run_python:
        raise storage.WorkspaceError("Python action requires run_python capability.")
    if command.get("network") and not capabilities.allow_network:
        raise storage.WorkspaceError("Network action requires allow_network capability.")
    if capabilities.enabled() and kind in {"shell", "python"} and not approved:
        raise storage.WorkspaceError("This action requires explicit confirmation.")


def log_event(event_type: str, message: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "type": event_type,
        "message": message,
        "content": message,
        "created_at": storage.utc_now(),
        "metadata": metadata or {},
    }


def normalize_views(config: dict[str, Any]) -> list[dict[str, Any]]:
    raw_views = config.get("views")
    if isinstance(raw_views, list):
        views: list[dict[str, Any]] = []
        for index, item in enumerate(raw_views):
            if not isinstance(item, dict):
                continue
            panels = []
            for panel_index, panel in enumerate(item.get("panels") or []):
                if isinstance(panel, dict):
                    panel_type = str(panel.get("type") or "webPreview")
                    panels.append(
                        contracts.panel_contract(
                            panel_id=str(panel.get("id") or f"{item.get('id', 'view')}-{panel_type}-{panel_index}"),
                            panel_type=panel_type,
                            title=str(panel.get("title") or panel_type),
                            source=str(panel.get("source") or ""),
                            layout=str(panel.get("layout") or "main"),
                            actions=normalize_string_list(panel.get("actions")),
                            visibility=str(panel.get("visibility") or "private"),
                            props={
                                key: value
                                for key, value in panel.items()
                                if key not in {"id", "type", "title", "source", "layout", "actions", "visibility"}
                            },
                        )
                    )
            views.append(
                {
                    "id": str(item.get("id") or f"view-{index + 1}"),
                    "title": str(item.get("title") or item.get("id") or f"View {index + 1}"),
                    "layout": str(item.get("layout") or "sidebar"),
                    "panels": panels,
                }
            )
        if views:
            return views
    panels = [
        contracts.panel_contract(panel_id=str(panel), panel_type=legacy_panel_type(str(panel)), title=legacy_panel_title(str(panel)))
        for panel in (config.get("panels") or ["files", "memory", "commands", "runs", "artifacts"])
    ]
    return [{"id": "project", "title": str(config.get("name") or "Project Workbench"), "layout": "sidebar", "panels": panels}]


def legacy_panel_type(panel: str) -> str:
    return {
        "files": "fileExplorer",
        "commands": "actionLauncher",
        "runs": "runTimeline",
        "artifacts": "artifactGallery",
        "memory": "markdownViewer",
    }.get(panel, "webPreview")


def legacy_panel_title(panel: str) -> str:
    return {
        "files": "Files",
        "commands": "Actions",
        "runs": "Recent Runs",
        "artifacts": "Artifacts",
        "memory": "Memory",
    }.get(panel, panel.replace("_", " ").title())


def resolve_project_root(project_root: Path, configured: str) -> Path:
    raw = Path(os.path.expanduser(configured or "."))
    if raw.is_absolute():
        return raw.resolve()
    return (project_root / raw).resolve()


def permission_for_kind(kind: str) -> str:
    if kind in {"shell", "python"}:
        return "confirm-command"
    return "read-only"


def preview_action(root: str | Path, project_path: str, command_name: str) -> dict[str, Any]:
    config = load_config(root, project_path)
    command = command_by_name(config, command_name)
    project_root = Path(config["resolved_root"])
    cwd = resolve_cwd(project_root, command)
    expected_inputs = expected_input_files(project_root, config, command)
    expected_outputs = normalize_outputs(command)
    capabilities = capabilities_for_action(command)
    return {
        "project_path": project_path,
        "command": command_name,
        "kind": command["kind"],
        "output_type": command.get("output_type", normalize_output_type(command)),
        "label": command["label"],
        "description": command.get("description", ""),
        "cwd": str(cwd),
        "script": command.get("script", ""),
        "command_line": command.get("command", ""),
        "args": list(command.get("args", []) or []),
        "prompt": command.get("prompt", ""),
        "expected_input_files": expected_inputs,
        "expected_output_files": expected_outputs,
        "permission": command.get("permission", permission_for_kind(command["kind"])),
        "requires_confirmation": command["kind"] in {"shell", "python"},
        "capabilities": capabilities.to_dict(),
        "required_capabilities": capabilities.enabled(),
    }


def run_action(
    root: str | Path,
    project_path: str,
    command_name: str,
    *,
    actor: str | None = None,
    confirmed: bool = False,
) -> dict[str, Any]:
    preview = preview_action(root, project_path, command_name)
    config = load_config(root, project_path)
    command = command_by_name(config, command_name)
    project_root = Path(config["resolved_root"])
    capabilities = capabilities_for_action(command)
    ensure_capabilities(command, capabilities, approved=confirmed)
    run_id = storage.utc_now().replace(":", "").replace(".", "-")
    run_path = storage.project_dir(root, project_path) / "runs" / run_id
    run_path.mkdir(parents=True, exist_ok=False)
    stdout = ""
    stderr = ""
    status = "completed"
    logs: list[dict[str, Any]] = [
        log_event("preview", "Action preview created.", {"command": command_name, "kind": command["kind"]}),
        log_event(
            "approval", "Action approval checked.", {"confirmed": bool(confirmed), "required": bool(preview["requires_confirmation"])}
        ),
    ]
    result: dict[str, Any] = {"preview": preview}
    try:
        if command["kind"] == "prompt_recipe":
            stdout = str(command.get("prompt", ""))
            result["prompt"] = stdout
        elif command["kind"] == "codex_prompt":
            stdout = build_codex_prompt(config, command)
            result["prompt"] = stdout
        elif command["kind"] == "file_index":
            files = expected_input_files(project_root, config, command)
            stdout = "\n".join(files)
            result["files"] = files
        elif command["kind"] == "openclaw_status":
            result["openclaw"] = openclaw.status()
            stdout = json.dumps(result["openclaw"], ensure_ascii=False, indent=2)
        elif command["kind"] == "shell":
            logs.append(
                log_event("execute", "Running shell action.", {"cwd": preview.get("cwd", ""), "command": preview.get("command_line", "")})
            )
            shell_completed = shell.run(
                str(command.get("command", "")),
                cwd=resolve_cwd(project_root, command),
                root=project_root,
            )
            stdout, stderr = shell_completed.stdout, shell_completed.stderr
            status = "completed" if shell_completed.returncode == 0 else "failed"
            result["returncode"] = shell_completed.returncode
        elif command["kind"] == "python":
            script_path = safe_child_path(project_root, str(command.get("script", "")))
            args = [
                str(resolve_action_arg(project_root, item)) if looks_like_path_arg(str(item)) else str(item)
                for item in command.get("args", []) or []
            ]
            logs.append(
                log_event("execute", "Running Python action.", {"cwd": preview.get("cwd", ""), "script": str(script_path), "args": args})
            )
            python_completed = python_script.run(
                script_path,
                args,
                cwd=resolve_cwd(project_root, command),
                root=project_root,
                allow_network=capabilities.allow_network,
            )
            stdout, stderr = python_completed.stdout, python_completed.stderr
            status = "completed" if python_completed.returncode == 0 else "failed"
            result["returncode"] = python_completed.returncode
        else:
            raise storage.WorkspaceError(f"Unsupported project action kind: {command['kind']}")
    except Exception as exc:
        status = "failed"
        stderr = f"{type(exc).__name__}: {exc}"
        result["error"] = stderr
        logs.append(log_event("error", stderr))
    artifacts = collect_artifacts(project_root, preview, source_run=run_id)
    if artifacts:
        logs.append(log_event("artifact", "Collected expected artifacts.", {"count": len(artifacts)}))
    run = contracts.run_contract(
        run_id=run_id,
        action_id=command_name,
        command_id=command_name,
        project_path=project_path,
        label=str(command["label"]),
        actor=actor or "local",
        status=status,
        created_at=storage.utc_now(),
        plan={
            "steps": [
                {"id": "preview", "status": "completed"},
                {"id": "approval", "status": "completed" if confirmed or not preview["requires_confirmation"] else "waiting"},
                {"id": "execute", "status": status},
                {"id": "artifacts", "status": "completed"},
            ],
            "preview": preview,
        },
        logs=logs,
        artifacts=artifacts,
        errors=[stderr] if stderr and status == "failed" else [],
        kind=str(command["kind"]),
        approval={
            "confirmed": bool(confirmed),
            "approved_by": (actor or "local") if confirmed else "",
            "required": bool(preview["requires_confirmation"]),
        },
        capabilities=capabilities.to_dict(),
        inputs={
            "expected_files": preview.get("expected_input_files", []),
            "cwd": preview.get("cwd", ""),
            "command_line": preview.get("command_line", ""),
            "script": preview.get("script", ""),
            "args": preview.get("args", []),
        },
        outputs={"expected_files": preview.get("expected_output_files", [])},
        stdout=stdout,
        stderr=stderr,
        workspace_id=f"project:{project_path}",
        error=str(result.get("error", "")),
    )
    run["run_dir"] = str(run_path)
    run["stdout_path"] = "stdout.txt"
    run["stderr_path"] = "stderr.txt"
    run["result_path"] = "result.json"
    result["run"] = run
    write_run_artifacts(run_path, run, stdout, stderr, result)
    return run | {"stdout": stdout, "stderr": stderr, "result": result}


def run_chat_summary(run: dict[str, Any]) -> str:
    """Return a concise tool-message summary for a completed project action."""
    lines = [
        f"Project action completed: {run.get('label', run.get('command', 'run'))}",
        f"- Status: {run.get('status', 'unknown')}",
        f"- Kind: {run.get('kind', '')}",
        f"- Run ID: {run.get('run_id', '')}",
    ]
    stdout = str(run.get("stdout", "")).strip()
    stderr = str(run.get("stderr", "")).strip()
    artifacts = run.get("artifacts", [])
    if stdout:
        lines.extend(["", "Stdout:", stdout[:2000]])
    if stderr:
        lines.extend(["", "Stderr:", stderr[:2000]])
    if isinstance(artifacts, list) and artifacts:
        lines.append("")
        lines.append("Artifacts:")
        for item in artifacts:
            if isinstance(item, dict):
                lines.append(f"- {item.get('path', '')} ({'exists' if item.get('exists') else 'missing'})")
    return "\n".join(lines)


def write_run_artifacts(run_path: Path, run: dict[str, Any], stdout: str, stderr: str, result: dict[str, Any]) -> None:
    file_store.atomic_write_text(run_path / "stdout.txt", stdout)
    file_store.atomic_write_text(run_path / "stderr.txt", stderr)
    storage.write_json(run_path / "run.json", run)
    storage.write_json(run_path / "result.json", result)
    file_store.atomic_write_text(
        run_path / "logs.jsonl",
        "\n".join(json.dumps(item, ensure_ascii=False) for item in run.get("logs", []) or []) + ("\n" if run.get("logs") else ""),
    )
    lines = [
        f"# {run['label']}",
        "",
        f"- Run: `{run['run_id']}`",
        f"- Kind: `{run['kind']}`",
        f"- Status: `{run['status']}`",
        f"- Actor: `{run['actor']}`",
        "",
        "## Stdout",
        "",
        "```text",
        stdout.strip(),
        "```",
        "",
        "## Stderr",
        "",
        "```text",
        stderr.strip(),
        "```",
        "",
    ]
    file_store.atomic_write_text(run_path / "run.md", "\n".join(lines))


def collect_artifacts(project_root: Path, preview: dict[str, Any], *, source_run: str = "") -> list[dict[str, Any]]:
    artifacts: list[dict[str, Any]] = []
    for value in preview.get("expected_output_files", []) or []:
        path = safe_child_path(project_root, str(value))
        size = path.stat().st_size if path.exists() and path.is_file() else 0
        artifacts.append(
            contracts.artifact_contract(
                artifact_id=f"{source_run}:{value}" if source_run else str(value),
                path=str(value),
                source_run=source_run,
                size=size,
                summary="Generated project action artifact" if path.exists() else "Expected artifact not found",
            )
            | {"exists": path.exists()}
        )
    return artifacts


def read_run_detail(root: str | Path, project_path: str, run_id: str) -> dict[str, Any]:
    safe_run_id = run_id.strip()
    if not safe_run_id or "/" in safe_run_id or "\\" in safe_run_id:
        raise storage.WorkspaceError("Invalid run id.")
    run_path = storage.project_dir(root, project_path) / "runs" / safe_run_id
    result_path = run_path / "result.json"
    if not result_path.exists():
        raise storage.WorkspaceError("Run does not exist.")
    result = storage.read_json(result_path)
    return {
        "run": result.get("run", {}),
        "result": result,
        "stdout": read_text_if_exists(run_path / "stdout.txt"),
        "stderr": read_text_if_exists(run_path / "stderr.txt"),
        "logs": read_jsonl_if_exists(run_path / "logs.jsonl"),
        "markdown": read_text_if_exists(run_path / "run.md"),
    }


def read_project_artifact(root: str | Path, project_path: str, artifact_path: str) -> dict[str, Any]:
    config = load_config(root, project_path)
    project_root = Path(config["resolved_root"])
    rel = artifact_path.strip().lstrip("/")
    if not rel:
        raise storage.WorkspaceError("Artifact path is required.")
    if is_secret_reference(rel):
        raise storage.WorkspaceError("Artifact path is blocked.")
    resolved = resolve_under_root(project_root, rel)
    first = Path(rel).parts[0] if Path(rel).parts else ""
    if first not in {"artifacts", "files", "runs"}:
        raise storage.WorkspaceError("Only project files, artifacts, and runs can be opened.")
    if not resolved.exists() or not resolved.is_file():
        raise storage.WorkspaceError("Artifact file does not exist.")
    if resolved.stat().st_size > 1_000_000:
        raise storage.WorkspaceError("Artifact is too large to preview.")
    text = resolved.read_text(encoding="utf-8", errors="replace")
    suffix = resolved.suffix.lower().lstrip(".") or "text"
    contract = contracts.artifact_contract(
        artifact_id=rel,
        path=rel,
        source_run="",
        size=resolved.stat().st_size,
    )
    return contract | {
        "path": rel,
        "kind": suffix,
        "size": resolved.stat().st_size,
        "content": text,
    }


def read_text_if_exists(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace") if path.exists() and path.is_file() else ""


def read_jsonl_if_exists(path: Path) -> list[dict[str, Any]]:
    if not path.exists() or not path.is_file():
        return []
    items: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            items.append(value)
    return items


def latest_runs(root: str | Path, project_path: str, *, limit: int = 10) -> list[dict[str, Any]]:
    runs_root = storage.project_dir(root, project_path) / "runs"
    if not runs_root.exists():
        return []
    runs: list[dict[str, Any]] = []
    run_paths = sorted(runs_root.glob("*/run.json"), reverse=True)
    if not run_paths:
        run_paths = sorted(runs_root.glob("*/result.json"), reverse=True)
    for result_path in run_paths[:limit]:
        try:
            result = storage.read_json(result_path)
        except (OSError, json.JSONDecodeError):
            continue
        run = result.get("run") if result_path.name == "result.json" else result
        if isinstance(run, dict):
            runs.append(run)
    return runs


def latest_run_context(root: str | Path, project_path: str, *, limit: int = 3) -> str:
    runs = latest_runs(root, project_path, limit=limit)
    if not runs:
        return ""
    lines = ["## Recent Project Action Runs", ""]
    for run in runs:
        lines.extend(
            [
                f"### {run.get('label', run.get('command', 'run'))}",
                f"- Kind: `{run.get('kind', '')}`",
                f"- Status: `{run.get('status', '')}`",
                f"- Created: `{run.get('created_at', '')}`",
                "",
            ]
        )
    return "\n".join(lines)


def suggest_actions(
    root: str | Path,
    project_path: str,
    *,
    messages: list[dict[str, Any]] | None = None,
    limit: int = 3,
) -> list[dict[str, Any]]:
    """Suggest configured project commands from recent chat text."""
    config = load_config(root, project_path)
    commands = config.get("commands", {})
    if not commands:
        return []
    text = "\n".join(str(message.get("content", "")) for message in (messages or [])[-6:]).lower()
    suggestions: list[dict[str, Any]] = []
    for name, command in commands.items():
        score = action_score(str(name), command, text)
        if score <= 0:
            continue
        suggestions.append(
            {
                "command": name,
                "label": command.get("label", name),
                "description": command.get("description", ""),
                "kind": command.get("kind", "prompt_recipe"),
                "permission": command.get("permission", permission_for_kind(command.get("kind", "prompt_recipe"))),
                "score": score,
            }
        )
    return sorted(suggestions, key=lambda item: (-int(item["score"]), str(item["command"])))[:limit]


def action_score(name: str, command: dict[str, Any], text: str) -> int:
    haystack = " ".join(
        [
            name,
            str(command.get("label", "")),
            str(command.get("description", "")),
            str(command.get("prompt", "")),
        ]
    ).lower()
    if not text.strip():
        return 1 if command.get("kind") in {"prompt_recipe", "file_index"} else 0
    score = 0
    for token in meaningful_tokens(text):
        if token in haystack:
            score += 3
    keyword_map = {
        "pdf": {"summarize", "summary", "요약", "문서", "document", "file_index"},
        "파일": {"file", "index", "문서", "요약"},
        "문서": {"summarize", "summary", "document", "파일"},
        "코드": {"codex", "python", "shell", "test", "bugfix"},
        "실행": {"shell", "python", "run", "export"},
        "리밸런": {"rebalance", "portfolio", "risk"},
        "포트폴리오": {"portfolio", "rebalance", "risk"},
        "위험": {"risk", "check"},
    }
    for token, hints in keyword_map.items():
        if token in text and any(hint in haystack for hint in hints):
            score += 5
    return score


def meaningful_tokens(text: str) -> list[str]:
    tokens = []
    for raw in text.replace("/", " ").replace("_", " ").replace("-", " ").split():
        token = raw.strip(".,:;!?()[]{}\"'`").lower()
        if len(token) >= 3:
            tokens.append(token)
    return tokens[:80]


def command_by_name(config: dict[str, Any], command_name: str) -> dict[str, Any]:
    command = config.get("commands", {}).get(command_name)
    if not isinstance(command, dict):
        raise storage.WorkspaceError(f"Project action does not exist: {command_name}")
    return command


def resolve_cwd(project_root: Path, command: dict[str, Any]) -> Path:
    return safe_child_path(project_root, str(command.get("cwd", ".")))


def safe_child_path(root: Path, value: str) -> Path:
    if not value:
        raise storage.WorkspaceError("Path is required.")
    path = resolve_under_root(root, value)
    if is_secret_path(path):
        raise storage.WorkspaceError("Action references a blocked secret path.")
    return path


def resolve_action_arg(project_root: Path, value: object) -> Path:
    path = safe_child_path(project_root, str(value))
    return path


def looks_like_path_arg(value: str) -> bool:
    if not value or value.startswith("-"):
        return False
    if "/" in value or "\\" in value:
        return True
    return Path(value).suffix != ""


def assert_no_secret_references(project_root: Path, command: dict[str, Any]) -> None:
    values: list[str] = []
    for key in ("cwd", "script", "command"):
        if command.get(key):
            values.append(str(command[key]))
    for key in ("args", "input", "inputs", "outputs"):
        values.extend(normalize_string_list(command.get(key)))
    raw_output = command.get("output")
    if isinstance(raw_output, list):
        values.extend(str(item) for item in raw_output)
    for value in values:
        if is_secret_reference(value):
            raise storage.WorkspaceError("Action references a blocked secret path.")
        candidate = resolve_under_root(project_root, value)
        if is_secret_path(candidate):
            raise storage.WorkspaceError("Action references a blocked secret path.")


def is_secret_path(path: Path) -> bool:
    parts = set(path.parts)
    if {".ssh", "secrets", "secret", "credentials", "wallets"} & parts:
        return True
    name = path.name.lower()
    return name == ".env" or name.startswith(".env.") or name.endswith((".pem", ".key"))


def expected_input_files(project_root: Path, config: dict[str, Any], command: dict[str, Any]) -> list[str]:
    explicit = command.get("input") or command.get("inputs")
    if explicit:
        return [str(item) for item in explicit]
    includes = command.get("include") or config.get("context", {}).get("include") or []
    excludes = set(command.get("exclude") or config.get("context", {}).get("exclude") or [])
    found: list[str] = []
    for pattern in includes:
        for path in project_root.glob(str(pattern)):
            if path.is_file():
                rel = path.relative_to(project_root).as_posix()
                if not any(fnmatch.fnmatch(rel, item) for item in excludes) and not is_secret_path(path):
                    found.append(rel)
    return sorted(dict.fromkeys(found))


def normalize_output_type(command: dict[str, Any]) -> str:
    explicit = command.get("output_type")
    if explicit:
        return str(explicit)
    output = command.get("output")
    if isinstance(output, str) and output in {"chat_prompt", "artifact", "chat_reply", "file_view", "codex_prompt"}:
        return output
    if command.get("kind") == "prompt_recipe":
        return "chat_prompt"
    if command.get("kind") in {"python", "shell"}:
        return "artifact"
    if command.get("kind") == "file_index":
        return "file_view"
    if command.get("kind") == "codex_prompt":
        return "codex_prompt"
    return "run_log"


def normalize_outputs(command: dict[str, Any]) -> list[str]:
    if "outputs" in command:
        return normalize_string_list(command.get("outputs"))
    output = command.get("output")
    if isinstance(output, list):
        return [str(item) for item in output]
    return []


def normalize_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [str(item) for item in value]
    return [str(value)]


def is_secret_reference(value: str) -> bool:
    return any(fnmatch.fnmatch(value, pattern) or pattern in value for pattern in SECRET_PATTERNS)


def build_codex_prompt(config: dict[str, Any], command: dict[str, Any]) -> str:
    return "\n".join(
        [
            "# Codex Task Prompt",
            "",
            f"Project: {config['name']}",
            f"Description: {config.get('description', '')}",
            "",
            command.get("prompt", "Use the project files and goal to complete the next task."),
            "",
            "Constraints:",
            "- Keep changes local-first.",
            "- Do not read secrets or credential files.",
            "- Verify with tests when practical.",
        ]
    )


def import_template(root: str | Path, project_path: str, template_name: str) -> dict[str, Any]:
    source = Path(__file__).resolve().parents[3] / "templates" / template_name
    if not source.exists():
        raise storage.WorkspaceError(f"Template does not exist: {template_name}")
    destination = storage.project_dir(root, project_path)
    for child in source.iterdir():
        target = destination / child.name
        if target.exists():
            continue
        if child.is_dir():
            shutil.copytree(child, target)
        else:
            shutil.copy2(child, target)
    return load_config(root, project_path)


def parse_simple_yaml(text: str) -> dict[str, Any]:
    lines = text.splitlines()
    value, _ = parse_block(lines, 0, 0)
    return value if isinstance(value, dict) else {}


def parse_block(lines: list[str], index: int, indent: int) -> tuple[Any, int]:
    mapping: dict[str, Any] = {}
    sequence: list[Any] | None = None
    while index < len(lines):
        raw = lines[index]
        if not raw.strip() or raw.lstrip().startswith("#"):
            index += 1
            continue
        current_indent = len(raw) - len(raw.lstrip(" "))
        if current_indent < indent:
            break
        if current_indent > indent:
            break
        stripped = raw.strip()
        if stripped.startswith("- "):
            if sequence is None:
                sequence = []
            item = stripped[2:]
            if ":" in item and not item.endswith(":"):
                key, value = item.split(":", 1)
                entry = {key.strip(): parse_scalar(value.strip())}
                index += 1
                if index < len(lines):
                    child_indent = len(lines[index]) - len(lines[index].lstrip(" "))
                    if lines[index].strip() and child_indent > current_indent:
                        child, index = parse_block(lines, index, child_indent)
                        if isinstance(child, dict):
                            entry.update(child)
                sequence.append(entry)
            elif item.endswith(":"):
                key = item[:-1].strip()
                child, index = parse_block(lines, index + 1, indent + 2)
                sequence.append({key: child})
            else:
                sequence.append(parse_scalar(item))
                index += 1
            continue
        if sequence is not None:
            break
        if ":" not in stripped:
            index += 1
            continue
        key, value = stripped.split(":", 1)
        key = key.strip()
        value = value.strip()
        if value == "|":
            block, index = parse_literal(lines, index + 1, indent + 2)
            mapping[key] = block
        elif value:
            mapping[key] = parse_scalar(value)
            index += 1
        else:
            child, index = parse_block(lines, index + 1, indent + 2)
            mapping[key] = child
    return (sequence if sequence is not None else mapping), index


def parse_literal(lines: list[str], index: int, indent: int) -> tuple[str, int]:
    collected: list[str] = []
    while index < len(lines):
        raw = lines[index]
        current_indent = len(raw) - len(raw.lstrip(" "))
        if raw.strip() and current_indent < indent:
            break
        collected.append(raw[indent:] if len(raw) >= indent else "")
        index += 1
    return "\n".join(collected).rstrip() + "\n", index


def parse_scalar(value: str) -> Any:
    if value in {"true", "True"}:
        return True
    if value in {"false", "False"}:
        return False
    if value in {"null", "None", "~"}:
        return None
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    return value
