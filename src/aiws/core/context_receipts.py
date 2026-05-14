"""Context receipt helpers for completed model turns."""

from __future__ import annotations

from typing import Any

from aiws import storage

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
    if not has_current_file:
        return True
    text = " ".join(content.lower().split())
    return any(trigger in text for trigger in PRIOR_FILE_TRIGGERS)


def build_context_receipt(
    manifest: dict[str, object],
    provider: str,
    model: str,
    cost: dict[str, object],
    *,
    current_files: set[str] | None = None,
) -> dict[str, object]:
    files = [item for item in manifest.get("files", []) if isinstance(item, dict)]
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
    return {
        "created_at": storage.utc_now(),
        "provider": provider,
        "model": model,
        "privacy_mode": manifest.get("privacy_mode", "local"),
        "privacy": manifest.get("privacy", {}),
        "used_files": used_files,
        "unused_files": unused_files,
        "excluded": manifest.get("excluded", []),
        "estimated_cost": cost.get("estimated_cost"),
        "currency": cost.get("currency", "USD"),
    }
