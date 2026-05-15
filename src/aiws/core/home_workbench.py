"""Projectless Home Workbench actions, runs, and artifacts."""

from __future__ import annotations

import csv
import json
import shutil
import secrets
import statistics
from pathlib import Path
from typing import Any

from aiws import attachments, storage
from aiws.core import contracts
from aiws.infra import file_store
from aiws.infra.paths import resolve_under_root


HOME_ACTIONS: dict[str, dict[str, Any]] = {
    "document_summary": {
        "id": "document_summary",
        "title": "문서 요약하기",
        "description": "첨부 문서를 읽고 구조적 Markdown 요약 산출물을 만듭니다.",
        "category": "문서",
        "inputs": [".pdf", ".docx", ".txt", ".md"],
        "permission": "read-only",
        "status": "ready",
        "requires_confirmation": False,
        "expected_output_artifacts": ["summary.md"],
    },
    "image_explain": {
        "id": "image_explain",
        "title": "이미지 설명하기",
        "description": "vision 모델이 선택되면 실제 이미지 설명을 만들고, 아니면 필요한 모델을 명확히 안내합니다.",
        "category": "이미지",
        "inputs": [".png", ".jpg", ".jpeg", ".webp"],
        "permission": "read-only",
        "status": "ready",
        "requires_confirmation": False,
        "expected_output_artifacts": ["image-notes.md"],
    },
    "csv_analysis": {
        "id": "csv_analysis",
        "title": "CSV 분석하기",
        "description": "CSV 컬럼과 샘플을 분석하고 표/요약 artifact를 생성합니다.",
        "category": "데이터",
        "inputs": [".csv"],
        "permission": "read-only",
        "status": "ready",
        "requires_confirmation": False,
        "expected_output_artifacts": ["table.csv", "summary.md"],
    },
    "codex_task_prompt": {
        "id": "codex_task_prompt",
        "title": "Codex 작업지시 만들기",
        "description": "상황, 관련 파일, 제약, 완료 기준을 Codex 실행용 작업지시 Markdown으로 정리합니다.",
        "category": "코드",
        "inputs": ["brief"],
        "permission": "read-only",
        "status": "ready",
        "requires_confirmation": False,
        "expected_output_artifacts": ["codex-prompt.md"],
    },
    "investment_rebalancer": {
        "id": "investment_rebalancer",
        "title": "투자 포트폴리오 리밸런싱",
        "description": "투자 작업실 템플릿으로 승격하기 전 입력 파일과 실행 계획을 정리합니다.",
        "category": "투자",
        "inputs": [".csv", ".yaml"],
        "permission": "read-only",
        "status": "ready",
        "requires_confirmation": False,
        "expected_output_artifacts": ["investment-workflow.md"],
    },
    "folder_index": {
        "id": "folder_index",
        "title": "폴더 구조 읽기",
        "description": "로컬 폴더 인덱싱 작업실은 계획 중입니다.",
        "category": "파일",
        "inputs": ["folder"],
        "permission": "read-only",
        "status": "planned",
        "requires_confirmation": False,
        "expected_output_artifacts": [],
    },
}


def home_dir(root: str | Path, username: str | None) -> Path:
    slug = storage.slugify(username or "local")
    path = storage.workspace_path(root) / "users" / slug / "home"
    for child in ("files", "runs", "artifacts"):
        (path / child).mkdir(parents=True, exist_ok=True)
    return path


def list_actions() -> list[dict[str, Any]]:
    return [action_contract(item) for item in HOME_ACTIONS.values()]


def action_contract(action: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": action["id"],
        "title": action["title"],
        "label": action["title"],
        "description": action["description"],
        "category": action["category"],
        "inputs": list(action["inputs"]),
        "expected_input_files": list(action["inputs"]),
        "expected_output_artifacts": list(action["expected_output_artifacts"]),
        "steps": planner_steps(action["id"]),
        "permission": action["permission"],
        "requires_confirmation": action["requires_confirmation"],
        "suggested_panels": ["runTimeline", "artifactGallery", "plannerTrace"],
        "status": action["status"],
    }


def preview_action(action_id: str) -> dict[str, Any]:
    action = require_action(action_id)
    return {
        "action": action_contract(action),
        "available_files": [],
        "missing_files": [] if action_id == "codex_task_prompt" else list(action["inputs"]),
        "estimated_cost": {"local": True, "api_usd": 0},
        "plan": build_plan(action_id, has_file=False),
    }


def run_action(
    root: str | Path,
    username: str | None,
    action_id: str,
    *,
    actor: str | None = None,
    content: str = "",
    upload: tuple[str, bytes] | None = None,
    provider: str = "ollama",
    model: str = "qwen3:4b",
    model_response: str = "",
) -> dict[str, Any]:
    action = require_action(action_id)
    if action["status"] == "planned":
        raise storage.WorkspaceError("This starter action is planned but not implemented.")
    base = home_dir(root, username)
    run_id = storage.utc_now().replace(":", "").replace(".", "-") + "-" + secrets.token_hex(3)
    run_path = base / "runs" / run_id
    artifact_root = base / "artifacts" / run_id
    run_path.mkdir(parents=True, exist_ok=False)
    artifact_root.mkdir(parents=True, exist_ok=False)

    logs: list[dict[str, Any]] = []
    errors: list[str] = []
    artifacts_out: list[dict[str, Any]] = []
    saved_file = save_upload(base, upload, logs) if upload else None
    if action_requires_file(action) and not saved_file:
        raise storage.WorkspaceError("Attach a file before creating this artifact.")
    if action_id == "codex_task_prompt" and not content.strip():
        raise storage.WorkspaceError("Describe the situation before creating a Codex task brief.")
    plan = build_plan(action_id, has_file=saved_file is not None)
    status = "completed"
    try:
        created = create_action_artifacts(
            action_id,
            content,
            saved_file,
            artifact_root,
            logs,
            provider=provider,
            model=model,
            model_response=model_response,
        )
        for path, summary in created:
            rel = path.relative_to(base).as_posix()
            artifacts_out.append(
                contracts.artifact_contract(
                    artifact_id=f"{run_id}:{rel}",
                    path=rel,
                    source_run=run_id,
                    summary=summary,
                    size=path.stat().st_size,
                )
            )
    except Exception as exc:
        status = "failed"
        errors.append(f"{type(exc).__name__}: {exc}")
        logs.append(log_event("error", errors[-1]))

    run = contracts.run_contract(
        run_id=run_id,
        action_id=action_id,
        label=action["title"],
        actor=actor or "local",
        status=status,
        created_at=storage.utc_now(),
        plan=plan,
        logs=logs,
        artifacts=artifacts_out,
        errors=errors,
        kind="home_action",
        approval={"required": bool(action.get("requires_confirmation")), "confirmed": False, "approved_by": ""},
        capabilities={
            "read_files": bool(saved_file),
            "write_files": True,
            "run_shell": False,
            "run_python": False,
            "allow_network": False,
            "allow_cloud": provider != "ollama",
        },
        inputs={
            "content": content[:2000],
            "file": saved_file["path"] if saved_file else "",
            "provider": provider,
            "model": model,
        },
        outputs={"expected_artifacts": action.get("expected_output_artifacts", [])},
        error="\n".join(errors),
    )
    storage.write_json(run_path / "run.json", run)
    storage.write_json(run_path / "result.json", {"run": run})
    write_logs_jsonl(run_path, logs)
    file_store.atomic_write_text(run_path / "run.md", run_markdown(run))
    return run


def list_runs(root: str | Path, username: str | None, *, limit: int = 10) -> list[dict[str, Any]]:
    base = home_dir(root, username)
    runs: list[dict[str, Any]] = []
    for path in sorted((base / "runs").glob("*/run.json"), reverse=True)[:limit]:
        try:
            runs.append(storage.read_json(path))
        except (OSError, json.JSONDecodeError):
            continue
    return runs


def list_artifacts(root: str | Path, username: str | None, *, limit: int = 20) -> list[dict[str, Any]]:
    artifacts_out: list[dict[str, Any]] = []
    for run in list_runs(root, username, limit=limit):
        for item in run.get("artifacts", []) or []:
            if isinstance(item, dict):
                artifacts_out.append({**item, "run": {"run_id": run["run_id"], "label": run["label"], "status": run["status"]}})
    return artifacts_out[:limit]


def write_logs_jsonl(run_path: Path, logs: list[dict[str, Any]]) -> None:
    file_store.atomic_write_text(
        run_path / "logs.jsonl",
        "\n".join(json.dumps(item, ensure_ascii=False) for item in logs) + ("\n" if logs else ""),
    )


def read_logs_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists() or not path.is_file():
        return []
    logs: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            logs.append(value)
    return logs


def read_run_detail(root: str | Path, username: str | None, run_id: str) -> dict[str, Any]:
    base = home_dir(root, username)
    if not run_id or "/" in run_id or "\\" in run_id:
        raise storage.WorkspaceError("Invalid run id.")
    run_path = base / "runs" / run_id
    run_file = run_path / "run.json"
    if not run_file.exists():
        raise storage.WorkspaceError("Run does not exist.")
    run = storage.read_json(run_file)
    return {
        "run": run,
        "result": storage.read_json(run_path / "result.json") if (run_path / "result.json").exists() else {"run": run},
        "stdout": "",
        "stderr": "\n".join(run.get("errors", [])),
        "logs": read_logs_jsonl(run_path / "logs.jsonl"),
        "markdown": (run_path / "run.md").read_text(encoding="utf-8", errors="replace"),
    }


def read_artifact(root: str | Path, username: str | None, artifact_path: str) -> dict[str, Any]:
    base = home_dir(root, username)
    rel = artifact_path.strip().lstrip("/")
    if not rel or ".." in Path(rel).parts:
        raise storage.WorkspaceError("Invalid artifact path.")
    resolved = resolve_under_root(base, rel)
    if not resolved.exists() or not resolved.is_file():
        raise storage.WorkspaceError("Artifact file does not exist.")
    if resolved.stat().st_size > 1_000_000:
        raise storage.WorkspaceError("Artifact is too large to preview.")
    content = resolved.read_text(encoding="utf-8", errors="replace")
    contract = contracts.artifact_contract(
        artifact_id=rel,
        path=rel,
        source_run=Path(rel).parts[1] if len(Path(rel).parts) > 1 else "",
        size=resolved.stat().st_size,
    )
    return contract | {"kind": contract["type"], "content": content}


def create_report_from_artifact(root: str | Path, username: str | None, artifact_path: str, *, actor: str | None = None) -> dict[str, Any]:
    artifact = read_artifact(root, username, artifact_path)
    title = Path(artifact["path"]).name
    content = str(artifact.get("content", ""))
    return run_action(
        root,
        username,
        "codex_task_prompt",
        actor=actor,
        content=f"Create a concise report for artifact {title}.\n\n{content[:6000]}",
    )


def save_upload(base: Path, upload: tuple[str, bytes], logs: list[dict[str, Any]]) -> dict[str, Any]:
    filename, content = upload
    extension = Path(filename).suffix.lower()
    if extension == ".csv":
        if not content:
            raise storage.WorkspaceError("Attachment is empty.")
        if len(content) > attachments.max_attachment_bytes():
            raise storage.WorkspaceError("Attachment is too large.")
    else:
        extension = attachments.validate_attachment(filename, content)
    attachments.ensure_workspace_quota(base.parents[2], len(content))
    safe_name = storage.slugify_or_default(Path(filename).stem, "upload") + extension
    target = base / "files" / f"{storage.utc_now().replace(':', '').replace('.', '-')}-{safe_name}"
    target.write_bytes(content)
    logs.append(log_event("file", f"Stored input file: {target.name}"))
    text = ""
    if not attachments.is_image_extension(extension):
        if extension == ".csv":
            text = target.read_text(encoding="utf-8", errors="replace")[:50_000]
        else:
            text = attachments.extract_text(target, extension)
    return {"path": target.relative_to(base).as_posix(), "absolute": target, "filename": filename, "text": text}


def create_action_artifacts(
    action_id: str,
    content: str,
    saved_file: dict[str, Any] | None,
    artifact_root: Path,
    logs: list[dict[str, Any]],
    *,
    provider: str = "ollama",
    model: str = "qwen3:4b",
    model_response: str = "",
) -> list[tuple[Path, str]]:
    if action_id == "document_summary":
        text = input_text(content, saved_file)
        path = artifact_root / "summary.md"
        path.write_text(document_summary_markdown(text, saved_file), encoding="utf-8")
        logs.append(log_event("artifact", "Created document summary Markdown."))
        return [(path, "Structured document summary")]
    if action_id == "image_explain":
        path = artifact_root / "image-notes.md"
        path.write_text(image_notes_markdown(saved_file, provider, model, model_response), encoding="utf-8")
        logs.append(log_event("artifact", "Created image notes Markdown."))
        return [(path, "Image interpretation notes")]
    if action_id == "csv_analysis":
        return csv_artifacts(content, saved_file, artifact_root, logs)
    if action_id == "investment_rebalancer":
        path = artifact_root / "investment-workflow.md"
        path.write_text(investment_workflow_markdown(content, saved_file), encoding="utf-8")
        logs.append(log_event("artifact", "Created investment workflow brief."))
        return [(path, "Investment workflow brief")]
    path = artifact_root / "codex-prompt.md"
    path.write_text(codex_prompt_markdown(content), encoding="utf-8")
    logs.append(log_event("artifact", "Created Codex prompt Markdown."))
    return [(path, "Codex task prompt")]


def csv_artifacts(
    content: str, saved_file: dict[str, Any] | None, artifact_root: Path, logs: list[dict[str, Any]]
) -> list[tuple[Path, str]]:
    text = input_text(content, saved_file)
    rows = list(csv.reader(text.splitlines())) if text.strip() else []
    table = artifact_root / "table.csv"
    summary = artifact_root / "summary.md"
    if saved_file and Path(saved_file["absolute"]).suffix.lower() == ".csv":
        shutil.copy2(saved_file["absolute"], table)
    else:
        table.write_text(text, encoding="utf-8")
    headers = rows[0] if rows else []
    data_rows = rows[1:] if headers else rows
    summary.write_text(csv_summary_markdown(headers, data_rows, saved_file), encoding="utf-8")
    logs.append(log_event("artifact", "Created CSV table and summary artifacts."))
    return [(table, "CSV table preview"), (summary, "CSV analysis summary")]


def input_text(content: str, saved_file: dict[str, Any] | None) -> str:
    parts = [content.strip()]
    if saved_file and str(saved_file.get("text", "")).strip():
        parts.append(str(saved_file["text"]).strip())
    return "\n\n".join(part for part in parts if part)


def document_summary_markdown(text: str, saved_file: dict[str, Any] | None) -> str:
    source = saved_file["filename"] if saved_file else "typed input"
    status = "success" if text.strip() else "no readable text"
    limitation = (
        "This local starter uses extracted text and simple structure; ask a model for deeper interpretation."
        if text.strip()
        else "No text was extracted from the input."
    )
    excerpt = text[:2400].strip() or "(no extracted text)"
    return f"""# Document Summary

- Source: `{source}`
- Extraction status: `{status}`
- Mode: local starter action

## Key Points

{bulletize(excerpt)}

## Limitations

- {limitation}

## Follow-up Questions

- What decision should this document support?
- Should this become a repeatable project action?
- Do you want a report artifact for sharing?
"""


def image_notes_markdown(saved_file: dict[str, Any] | None, provider: str, model: str, model_response: str) -> str:
    source = saved_file["filename"] if saved_file else "no image attached"
    if not saved_file:
        status = "Needs file"
        body = "Attach a PNG, JPG, JPEG, or WebP image and run this action again."
    elif model_response.strip():
        if model_response.startswith("VISION_ERROR:"):
            status = "Failed"
            body = model_response.removeprefix("VISION_ERROR:").strip()
        else:
            status = "Implemented"
            body = model_response.strip()
    else:
        status = "Needs vision model"
        body = "Image interpretation was not run. Select a vision-capable cloud model such as Gemini Flash-Lite or Kimi with image input, then run this action again."
    return f"""# Image Notes

- Source: `{source}`
- Status: `{status}`
- Model: `{provider} {model}`

## Description

{body}

## Follow-up Questions

- What visible detail should be verified by a person?
- Should this image be saved into a project workspace?
"""


def csv_summary_markdown(headers: list[str], rows: list[list[str]], saved_file: dict[str, Any] | None) -> str:
    source = saved_file["filename"] if saved_file else "typed input"
    row_count = len(rows)
    col_count = len(headers) if headers else max((len(row) for row in rows), default=0)
    missing = missing_counts(headers, rows)
    numeric = numeric_stats(headers, rows)
    missing_lines = [f"- {name}: {count}" for name, count in missing.items() if count]
    numeric_lines = [
        f"- {name}: min {stats['min']:.4g}, max {stats['max']:.4g}, mean {stats['mean']:.4g}" for name, stats in numeric.items()
    ]
    return "\n".join(
        [
            "# CSV Analysis",
            "",
            f"- Source: `{source}`",
            f"- Rows: {row_count}",
            f"- Columns: {col_count}",
            f"- Headers: {', '.join(headers[:30]) if headers else '(none)'}",
            "",
            "## Missing Values",
            "",
            *(missing_lines or ["- No missing values detected in the parsed rows."]),
            "",
            "## Numeric Columns",
            "",
            *(numeric_lines or ["- No numeric columns detected."]),
            "",
            "## Next Actions",
            "",
            "- Ask AI about this artifact",
            "- Generate report",
            "- Save workflow as project",
        ]
    )


def missing_counts(headers: list[str], rows: list[list[str]]) -> dict[str, int]:
    names = headers or [f"column_{index + 1}" for index in range(max((len(row) for row in rows), default=0))]
    counts = {name: 0 for name in names}
    for row in rows:
        for index, name in enumerate(names):
            value = row[index].strip() if index < len(row) else ""
            if value == "":
                counts[name] += 1
    return counts


def numeric_stats(headers: list[str], rows: list[list[str]]) -> dict[str, dict[str, float]]:
    names = headers or [f"column_{index + 1}" for index in range(max((len(row) for row in rows), default=0))]
    stats: dict[str, dict[str, float]] = {}
    for index, name in enumerate(names):
        values: list[float] = []
        for row in rows:
            if index >= len(row):
                continue
            raw = row[index].strip().replace(",", "")
            if not raw:
                continue
            try:
                values.append(float(raw))
            except ValueError:
                values = []
                break
        if values:
            stats[name] = {"min": min(values), "max": max(values), "mean": statistics.fmean(values)}
    return stats


def investment_workflow_markdown(content: str, saved_file: dict[str, Any] | None) -> str:
    source = saved_file["filename"] if saved_file else "manual input"
    return f"""# Investment Workspace Starter

- Source: `{source}`
- Recommended project template: `investment-rebalancer`

## Suggested Panels

- Portfolio Table
- Allocation Chart
- Rebalance Action Panel
- Risk Report Markdown Panel
- Run Timeline

## Notes

{(content or "Import the investment template into a project to run the Python rebalancing action.").strip()}
"""


def codex_prompt_markdown(content: str) -> str:
    brief = content.strip()
    if not brief:
        raise storage.WorkspaceError("Describe the situation before creating a Codex task brief.")
    return f"""# Codex Task Brief

## Situation

{brief}

## Desired Outcome

- State the user-visible behavior that should change.
- Explain why the current behavior is confusing or insufficient.

## Relevant Files

- Add exact paths before handing this to Codex.
- Include screenshots or run/artifact ids when they explain the problem.

## Constraints

- Keep changes surgical.
- Preserve AIWS storage invariants.
- Do not expose secrets or API keys.
- Respect the project depth rule.
- Add focused tests for changed behavior.

## Acceptance Criteria

- The requested behavior works from the UI.
- Empty or misleading states are labeled honestly.
- Any generated artifact explains what input produced it.
- `python -m pytest` passes.

## Verification Commands

- `python -m pytest`
- `cd web && npm run build`
"""


def bulletize(text: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return "- No readable text was extracted."
    return "\n".join(f"- {line[:220]}" for line in lines[:8])


def build_plan(action_id: str, *, has_file: bool) -> dict[str, Any]:
    return {
        "intent": action_id,
        "required_context": [{"type": "file", "status": "available" if has_file else "optional"}],
        "estimated_cost": {"local": True, "api_usd": 0},
        "steps": planner_steps(action_id),
        "ui": {"open_panels": ["runTimeline", "artifactGallery", "plannerTrace"]},
        "requires_confirmation": False,
    }


def planner_steps(action_id: str) -> list[dict[str, str]]:
    return [
        {"id": "collect_input", "type": "file_parse", "output": "input_snapshot"},
        {"id": "create_artifact", "type": action_id, "output": "artifacts"},
        {"id": "suggest_next_actions", "type": "ui_update", "output": "next_actions"},
    ]


def run_markdown(run: dict[str, Any]) -> str:
    lines = [f"# {run['label']}", "", f"- Run: `{run['run_id']}`", f"- Status: `{run['status']}`", ""]
    if run.get("artifacts"):
        lines.append("## Artifacts")
        lines.extend(f"- `{item.get('path')}`" for item in run["artifacts"])
    return "\n".join(lines) + "\n"


def log_event(kind: str, content: str) -> dict[str, Any]:
    return {"created_at": storage.utc_now(), "kind": kind, "content": content}


def require_action(action_id: str) -> dict[str, Any]:
    action = HOME_ACTIONS.get(action_id)
    if not action:
        raise storage.WorkspaceError(f"Starter action does not exist: {action_id}")
    return action


def action_requires_file(action: dict[str, Any]) -> bool:
    return any(str(item).startswith(".") for item in action.get("inputs", []))
