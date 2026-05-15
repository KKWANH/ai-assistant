"""Attachment storage and lightweight text extraction."""

from __future__ import annotations

import csv
import json
import mimetypes
import os
import re
import zipfile
from io import StringIO
from pathlib import Path
from xml.etree import ElementTree

from . import storage
from .core import csv_profile
from .infra import file_store
from .infra.paths import resolve_under_root

SUPPORTED_TEXT_EXTENSIONS = {".txt", ".md", ".csv", ".json", ".yaml", ".yml"}
SUPPORTED_ATTACHMENT_EXTENSIONS = {
    *SUPPORTED_TEXT_EXTENSIONS,
    ".pdf",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
}
MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024
DEFAULT_WORKSPACE_ATTACHMENT_BYTES = 2 * 1024 * 1024 * 1024
SECRET_TEXT_PATTERNS = (
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['\"]?[^'\"\s]{12,}", re.IGNORECASE),
    re.compile(r"\b(?:sk|ghp|github_pat)_[A-Za-z0-9_]{20,}"),
)


def max_attachment_bytes() -> int:
    return int(os.environ.get("AIWS_MAX_ATTACHMENT_BYTES", str(MAX_ATTACHMENT_BYTES)))


def max_upload_bytes() -> int:
    return int(os.environ.get("AIWS_MAX_UPLOAD_BYTES", str(max_attachment_bytes() + 1024 * 1024)))


def max_workspace_attachment_bytes() -> int:
    return int(os.environ.get("AIWS_MAX_WORKSPACE_ATTACHMENT_BYTES", str(DEFAULT_WORKSPACE_ATTACHMENT_BYTES)))


def validate_attachment(filename: str, content: bytes) -> str:
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_ATTACHMENT_EXTENSIONS:
        raise storage.WorkspaceError("Unsupported attachment type.")
    if not content:
        raise storage.WorkspaceError("Attachment is empty.")
    if len(content) > max_attachment_bytes():
        raise storage.WorkspaceError("Attachment is too large.")
    return ext


def attachment_usage_bytes(root: str | Path) -> int:
    workspace = storage.workspace_path(root)
    total = 0
    for directory in ("projects", "users"):
        base = workspace / directory
        if not base.exists():
            continue
        for path in base.rglob("*"):
            is_session_attachment = (
                path.parent.name == "attachments" and len(path.parents) > 2 and path.parent.parent.parent.name == "sessions"
            )
            is_file_store_item = path.parent.name == "files"
            if path.is_file() and path.name != "attachments.jsonl" and (is_session_attachment or is_file_store_item):
                total += path.stat().st_size
    return total


def ensure_workspace_quota(root: str | Path, incoming_bytes: int) -> None:
    limit = max_workspace_attachment_bytes()
    if limit <= 0:
        return
    if attachment_usage_bytes(root) + incoming_bytes > limit:
        raise storage.WorkspaceError("Workspace attachment storage limit would be exceeded.")


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
    ensure_workspace_quota(root, len(content))
    safe_name = safe_filename(filename)
    path = attachment_dir(root, project_path, session_slug)
    path.mkdir(parents=True, exist_ok=True)
    destination = unique_path(path / safe_name)
    destination.write_bytes(content)
    extraction_error = ""
    profile: dict[str, object] | None = None
    analysis_artifacts: list[dict[str, object]] = []
    raw_text_sent_to_model = False
    raw_text_for_scan = content.decode("utf-8", errors="ignore")
    try:
        if ext in {".csv", ".xls", ".xlsx"}:
            if ext == ".csv":
                raw_text = destination.read_text(encoding="utf-8", errors="replace")
            elif ext == ".xls":
                raw_text = xls_first_sheet_csv(destination)
            else:
                raw_text = xlsx_first_sheet_csv(destination)
            raw_text_for_scan = raw_text
            profile = csv_profile.profile_csv_text(raw_text, filename=destination.name)
            artifact_root = storage.session_dir(root, project_path, session_slug) / "artifacts" / destination.stem
            analysis_artifacts = [
                {
                    **artifact,
                    "path": str((artifact_root / str(artifact["path"])).relative_to(storage.workspace_path(root))),
                    "source": "deterministic_csv_profile",
                }
                for artifact in csv_profile.write_csv_artifacts(artifact_root, profile, raw_text)
            ]
            extracted = csv_profile.model_context_from_profile(profile)
        else:
            extracted = extract_text(destination, ext)
            raw_text_sent_to_model = ext in SUPPORTED_TEXT_EXTENSIONS
    except Exception as exc:
        extracted = ""
        extraction_error = friendly_extraction_error(ext, exc)
    extraction_status = extraction_status_for(ext, extracted, extraction_error)
    resolved_delivery = delivery
    if not resolved_delivery:
        if is_image_extension(ext):
            resolved_delivery = "stored_only"
        elif extracted.strip():
            resolved_delivery = "text_context"
        else:
            resolved_delivery = "stored_only"
    metadata = {
        "id": destination.stem,
        "filename": destination.name,
        "original_filename": Path(filename).name,
        "path": str(destination.relative_to(storage.workspace_path(root))),
        "content_type": ext.lstrip("."),
        "mime": mimetypes.guess_type(destination.name)[0] or image_mime_type(ext),
        "size": len(content),
        "text": extracted,
        "text_available": bool(extracted.strip()) and not is_image_extension(ext),
        "extraction_status": extraction_status,
        "extraction_error": extraction_error or default_extraction_error(ext, extraction_status),
        "delivery": resolved_delivery,
        "raw_text_sent_to_model": raw_text_sent_to_model,
        "computed_profile_sent_to_model": ext in {".csv", ".xls", ".xlsx"} and bool(profile),
        "analysis_profile": profile or {},
        "analysis_artifacts": analysis_artifacts,
        "security_findings": scan_for_secret_patterns(raw_text_for_scan),
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


def append_attachment_metadata(root: str | Path, project_path: str, session_slug: str, metadata: dict[str, object]) -> None:
    path = attachment_dir(root, project_path, session_slug)
    path.mkdir(parents=True, exist_ok=True)
    file_store.append_jsonl(path / "attachments.jsonl", metadata)


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


def extraction_status_for(extension: str, extracted: str, extraction_error: str = "") -> str:
    ext = extension.lower()
    if is_image_extension(ext):
        return "stored"
    if extraction_error:
        return "failed"
    if extracted.strip():
        return "success"
    if ext in {".txt", ".md", ".pdf", ".docx", ".ppt", ".pptx"}:
        return "failed"
    return "stored"


def default_extraction_error(extension: str, status: str) -> str:
    if status != "failed":
        return ""
    ext = extension.lower()
    if ext == ".pdf":
        return "PDF text extraction failed. The file may be scanned, encrypted, or image-only."
    if ext == ".docx":
        return "DOCX text extraction failed. The document may be malformed or unsupported."
    return "Text extraction failed."


def friendly_extraction_error(extension: str, exc: Exception) -> str:
    base = default_extraction_error(extension, "failed")
    detail = str(exc).strip()
    if not detail:
        return base
    return f"{base} ({type(exc).__name__}: {detail[:160]})"


def extract_text(path: Path, extension: str) -> str:
    if extension in SUPPORTED_TEXT_EXTENSIONS:
        return path.read_text(encoding="utf-8", errors="replace")[:50_000]
    if extension == ".docx":
        return extract_docx_text(path)[:50_000]
    if extension == ".pptx":
        return extract_pptx_text(path)[:50_000]
    if extension == ".ppt":
        return extract_ppt_text(path)[:50_000]
    if extension == ".xls":
        return extract_xls_profile_text(path)[:50_000]
    if extension == ".xlsx":
        return extract_xlsx_profile_text(path)[:50_000]
    if extension == ".pdf":
        return extract_pdf_text(path.read_bytes())[:50_000]
    if extension in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
        return f"Image attachment: {path.name}"
    return ""


def scan_for_secret_patterns(text: str) -> list[dict[str, object]]:
    findings: list[dict[str, object]] = []
    if not text:
        return findings
    for pattern in SECRET_TEXT_PATTERNS:
        match = pattern.search(text)
        if match:
            findings.append(
                {
                    "kind": "possible_secret",
                    "pattern": pattern.pattern[:80],
                    "offset": match.start(),
                    "message": "Possible credential-like content detected.",
                }
            )
    return findings[:5]


def read_attachment_file(root: str | Path, project_path: str, session_slug: str, filename: str) -> tuple[Path, dict[str, object]]:
    safe_name = safe_filename(filename)
    root_dir = attachment_dir(root, project_path, session_slug).resolve()
    path = resolve_under_root(root_dir, safe_name)
    if not path.exists() or not path.is_file():
        raise storage.WorkspaceError("Attachment does not exist.")
    metadata = {}
    for item in list_attachments(root, project_path, session_slug):
        if item.get("filename") == path.name:
            metadata = item
            break
    return path, metadata


def extract_docx_text(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        xml = archive.read("word/document.xml")
    root = ElementTree.fromstring(xml)
    texts = [node.text or "" for node in root.iter() if node.tag.endswith("}t")]
    return "\n".join(texts)


def extract_pptx_text(path: Path) -> str:
    texts: list[str] = []
    with zipfile.ZipFile(path) as archive:
        slide_names = sorted(name for name in archive.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml"))
        for name in slide_names[:50]:
            root = ElementTree.fromstring(archive.read(name))
            slide_text = [node.text or "" for node in root.iter() if node.tag.endswith("}t")]
            if slide_text:
                texts.append(f"Slide {len(texts) + 1}: " + " ".join(item.strip() for item in slide_text if item.strip()))
    return "\n".join(texts)


def extract_ppt_text(path: Path) -> str:
    try:
        import olefile
    except ImportError as exc:
        raise storage.WorkspaceError("PPT support requires the free olefile package.") from exc
    chunks: list[str] = []
    with olefile.OleFileIO(path) as ole:
        for stream in ole.listdir(streams=True, storages=False):
            try:
                data = ole.openstream(stream).read()
            except OSError:
                continue
            chunks.extend(match.decode("utf-8", errors="ignore").strip() for match in re.findall(rb"[\x20-\x7E]{5,}", data))
            chunks.extend(match.decode("utf-16le", errors="ignore").strip() for match in re.findall(rb"(?:[\x20-\x7E]\x00){5,}", data))
    deduped: list[str] = []
    seen: set[str] = set()
    for chunk in chunks:
        text = re.sub(r"\s+", " ", chunk).strip()
        if text and text not in seen:
            seen.add(text)
            deduped.append(text)
    return "\n".join(deduped[:200])


def extract_xlsx_profile_text(path: Path) -> str:
    text = xlsx_first_sheet_csv(path)
    profile = csv_profile.profile_csv_text(text, filename=path.name)
    return csv_profile.model_context_from_profile(profile)


def extract_xls_profile_text(path: Path) -> str:
    text = xls_first_sheet_csv(path)
    profile = csv_profile.profile_csv_text(text, filename=path.name)
    return csv_profile.model_context_from_profile(profile)


def xls_first_sheet_csv(path: Path) -> str:
    try:
        import xlrd
    except ImportError as exc:
        raise storage.WorkspaceError("XLS support requires the free xlrd package.") from exc
    book = xlrd.open_workbook(str(path))
    if not book.nsheets:
        raise storage.WorkspaceError("XLS workbook does not contain a readable worksheet.")
    sheet = book.sheet_by_index(0)
    output = StringIO()
    writer = csv.writer(output)
    for row_index in range(sheet.nrows):
        writer.writerow([xls_cell_value(sheet.cell_value(row_index, col_index)) for col_index in range(sheet.ncols)])
    return output.getvalue()


def xls_cell_value(value: object) -> object:
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def xlsx_first_sheet_csv(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        shared = read_xlsx_shared_strings(archive)
        sheet_name = first_xlsx_sheet_name(archive)
        root = ElementTree.fromstring(archive.read(sheet_name))
    rows: list[list[str]] = []
    for row_node in root.iter():
        if not row_node.tag.endswith("}row"):
            continue
        values: list[str] = []
        for cell in row_node:
            if not cell.tag.endswith("}c"):
                continue
            index = xlsx_column_index(str(cell.attrib.get("r", "")))
            while len(values) < index:
                values.append("")
            values.append(xlsx_cell_value(cell, shared))
        rows.append(values)
    output = StringIO()
    writer = csv.writer(output)
    writer.writerows(rows)
    return output.getvalue()


def read_xlsx_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    values: list[str] = []
    for item in root:
        texts = [node.text or "" for node in item.iter() if node.tag.endswith("}t")]
        values.append("".join(texts))
    return values


def first_xlsx_sheet_name(archive: zipfile.ZipFile) -> str:
    names = sorted(name for name in archive.namelist() if name.startswith("xl/worksheets/sheet") and name.endswith(".xml"))
    if not names:
        raise storage.WorkspaceError("XLSX workbook does not contain a readable worksheet.")
    return names[0]


def xlsx_cell_value(cell: ElementTree.Element, shared_strings: list[str]) -> str:
    value_node = next((child for child in cell if child.tag.endswith("}v")), None)
    inline_text = [node.text or "" for node in cell.iter() if node.tag.endswith("}t")]
    if inline_text:
        return "".join(inline_text).strip()
    if value_node is None or value_node.text is None:
        return ""
    raw = value_node.text.strip()
    if cell.attrib.get("t") == "s":
        try:
            return shared_strings[int(raw)]
        except (ValueError, IndexError):
            return raw
    return raw


def xlsx_column_index(reference: str) -> int:
    letters = "".join(char for char in reference if char.isalpha()).upper()
    if not letters:
        return 0
    value = 0
    for char in letters:
        value = value * 26 + (ord(char) - ord("A") + 1)
    return max(0, value - 1)


def extract_pdf_text(content: bytes) -> str:
    # Lightweight fallback extraction. Full PDF parsing can be delegated later.
    chunks = re.findall(rb"\(([^()]{0,4000})\)", content)
    if not chunks:
        chunks = re.findall(rb"\(([^()]*)\)", content)
    decoded = [chunk.decode("latin-1", errors="ignore") for chunk in chunks]
    return "\n".join(item for item in decoded if item.strip())
