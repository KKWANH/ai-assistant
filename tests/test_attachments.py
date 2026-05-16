import io
import zipfile

import pytest

from aiws import attachments, storage
from aiws.core import context_manifest, context_receipts


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


def test_attachment_content_must_match_sensitive_extensions(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Attachments")

    with pytest.raises(storage.WorkspaceError, match="image extension"):
        attachments.save_attachment(root, "ai-system", "attachments", "photo.png", b"not an image")

    with pytest.raises(storage.WorkspaceError, match="PDF attachment"):
        attachments.save_attachment(root, "ai-system", "attachments", "paper.pdf", b"not a pdf")


def test_structured_text_attachments_are_saved_and_extracted(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Attachments")

    csv = attachments.save_attachment(root, "ai-system", "attachments", "table.csv", b"name,value\nAIWS,1")
    data = attachments.save_attachment(root, "ai-system", "attachments", "data.json", b'{"ok": true}')
    yaml = attachments.save_attachment(root, "ai-system", "attachments", "config.yaml", b"name: aiws")

    assert "CSV deterministic analysis profile follows" in csv["text"]
    assert csv["analysis_profile"]["row_count"] == 1
    assert csv["analysis_profile"]["column_count"] == 2
    assert csv["computed_profile_sent_to_model"] is True
    assert csv["raw_text_sent_to_model"] is False
    artifact_names = {item["filename"] for item in csv["analysis_artifacts"]}
    assert {"csv-profile.json", "csv-preview.csv", "csv-summary.md", "numeric-stats.csv"} <= artifact_names
    assert data["text"] == '{"ok": true}'
    assert yaml["text"] == "name: aiws"
    assert csv["text_available"] is True


def test_csv_attachment_profiles_missing_values_and_sensitive_columns(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Attachments")

    result = attachments.save_attachment(
        root,
        "ai-system",
        "attachments",
        "settings.csv",
        b"name,api_token,score\nalpha,sk_test_12345678901234567890,10\nbeta,,20\n",
    )

    profile = result["analysis_profile"]
    assert profile["missing_cells"] == 1
    assert profile["numeric_columns"] == ["score"]
    assert any("sensitive" in item for item in profile["suspicious_columns"])
    assert result["security_findings"]


def test_context_receipt_reports_csv_parser_and_artifacts(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Attachments")
    attachments.save_attachment(root, "ai-system", "attachments", "table.csv", b"name,value\nAIWS,1\nOther,2\n")

    manifest = context_manifest.build_context_manifest(
        root,
        "ai-system",
        "attachments",
        provider="ollama",
        model="qwen3:4b",
        prompt_context="profile",
    )
    receipt = context_receipts.build_context_receipt(
        manifest,
        "ollama",
        "qwen3:4b",
        {"estimated_cost": 0, "currency": "USD"},
    )

    assert receipt["analysis"]["csv"][0]["parser"] == "python-csv"
    assert receipt["analysis"]["csv"][0]["rows"] == 2
    assert receipt["analysis"]["raw_text_sent_to_model"] is False
    assert receipt["analysis"]["computed_profile_sent_to_model"] is True
    assert {item["filename"] for item in receipt["analysis"]["artifacts"]} >= {"csv-profile.json", "csv-summary.md"}


def test_pdf_without_extractable_text_is_kept_with_failed_status(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Attachments")

    result = attachments.save_attachment(root, "ai-system", "attachments", "scan.pdf", b"%PDF-1.7\nstream image only")

    assert result["filename"] == "scan.pdf"
    assert result["text"] == ""
    assert result["delivery"] == "stored_only"
    assert result["text_available"] is False
    assert result["extraction_status"] == "ocr_required"
    assert result["extraction_method"] == "none"
    assert "OCR is required" in result["extraction_error"]


def test_pdf_uses_ocr_when_text_extractors_are_low_quality(monkeypatch):
    monkeypatch.setattr(attachments, "extract_pdf_text_pymupdf", lambda content: "%%%%")
    monkeypatch.setattr(attachments, "extract_pdf_text_pypdf", lambda content: "")
    monkeypatch.setattr(attachments, "extract_pdf_text_ocr", lambda content: "한글 문서 요약 OCR text")

    result = attachments.extract_pdf_text_result(b"%PDF-1.7")

    assert result.status == "ocr"
    assert result.method == "tesseract_ocr"
    assert "OCR text" in result.text


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


def test_xlsx_attachment_is_profiled_like_table(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Attachments")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
            '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Value</t></is></c></row>'
            '<row r="2"><c r="A2" t="inlineStr"><is><t>AIWS</t></is></c><c r="B2"><v>3</v></c></row>'
            "</sheetData></worksheet>",
        )

    result = attachments.save_attachment(root, "ai-system", "attachments", "table.xlsx", buf.getvalue())

    assert result["extraction_status"] == "success"
    assert result["analysis_profile"]["row_count"] == 1
    assert result["analysis_profile"]["numeric_columns"] == ["Value"]
    assert result["computed_profile_sent_to_model"] is True


def test_pptx_attachment_extracts_slide_text(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "AI System")
    storage.create_session(root, "ai-system", "Attachments")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        archive.writestr(
            "ppt/slides/slide1.xml",
            '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
            "<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello slides</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>",
        )

    result = attachments.save_attachment(root, "ai-system", "attachments", "deck.pptx", buf.getvalue())

    assert "Hello slides" in result["text"]


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
