"""aiws.yaml parsing and local project action execution."""

from __future__ import annotations

import fnmatch
import json
import os
import shutil
from pathlib import Path
from typing import Any

from aiws import openclaw, storage
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
    workspace_root = resolve_project_root(project_root, str(config.get("root", ".")))
    commands = config.get("commands") or {}
    if not isinstance(commands, dict):
        raise storage.WorkspaceError("aiws.yaml commands must be a mapping.")
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
        assert_no_secret_references(workspace_root, normalized)
        normalized_commands[str(name)] = normalized
    context = config.get("context") if isinstance(config.get("context"), dict) else {}
    permissions = config.get("permissions") if isinstance(config.get("permissions"), dict) else {}
    return {
        "name": str(config.get("name") or storage.load_project(root, project_path).get("title", project_path)),
        "description": str(config.get("description", "")),
        "root": str(config.get("root", ".")),
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
        "commands": normalized_commands,
    }


def resolve_project_root(project_root: Path, configured: str) -> Path:
    raw = Path(os.path.expanduser(configured or "."))
    if not raw.is_absolute():
        raw = project_root / raw
    return raw.resolve()


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
    expected_outputs = [str(item) for item in command.get("output", []) or command.get("outputs", []) or []]
    return {
        "project_path": project_path,
        "command": command_name,
        "kind": command["kind"],
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
    if preview["requires_confirmation"] and not confirmed:
        raise storage.WorkspaceError("This action requires explicit confirmation.")
    config = load_config(root, project_path)
    command = command_by_name(config, command_name)
    project_root = Path(config["resolved_root"])
    run_id = storage.utc_now().replace(":", "").replace(".", "-")
    run_path = storage.project_dir(root, project_path) / "runs" / run_id
    run_path.mkdir(parents=True, exist_ok=False)
    stdout = ""
    stderr = ""
    status = "completed"
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
            completed = shell.run(str(command.get("command", "")), cwd=resolve_cwd(project_root, command))
            stdout, stderr = completed.stdout, completed.stderr
            status = "completed" if completed.returncode == 0 else "failed"
            result["returncode"] = completed.returncode
        elif command["kind"] == "python":
            script_path = safe_child_path(project_root, str(command.get("script", "")))
            completed = python_script.run(script_path, [str(item) for item in command.get("args", []) or []], cwd=resolve_cwd(project_root, command))
            stdout, stderr = completed.stdout, completed.stderr
            status = "completed" if completed.returncode == 0 else "failed"
            result["returncode"] = completed.returncode
        else:
            raise storage.WorkspaceError(f"Unsupported project action kind: {command['kind']}")
    except Exception as exc:
        status = "failed"
        stderr = f"{type(exc).__name__}: {exc}"
        result["error"] = stderr
    run = {
        "run_id": run_id,
        "project_path": project_path,
        "command": command_name,
        "kind": command["kind"],
        "label": command["label"],
        "status": status,
        "actor": actor or "local",
        "created_at": storage.utc_now(),
        "run_dir": str(run_path),
        "stdout_path": "stdout.txt",
        "stderr_path": "stderr.txt",
        "result_path": "result.json",
        "artifacts": collect_artifacts(project_root, preview),
    }
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
    (run_path / "stdout.txt").write_text(stdout, encoding="utf-8")
    (run_path / "stderr.txt").write_text(stderr, encoding="utf-8")
    storage.write_json(run_path / "result.json", result)
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
    (run_path / "run.md").write_text("\n".join(lines), encoding="utf-8")


def collect_artifacts(project_root: Path, preview: dict[str, Any]) -> list[dict[str, Any]]:
    artifacts: list[dict[str, Any]] = []
    for value in preview.get("expected_output_files", []) or []:
        path = safe_child_path(project_root, str(value))
        artifacts.append(
            {
                "path": str(value),
                "exists": path.exists(),
                "size": path.stat().st_size if path.exists() and path.is_file() else 0,
            }
        )
    return artifacts


def latest_runs(root: str | Path, project_path: str, *, limit: int = 10) -> list[dict[str, Any]]:
    runs_root = storage.project_dir(root, project_path) / "runs"
    if not runs_root.exists():
        return []
    runs: list[dict[str, Any]] = []
    for result_path in sorted(runs_root.glob("*/result.json"), reverse=True)[:limit]:
        try:
            result = storage.read_json(result_path)
        except (OSError, json.JSONDecodeError):
            continue
        run = result.get("run")
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
    path = (root / value).resolve() if not Path(value).expanduser().is_absolute() else Path(value).expanduser().resolve()
    if is_secret_path(path):
        raise storage.WorkspaceError("Action references a blocked secret path.")
    return path


def assert_no_secret_references(project_root: Path, command: dict[str, Any]) -> None:
    values: list[str] = []
    for key in ("cwd", "script", "command"):
        if command.get(key):
            values.append(str(command[key]))
    for key in ("args", "input", "inputs", "output", "outputs"):
        for item in command.get(key, []) or []:
            values.append(str(item))
    for value in values:
        if any(fnmatch.fnmatch(value, pattern) or pattern in value for pattern in SECRET_PATTERNS):
            raise storage.WorkspaceError("Action references a blocked secret path.")
        candidate = (project_root / value).resolve() if not Path(value).expanduser().is_absolute() else Path(value).expanduser().resolve()
        if is_secret_path(candidate):
            raise storage.WorkspaceError("Action references a blocked secret path.")


def is_secret_path(path: Path) -> bool:
    text = str(path)
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
                sequence.append({key.strip(): parse_scalar(value.strip())})
                index += 1
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
