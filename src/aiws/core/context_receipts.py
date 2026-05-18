"""Context receipt helpers for completed model turns."""

from __future__ import annotations

from aiws import storage
from aiws.infra import file_store

PRIOR_FILE_TRIGGERS = (
    "previous file",
    "previous files",
    "earlier file",
    "all files",
    "project files",
    "other files",
    "attached files",
    "session files",
    "compare with",
    "이전 파일",
    "이전 첨부",
    "다른 파일",
    "모든 파일",
    "전체 파일",
    "프로젝트 파일",
    "첨부파일들",
    "비교",
)


def current_attachment_filenames(user_metadata: dict[str, object] | None) -> set[str]:
    if not isinstance(user_metadata, dict):
        return set()
    attachments = user_metadata.get("attachments", [])
    if not isinstance(attachments, list):
        return set()
    names: set[str] = set()
    for item in attachments:
        if isinstance(item, dict) and item.get("filename"):
            names.add(str(item["filename"]))
    return names


def should_include_prior_files(content: str, *, has_current_file: bool) -> bool:
    del has_current_file
    return requests_prior_files(content)


def requests_prior_files(content: str) -> bool:
    text = " ".join(content.lower().split())
    return any(trigger in text for trigger in PRIOR_FILE_TRIGGERS)


def build_context_receipt(
    manifest: dict[str, object],
    provider: str,
    model: str,
    cost: dict[str, object],
    *,
    current_files: set[str] | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
) -> dict[str, object]:
    raw_files = manifest.get("files", [])
    files = [item for item in raw_files if isinstance(item, dict)] if isinstance(raw_files, list) else []
    active = current_files or set()
    if active:
        used_files = [item for item in files if str(item.get("filename", "")) in active]
    else:
        used_files = [
            item
            for item in files
            if item.get("delivery") in {"Sent as text context", "Sent as vision input", "Sent as file input", "vision", "text_context"}
        ]
    unused_files = [item for item in files if item not in used_files]
    raw_privacy = manifest.get("privacy", {})
    privacy = raw_privacy if isinstance(raw_privacy, dict) else {}
    return {
        "created_at": storage.utc_now(),
        "provider": provider,
        "model": model,
        "context_mode": manifest.get("context_mode", "unspecified"),
        "context_plan": manifest.get("context_plan", {}),
        "privacy_mode": manifest.get("privacy_mode", "local"),
        "model_delivery": privacy.get("model_delivery", ""),
        "privacy": privacy,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "used_files": used_files,
        "unused_files": unused_files,
        "analysis": _analysis_receipt(used_files),
        "included_chunks": manifest.get("included_chunks", []),
        "excluded": manifest.get("excluded", []),
        "estimated_cost": cost.get("estimated_cost"),
        "actual_cost": cost.get("estimated_cost"),
        "currency": cost.get("currency", "USD"),
    }


def append_context_receipt(
    root: str,
    project_path: str,
    session_slug: str,
    receipt: dict[str, object],
) -> dict[str, object]:
    path = storage.session_dir(root, project_path, session_slug) / "context_receipts.jsonl"
    file_store.append_jsonl(path, receipt)
    return receipt


def _analysis_receipt(files: list[dict[str, object]]) -> dict[str, object]:
    csv_items = []
    artifacts = []
    raw_text_sent = False
    computed_profile_sent = False
    for item in files:
        analysis = item.get("analysis")
        if isinstance(analysis, dict) and analysis:
            csv_items.append(analysis)
        for artifact in item.get("analysis_artifacts", []) if isinstance(item.get("analysis_artifacts"), list) else []:
            if isinstance(artifact, dict):
                artifacts.append(artifact)
        raw_text_sent = raw_text_sent or bool(item.get("raw_text_sent_to_model"))
        computed_profile_sent = computed_profile_sent or bool(item.get("computed_profile_sent_to_model"))
    return {
        "csv": csv_items,
        "artifacts": artifacts,
        "raw_text_sent_to_model": raw_text_sent,
        "computed_profile_sent_to_model": computed_profile_sent,
    }
