from aiws import storage
from aiws.core import retrieval


def test_project_retrieval_indexes_project_files(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Research")
    files = storage.project_dir(root, "research") / "files"
    files.mkdir()
    (files / "camera.md").write_text("Canon battery door symptoms and BP-511A notes.", encoding="utf-8")

    indexed = retrieval.index_project(root, "research")
    chunks = retrieval.search_project(root, "research", "battery door")

    assert indexed["chunks"] >= 1
    assert chunks
    assert chunks[0]["source_path"] == "files/camera.md"
    assert "battery door" in chunks[0]["text"].lower()


def test_project_retrieval_indexes_attachment_text(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Research")
    storage.create_session(root, "research", "Notes")
    attachments = storage.session_dir(root, "research", "notes") / "attachments"
    attachments.mkdir(parents=True)
    (attachments / "attachments.jsonl").write_text(
        '{"filename":"brief.txt","text_available":true,"text":"ETF rebalance target allocation notes."}\n',
        encoding="utf-8",
    )

    chunks = retrieval.search_project(root, "research", "target allocation")

    assert chunks
    assert chunks[0]["source_path"] == "sessions/notes/attachments/brief.txt"


def test_project_retrieval_reranks_title_and_term_coverage(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Research")
    files = storage.project_dir(root, "research") / "files"
    files.mkdir()
    (files / "generic.md").write_text("battery battery battery battery", encoding="utf-8")
    (files / "canon-battery-door.md").write_text("Canon camera door contact failure and power notes.", encoding="utf-8")

    chunks = retrieval.search_project(root, "research", "Canon battery door", limit=2)

    assert chunks[0]["source_path"] == "files/canon-battery-door.md"
    assert chunks[0]["rerank_score"] >= chunks[1]["rerank_score"]
    assert {"canon", "battery", "door"} <= set(chunks[0]["matched_terms"])


def test_project_retrieval_uses_local_vector_candidates(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Research")
    files = storage.project_dir(root, "research") / "files"
    files.mkdir()
    (files / "alpha.md").write_text("zzalpha zzbeta zzgamma local vector only", encoding="utf-8")

    chunks = retrieval.search_project(root, "research", "zzalpha zzbeta", limit=1)

    assert chunks
    assert chunks[0]["source_path"] == "files/alpha.md"
    assert chunks[0]["vector_score"] > 0
