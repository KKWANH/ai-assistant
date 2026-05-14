import io
import zipfile

import pytest

from aiws import attachments, storage


def test_text_attachment_is_saved_and_extracted(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Attachments")

    result = attachments.save_attachment(root, "ai-system", "attachments", "notes.txt", b"hello world")

    assert result["filename"] == "notes.txt"
    assert result["text"] == "hello world"
    assert result["text_available"] is True
    assert result["extraction_status"] == "success"
    assert attachments.list_attachments(root, "ai-system", "attachments")[0]["size"] == 11


def test_markdown_pdf_and_image_validation(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Attachments")

    md = attachments.save_attachment(root, "ai-system", "attachments", "notes.md", b"# Hello")
    pdf = attachments.save_attachment(root, "ai-system", "attachments", "paper.pdf", b"%PDF-1.4\n(Hello PDF)")
    image = attachments.save_attachment(
        root,
        "ai-system",
        "attachments",
        "photo.png",
        b"\x89PNG\r\n\x1a\n" + b"x",
    )

    assert md["text"] == "# Hello"
    assert "Hello PDF" in pdf["text"]
    assert image["text"] == "Image attachment: photo.png"
    assert pdf["extraction_status"] == "success"
    assert image["extraction_status"] == "stored"
    assert image["text_available"] is False
    assert attachments.is_image_extension(".png") is True


def test_structured_text_attachments_are_saved_and_extracted(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Attachments")

    csv = attachments.save_attachment(root, "ai-system", "attachments", "table.csv", b"name,value\nAIWS,1")
    data = attachments.save_attachment(root, "ai-system", "attachments", "data.json", b'{"ok": true}')
    yaml = attachments.save_attachment(root, "ai-system", "attachments", "config.yaml", b"name: aiws")

    assert csv["text"] == "name,value\nAIWS,1"
    assert data["text"] == '{"ok": true}'
    assert yaml["text"] == "name: aiws"
    assert csv["text_available"] is True


def test_pdf_without_extractable_text_is_kept_with_failed_status(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Attachments")

    result = attachments.save_attachment(root, "ai-system", "attachments", "scan.pdf", b"%PDF-1.7\nstream image only")

    assert result["filename"] == "scan.pdf"
    assert result["text"] == ""
    assert result["delivery"] == "stored_only"
    assert result["text_available"] is False
    assert result["extraction_status"] == "failed"
    assert "PDF text extraction failed" in result["extraction_error"]


def test_docx_attachment_extracts_document_text(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Attachments")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        archive.writestr(
            "word/document.xml",
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            "<w:body><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p></w:body></w:document>",
        )

    result = attachments.save_attachment(root, "ai-system", "attachments", "file.docx", buf.getvalue())

    assert "Hello DOCX" in result["text"]


def test_attachment_rejects_unsupported_extension(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Attachments")

    with pytest.raises(storage.WorkspaceError):
        attachments.save_attachment(root, "ai-system", "attachments", "../bad.exe", b"x")


def test_attachment_rejects_empty_and_large_files(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Attachments")

    with pytest.raises(storage.WorkspaceError, match="empty"):
        attachments.save_attachment(root, "ai-system", "attachments", "empty.txt", b"")
    with pytest.raises(storage.WorkspaceError, match="too large"):
        attachments.save_attachment(
            root,
            "ai-system",
            "attachments",
            "large.txt",
            b"x" * (attachments.MAX_ATTACHMENT_BYTES + 1),
        )


def test_workspace_attachment_quota_is_enforced(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Attachments")
    monkeypatch.setenv("AIWS_MAX_WORKSPACE_ATTACHMENT_BYTES", "12")

    attachments.save_attachment(root, "ai-system", "attachments", "one.txt", b"123456")

    with pytest.raises(storage.WorkspaceError, match="storage limit"):
        attachments.save_attachment(root, "ai-system", "attachments", "two.txt", b"1234567")


def test_corrupt_attachment_metadata_is_ignored(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Attachments")
    attachment_root = attachments.attachment_dir(root, "ai-system", "attachments")
    attachment_root.mkdir(parents=True)
    (attachment_root / "attachments.jsonl").write_text(
        '{"filename": "ok.txt", "size": 1}\n{"filename": "broken',
        encoding="utf-8",
    )

    items = attachments.list_attachments(root, "ai-system", "attachments")

    assert items == [{"filename": "ok.txt", "size": 1}]
