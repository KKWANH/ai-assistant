from aiws import storage
from aiws.core import project_connections, retrieval


def test_project_retrieval_indexes_project_files(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Research")
    files = storage.project_dir(root, "research") / "files"
    files.mkdir()
    (files / "camera.md").write_text("Canon battery door symptoms and BP-511A notes.", encoding="utf-8")

    indexed = retrieval.index_project(root, "research")
    chunks = retrieval.search_project(root, "research", "battery door")

    assert indexed["chunks"] >= 1
    assert indexed["mode"] == "hybrid_fts5_hash_vector"
    assert indexed["embedding_mode"] == "local_hash_vector"
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


def test_retrieval_context_exposes_scores_and_terms(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Research")
    files = storage.project_dir(root, "research") / "files"
    files.mkdir()
    (files / "camera.md").write_text("Canon battery door failure notes.", encoding="utf-8")

    chunks = retrieval.search_project(root, "research", "Canon battery")
    context = retrieval.format_retrieval_context(chunks)

    assert "Score:" in context
    assert "Matched terms:" in context
    assert "[R1]" in context
    assert "Cite retrieved facts with [R1]" in context
    assert "canon" in context.lower()


def test_project_retrieval_skips_reindex_when_sources_are_unchanged(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Research")
    files = storage.project_dir(root, "research") / "files"
    files.mkdir()
    (files / "camera.md").write_text("Canon battery door failure notes.", encoding="utf-8")

    first = retrieval.index_project(root, "research")
    second = retrieval.index_project(root, "research")

    assert first["reindexed"] is True
    assert second["reindexed"] is False


def test_project_retrieval_incrementally_updates_changed_source(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Research")
    files = storage.project_dir(root, "research") / "files"
    files.mkdir()
    first_path = files / "camera.md"
    second_path = files / "lens.md"
    first_path.write_text("Canon battery door failure notes.", encoding="utf-8")
    second_path.write_text("Lens fungus cleaning notes.", encoding="utf-8")

    retrieval.index_project(root, "research")
    first_path.write_text("Canon shutter curtain repair notes.", encoding="utf-8")
    indexed = retrieval.index_project(root, "research")
    chunks = retrieval.search_project(root, "research", "fungus cleaning")

    assert indexed["incremental"] is True
    assert indexed["changed_sources"] == 1
    assert indexed["removed_sources"] == 0
    assert chunks[0]["source_path"] == "files/lens.md"


def test_retrieval_status_marks_stale_after_source_change(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Research")
    files = storage.project_dir(root, "research") / "files"
    files.mkdir()
    path = files / "camera.md"
    path.write_text("Canon battery door failure notes.", encoding="utf-8")

    retrieval.index_project(root, "research")
    fresh = retrieval.index_status(root, "research")
    path.write_text("Canon battery door failure notes. New power rail clue.", encoding="utf-8")
    stale = retrieval.index_status(root, "research")

    assert fresh["indexed"] is True
    assert fresh["stale"] is False
    assert stale["stale"] is True


def test_project_retrieval_searches_approved_linked_resources(tmp_path):
    root = tmp_path / "workspace"
    storage.init_workspace(root)
    storage.create_project(root, "Food", slug="food")
    storage.create_project(root, "Diet", slug="diet")
    (storage.project_dir(root, "food") / "aiws.yaml").write_text(
        """
version: 1
resource_exports:
  - resourceType: nutrition_snapshot
    artifactPattern: artifacts/nutrition-snapshot.json
    schemaVersion: "1"
commands:
""".strip(),
        encoding="utf-8",
    )
    (storage.project_dir(root, "diet") / "aiws.yaml").write_text(
        """
version: 1
resource_imports:
  - sourceProjectId: food
    acceptedResourceType: nutrition_snapshot
    localAlias: foods
commands:
""".strip(),
        encoding="utf-8",
    )
    artifacts = storage.project_dir(root, "food") / "artifacts"
    artifacts.mkdir(parents=True)
    (artifacts / "nutrition-snapshot.json").write_text('{"dish":"dakgalbi","protein":32}', encoding="utf-8")

    chunks_without_link = retrieval.search_project_with_links(root, "diet", "dakgalbi protein")
    link = project_connections.request_link(
        root,
        source_project="food",
        target_project="diet",
        allowed_resource_types=["nutrition_snapshot"],
        mode="read",
        actor="owner",
    )
    project_connections.approve_link(root, link_id=link["linkId"], actor="owner")
    chunks = retrieval.search_project_with_links(root, "diet", "dakgalbi protein")

    assert chunks_without_link == []
    assert chunks
    assert chunks[0]["linked_alias"] == "foods"
    assert chunks[0]["linked_project"] == "food"
    assert chunks[0]["source_path"].startswith("foods:food/")


def test_ollama_embedding_falls_back_to_hash_vector(tmp_path, monkeypatch):
    monkeypatch.setenv("AIWS_EMBEDDING_PROVIDER", "ollama")

    def fail_urlopen(*args, **kwargs):
        raise OSError("offline")

    monkeypatch.setattr(retrieval.request, "urlopen", fail_urlopen)

    vector = retrieval.text_embedding("local fallback embedding")

    assert len(vector) == retrieval.EMBEDDING_DIMENSIONS
    assert any(value != 0 for value in vector)
