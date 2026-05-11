"""Attachment storage and lightweight text extraction."""

from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from . import storage

SUPPORTED_ATTACHMENT_EXTENSIONS = {".txt", ".md", ".pdf", ".docx", ".png", ".jpg", ".jpeg", ".gif", ".webp"}
MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024


def validate_attachment(filename: str, content: bytes) -> str:
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_ATTACHMENT_EXTENSIONS:
        raise storage.WorkspaceError("Unsupported attachment type.")
    if not content:
        raise storage.WorkspaceError("Attachment is empty.")
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise storage.WorkspaceError("Attachment is too large.")
    return ext


def is_image_extension(extension: str) -> bool:
    return extension.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp"}


def image_mime_type(extension: str) -> str:
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }.get(extension.lower(), "application/octet-stream")


def attachment_dir(root: str | Path, project_path: str, session_slug: str) -> Path:
    return storage.session_dir(root, project_path, session_slug) / "attachments"


def save_attachment(
    root: str | Path,
    project_path: str,
    session_slug: str,
    filename: str,
    content: bytes,
    *,
    actor: str | None = None,
    delivery: str | None = None,
) -> dict[str, object]:
    ext = validate_attachment(filename, content)
    storage.load_session(root, project_path, session_slug)
    safe_name = safe_filename(filename)
    path = attachment_dir(root, project_path, session_slug)
    path.mkdir(parents=True, exist_ok=True)
    destination = unique_path(path / safe_name)
    destination.write_bytes(content)
    try:
        extracted = extract_text(destination, ext)
    except Exception:
        extracted = ""
    resolved_delivery = delivery
    if not resolved_delivery:
        if is_image_extension(ext):
            resolved_delivery = "stored_only"
        elif extracted.strip():
            resolved_delivery = "text_context"
        else:
            resolved_delivery = "stored_only"
    metadata = {
        "filename": destination.name,
        "path": str(destination.relative_to(storage.workspace_path(root))),
        "content_type": ext.lstrip("."),
        "size": len(content),
        "text": extracted,
        "delivery": resolved_delivery,
        "created_at": storage.utc_now(),
        "actor": actor,
    }
    append_attachment_metadata(root, project_path, session_slug, metadata)
    return metadata


def list_attachments(root: str | Path, project_path: str, session_slug: str) -> list[dict[str, object]]:
    path = attachment_dir(root, project_path, session_slug) / "attachments.jsonl"
    if not path.exists():
        return []
    items: list[dict[str, object]] = []
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


def append_attachment_metadata(
    root: str | Path, project_path: str, session_slug: str, metadata: dict[str, object]
) -> None:
    path = attachment_dir(root, project_path, session_slug)
    path.mkdir(parents=True, exist_ok=True)
    with (path / "attachments.jsonl").open("a", encoding="utf-8") as file:
        file.write(json.dumps(metadata, ensure_ascii=False) + "\n")


def safe_filename(filename: str) -> str:
    name = Path(filename).name
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(name).stem).strip("-._") or "attachment"
    return stem + Path(name).suffix.lower()


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    for index in range(1, 1000):
        candidate = path.with_name(f"{path.stem}-{index}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise storage.WorkspaceError("Could not allocate attachment filename.")


def extract_text(path: Path, extension: str) -> str:
    if extension in {".txt", ".md"}:
        return path.read_text(encoding="utf-8", errors="replace")[:50_000]
    if extension == ".docx":
        return extract_docx_text(path)[:50_000]
    if extension == ".pdf":
        return extract_pdf_text(path.read_bytes())[:50_000]
    if extension in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
        return f"Image attachment: {path.name}"
    return ""


def extract_docx_text(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        xml = archive.read("word/document.xml")
    root = ElementTree.fromstring(xml)
    texts = [node.text or "" for node in root.iter() if node.tag.endswith("}t")]
    return "\n".join(texts)


def extract_pdf_text(content: bytes) -> str:
    # Lightweight fallback extraction. Full PDF parsing can be delegated later.
    chunks = re.findall(rb"\(([^()]{0,4000})\)", content)
    if not chunks:
        chunks = re.findall(rb"\(([^()]*)\)", content)
    decoded = [chunk.decode("latin-1", errors="ignore") for chunk in chunks]
    return "\n".join(item for item in decoded if item.strip())
