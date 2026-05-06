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
    assert attachments.list_attachments(root, "ai-system", "attachments")[0]["size"] == 11


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
