"""Project-scoped retrieval for local workspace context.

This is intentionally boring: SQLite FTS5, local files only, no embedding service.
It gives AIWS a real retrieval step before we add optional semantic indexing.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sqlite3
import queue
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import error, request

from .. import storage

TEXT_EXTENSIONS = {
    ".csv",
    ".json",
    ".md",
    ".py",
    ".txt",
    ".yaml",
    ".yml",
}
SKIP_DIRS = {".aiws", ".git", "__pycache__", "node_modules", "runs", "sessions", "viewers"}
MAX_FILE_CHARS = 80_000
DEFAULT_CHUNK_CHARS = 1_200
DEFAULT_OVERLAP_CHARS = 160
EMBEDDING_DIMENSIONS = 96
RETRIEVAL_MODE = "hybrid_fts5_hash_vector"
HASH_EMBEDDING_MODE = "local_hash_vector"
WATCHER_STARTED = False
WATCHER_MODE = "off"


@dataclass(frozen=True)
class RetrievalChunk:
    chunk_id: str
    source_path: str
    title: str
    text: str
    score: float = 0.0

    def as_dict(self) -> dict[str, Any]:
        return {
            "chunk_id": self.chunk_id,
            "source_path": self.source_path,
            "title": self.title,
            "text": self.text,
            "score": self.score,
        }


def db_path(root: str | Path, project_path: str) -> Path:
    path = storage.project_dir(root, project_path) / ".aiws" / "retrieval.sqlite3"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def index_project(root: str | Path, project_path: str, *, force: bool = False) -> dict[str, Any]:
    """Refresh the local retrieval index, updating only changed sources when possible."""
    project_root = storage.project_dir(root, project_path)
    database = db_path(root, project_path)
    sources = iter_project_text_sources(root, project_path)
    manifest = source_manifest(sources)
    signature = sources_signature(sources)
    existing = read_index_metadata(database)
    if not force and existing.get("sources_signature") == signature:
        return {
            "project_path": project_path,
            "chunks": int(existing.get("chunk_count") or 0),
            "db_path": str(database),
            "mode": existing.get("retrieval_mode", RETRIEVAL_MODE),
            "embedding_mode": existing.get("embedding_mode", embedding_mode()),
            "reindexed": False,
            "incremental": True,
            "changed_sources": 0,
            "removed_sources": 0,
        }
    previous_manifest = parse_source_manifest(existing.get("source_manifest", ""))
    can_incremental = not force and database.exists() and bool(previous_manifest) and index_tables_exist(database)
    removed_sources = sorted(set(previous_manifest) - set(manifest)) if can_incremental else []
    changed_sources = sorted(
        source_path
        for source_path, item in manifest.items()
        if not can_incremental or previous_manifest.get(source_path, {}).get("digest") != item.get("digest")
    )
    changed_source_set = set(changed_sources)
    chunks = chunks_for_sources((source for source in sources if source[0] in changed_source_set))
    with sqlite3.connect(database) as conn:
        if not can_incremental:
            conn.execute("DROP TABLE IF EXISTS chunks")
            conn.execute("DROP TABLE IF EXISTS chunk_vectors")
        ensure_index_tables(conn)
        for source_path in removed_sources + changed_sources:
            conn.execute("DELETE FROM chunks WHERE source_path = ?", (source_path,))
            conn.execute("DELETE FROM chunk_vectors WHERE source_path = ?", (source_path,))
        conn.executemany(
            "INSERT INTO chunks(chunk_id, source_path, title, text) VALUES (?, ?, ?, ?)",
            [(item.chunk_id, item.source_path, item.title, item.text) for item in chunks],
        )
        conn.executemany(
            "INSERT INTO chunk_vectors(chunk_id, source_path, title, text, vector) VALUES (?, ?, ?, ?, ?)",
            [
                (
                    item.chunk_id,
                    item.source_path,
                    item.title,
                    item.text,
                    json.dumps(text_embedding(f"{item.title}\n{item.text}"), separators=(",", ":")),
                )
                for item in chunks
            ],
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        chunk_count = conn.execute("SELECT count(*) FROM chunk_vectors").fetchone()[0]
        write_metadata(
            conn,
            {
                "project_path": project_path,
                "project_root": str(project_root),
                "retrieval_mode": RETRIEVAL_MODE,
                "embedding_mode": embedding_mode(),
                "sources_signature": signature,
                "source_manifest": json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                "source_count": str(len(manifest)),
                "chunk_count": str(chunk_count),
                "last_indexed_at": storage.utc_now(),
            },
        )
        conn.commit()
    return {
        "project_path": project_path,
        "chunks": int(read_index_metadata(database).get("chunk_count") or 0),
        "db_path": str(database),
        "mode": RETRIEVAL_MODE,
        "embedding_mode": embedding_mode(),
        "reindexed": True,
        "incremental": can_incremental,
        "changed_sources": len(changed_sources),
        "removed_sources": len(removed_sources),
    }


def index_status(root: str | Path, project_path: str) -> dict[str, Any]:
    """Return retrieval index freshness without mutating the index."""
    database = db_path(root, project_path)
    sources = iter_project_text_sources(root, project_path)
    signature = sources_signature(sources)
    existing = read_index_metadata(database)
    indexed = bool(existing)
    stale = not indexed or existing.get("sources_signature") != signature
    return {
        "project_path": project_path,
        "indexed": indexed,
        "stale": stale,
        "source_count": len(sources),
        "chunks": int(existing.get("chunk_count") or 0),
        "last_indexed_at": existing.get("last_indexed_at", ""),
        "db_path": str(database),
        "mode": existing.get("retrieval_mode", RETRIEVAL_MODE),
        "embedding_mode": existing.get("embedding_mode", embedding_mode()),
    }


def start_index_watcher(root: str | Path, *, interval_seconds: float | None = None) -> None:
    """Start a local retrieval index watcher.

    Prefer watchdog's native backend (FSEvents on macOS, inotify on Linux). Polling is
    only a fallback for machines without watchdog installed.
    """
    global WATCHER_MODE, WATCHER_STARTED
    if WATCHER_STARTED or os.environ.get("AIWS_RETRIEVAL_WATCHER", "true").lower() in {"0", "false", "no"}:
        return
    WATCHER_STARTED = True
    if start_native_index_watcher(Path(root)):
        WATCHER_MODE = "native"
        return
    WATCHER_MODE = "polling"
    interval = interval_seconds or float(os.environ.get("AIWS_RETRIEVAL_WATCH_INTERVAL_SECONDS", "8"))
    thread = threading.Thread(target=watch_index_loop, args=(Path(root), interval), daemon=True, name="aiws-retrieval-index-polling")
    thread.start()


def watcher_status() -> dict[str, str]:
    return {"started": "true" if WATCHER_STARTED else "false", "mode": WATCHER_MODE}


def start_native_index_watcher(root: Path) -> bool:
    """Start watchdog observer. Returns False when watchdog is unavailable."""
    try:
        from watchdog.events import FileSystemEvent, FileSystemEventHandler
        from watchdog.observers import Observer
    except ImportError:
        return False

    projects_root = root / "projects"
    projects_root.mkdir(parents=True, exist_ok=True)
    pending: queue.Queue[str] = queue.Queue()

    class RetrievalEventHandler(FileSystemEventHandler):
        def on_any_event(self, event: FileSystemEvent) -> None:  # noqa: N802 - watchdog API
            if event.is_directory:
                return
            for raw_path in event_paths(event):
                project_path = project_path_for_changed_file(root, Path(raw_path))
                if project_path:
                    pending.put(project_path)

    def worker() -> None:
        debounce: dict[str, float] = {}
        while True:
            try:
                project_path = pending.get(timeout=0.8)
                debounce[project_path] = time.monotonic()
                while True:
                    try:
                        project_path = pending.get_nowait()
                        debounce[project_path] = time.monotonic()
                    except queue.Empty:
                        break
                now = time.monotonic()
                ready = [item for item, timestamp in debounce.items() if now - timestamp >= 0.6]
                for item in ready:
                    try:
                        if index_status(root, item).get("stale"):
                            index_project(root, item)
                    except Exception:
                        pass
                    debounce.pop(item, None)
            except queue.Empty:
                now = time.monotonic()
                ready = [item for item, timestamp in debounce.items() if now - timestamp >= 0.6]
                for item in ready:
                    try:
                        if index_status(root, item).get("stale"):
                            index_project(root, item)
                    except Exception:
                        pass
                    debounce.pop(item, None)

    observer = Observer()
    observer.schedule(RetrievalEventHandler(), str(projects_root), recursive=True)
    observer.daemon = True
    observer.start()
    threading.Thread(target=worker, daemon=True, name="aiws-retrieval-native-index-worker").start()
    return True


def event_paths(event: Any) -> list[str]:
    paths = [str(getattr(event, "src_path", "") or "")]
    destination = str(getattr(event, "dest_path", "") or "")
    if destination:
        paths.append(destination)
    return [item for item in paths if item]


def project_path_for_changed_file(root: str | Path, changed_path: Path) -> str:
    try:
        resolved = changed_path.resolve()
        projects_root = (Path(root) / "projects").resolve()
        rel = resolved.relative_to(projects_root)
    except (OSError, ValueError):
        return ""
    if should_ignore_watcher_path(rel):
        return ""
    parts = rel.parts
    if not parts:
        return ""
    candidates = []
    if len(parts) >= 2:
        candidates.append(f"{parts[0]}/{parts[1]}")
    candidates.append(parts[0])
    for candidate in candidates:
        try:
            storage.ensure_project_exists(root, candidate)
            return candidate
        except storage.WorkspaceError:
            continue
    return ""


def should_ignore_watcher_path(rel: Path) -> bool:
    parts = set(rel.parts)
    if {".aiws", ".git", "__pycache__", "node_modules", ".aiws-viewers"} & parts:
        return True
    if rel.name in {"retrieval.sqlite3", "retrieval.sqlite3-wal", "retrieval.sqlite3-shm"}:
        return True
    return rel.suffix.lower() not in TEXT_EXTENSIONS and rel.suffix.lower() not in {".jsonl"}


def watch_index_loop(root: Path, interval_seconds: float) -> None:
    while True:
        try:
            for project in storage.list_projects(root):
                project_path = str(project.get("path") or "")
                if not project_path or project.get("hidden"):
                    continue
                status = index_status(root, project_path)
                if status.get("stale"):
                    index_project(root, project_path)
        except Exception:
            pass
        time.sleep(max(2.0, interval_seconds))


def search_project(root: str | Path, project_path: str, query: str, *, limit: int = 5) -> list[dict[str, Any]]:
    """Return reranked local chunks for a query using the persistent project index."""
    if not query.strip():
        return []
    if index_status(root, project_path)["stale"]:
        index_project(root, project_path)
    fts = fts_query(query)
    if not fts:
        return []
    database = db_path(root, project_path)
    fts_chunks: list[dict[str, Any]] = []
    try:
        with sqlite3.connect(database) as conn:
            rows = conn.execute(
                """
                SELECT chunk_id, source_path, title, text, bm25(chunks) AS score
                FROM chunks
                WHERE chunks MATCH ?
                ORDER BY score
                LIMIT ?
                """,
                (fts, max(1, min(limit * 4, 24))),
            ).fetchall()
            vector_rows = conn.execute(
                "SELECT chunk_id, source_path, title, text, vector FROM chunk_vectors"
            ).fetchall()
    except sqlite3.OperationalError:
        return []
    fts_chunks = [
        RetrievalChunk(
            chunk_id=str(row[0]),
            source_path=str(row[1]),
            title=str(row[2]),
            text=str(row[3]),
            score=float(row[4] or 0.0),
        ).as_dict()
        for row in rows
    ]
    vector_chunks = vector_search(query, vector_rows, limit=max(1, min(limit * 4, 24)))
    chunks = merge_candidate_chunks(fts_chunks, vector_chunks)
    return rerank_chunks(query, chunks)[: max(1, min(limit, 12))]


def search_project_with_links(
    root: str | Path,
    project_path: str,
    query: str,
    *,
    username: str | None = None,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Search current project plus approved linked resource artifacts."""
    own_limit = max(1, min(limit, 12))
    own = search_project(root, project_path, query, limit=own_limit)
    linked = search_linked_resources(root, project_path, query, username=username, limit=own_limit)
    return rerank_chunks(query, merge_candidate_chunks(own, linked))[:own_limit]


def search_linked_resources(
    root: str | Path,
    project_path: str,
    query: str,
    *,
    username: str | None = None,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Return chunks from approved linked resource artifacts only."""
    try:
        from . import project_connections

        resolved = project_connections.payload(root, project_path, username).get("resolvedImports", [])
    except storage.WorkspaceError:
        return []
    if not isinstance(resolved, list):
        return []
    candidates: list[dict[str, Any]] = []
    for item in resolved:
        if not isinstance(item, dict):
            continue
        artifact = item.get("latestArtifact")
        if not isinstance(artifact, dict):
            continue
        source_project = str(item.get("sourceProjectId") or "")
        alias = str(item.get("localAlias") or item.get("resourceType") or "linked")
        relative_path = str(artifact.get("path") or "")
        text = read_linked_artifact_text(root, source_project, relative_path)
        if not text:
            continue
        source_path = f"{alias}:{source_project}/{relative_path}"
        for index, chunk_text in enumerate(chunk_text_blocks(text[:MAX_FILE_CHARS])):
            candidates.append(
                {
                    "chunk_id": f"linked:{source_path}#{index}",
                    "source_path": source_path,
                    "title": f"{alias} · {Path(relative_path).name}",
                    "text": chunk_text,
                    "score": 0.0,
                    "linked_alias": alias,
                    "linked_project": source_project,
                    "resource_type": item.get("resourceType", ""),
                    "link_id": item.get("linkId", ""),
                }
            )
    return rerank_chunks(query, candidates)[: max(1, min(limit, 12))]


def read_linked_artifact_text(root: str | Path, project_path: str, relative_path: str) -> str:
    if not relative_path or ".." in Path(relative_path).parts or relative_path.startswith("/"):
        return ""
    path = storage.project_dir(root, project_path) / relative_path
    if not path.exists() or not path.is_file() or path.stat().st_size > 1_000_000:
        return ""
    suffix = path.suffix.lower()
    if suffix not in TEXT_EXTENSIONS and suffix not in {".log"}:
        return ""
    try:
        return path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return ""


def format_retrieval_context(chunks: list[dict[str, Any]]) -> str:
    if not chunks:
        return ""
    lines = [
        "## Retrieved Project Context",
        "Use these local project chunks as supporting context. Cite retrieved facts with [R1], [R2], etc.",
        "If retrieved context is insufficient, say that instead of inventing details.",
        "",
    ]
    for index, chunk in enumerate(chunks, start=1):
        source_id = str(chunk.get("source_id") or f"R{index}")
        source = chunk.get("source_path", "unknown")
        title = chunk.get("title", source)
        text = str(chunk.get("text", "")).strip()
        terms = ", ".join(str(term) for term in chunk.get("matched_terms", []) if term)
        score = chunk.get("rerank_score")
        score_line = f"- Score: `{score}`" if score is not None else "- Score: `n/a`"
        term_line = f"- Matched terms: {terms}" if terms else "- Matched terms: none"
        lines.extend([f"### [{source_id}] {title}", f"- Source: `{source}`", score_line, term_line, "", text[:1600], ""])
    return "\n".join(lines).rstrip() + "\n\n"


def iter_project_text_sources(root: str | Path, project_path: str) -> list[tuple[str, str, str]]:
    project_root = storage.project_dir(root, project_path)
    sources: list[tuple[str, str, str]] = []
    for session in storage.list_sessions(root, project_path):
        slug = str(session.get("slug", ""))
        if not slug:
            continue
        for item in storage.read_attachment_metadata(root, project_path, slug):
            text = str(item.get("text", "")).strip() if item.get("text_available") else ""
            if not text:
                continue
            filename = str(item.get("filename", "attachment"))
            source_path = f"sessions/{slug}/attachments/{filename}"
            sources.append((source_path, filename, text[:MAX_FILE_CHARS]))
    for path in sorted(project_root.rglob("*")):
        if not path.is_file() or should_skip_path(project_root, path):
            continue
        if path.suffix.lower() not in TEXT_EXTENSIONS:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            continue
        if text:
            rel = path.relative_to(project_root).as_posix()
            sources.append((rel, path.name, text[:MAX_FILE_CHARS]))
    return dedupe_sources(sources)


def chunks_for_sources(sources: Any) -> list[RetrievalChunk]:
    chunks: list[RetrievalChunk] = []
    for source_path, title, text in sources:
        for index, chunk_text in enumerate(chunk_text_blocks(text)):
            chunks.append(
                RetrievalChunk(
                    chunk_id=f"{source_path}#{index}",
                    source_path=source_path,
                    title=title,
                    text=chunk_text,
                )
            )
    return chunks


def chunk_text_blocks(text: str, *, size: int = DEFAULT_CHUNK_CHARS, overlap: int = DEFAULT_OVERLAP_CHARS) -> list[str]:
    compact = "\n".join(line.rstrip() for line in text.splitlines()).strip()
    if not compact:
        return []
    if len(compact) <= size:
        return [compact]
    chunks: list[str] = []
    start = 0
    while start < len(compact):
        end = min(start + size, len(compact))
        window = compact[start:end]
        if end < len(compact):
            split_at = max(window.rfind("\n\n"), window.rfind(". "), window.rfind("\n"))
            if split_at > size // 2:
                end = start + split_at + 1
                window = compact[start:end]
        chunks.append(window.strip())
        if end >= len(compact):
            break
        start = max(end - overlap, start + 1)
    return [item for item in chunks if item]


def fts_query(value: str) -> str:
    tokens = re.findall(r"[A-Za-z0-9_\uac00-\ud7a3]{2,}", value.lower())
    return " OR ".join(dict.fromkeys(tokens[:12]))


def rerank_chunks(query: str, chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Apply deterministic hybrid rerank over FTS and local hash-vector candidates."""
    query_tokens = token_set(query)
    query_vector = text_embedding(query)
    if not query_tokens:
        return chunks
    reranked: list[dict[str, Any]] = []
    for item in chunks:
        title_tokens = token_set(str(item.get("title", "")) + " " + str(item.get("source_path", "")))
        body_tokens = token_set(str(item.get("text", "")))
        title_hits = len(query_tokens & title_tokens)
        body_hits = len(query_tokens & body_tokens)
        coverage = (title_hits * 2 + body_hits) / max(len(query_tokens), 1)
        fts_score = float(item.get("score") or 0.0)
        vector_score = float(item.get("vector_score") or cosine_similarity(query_vector, text_embedding(str(item.get("title", "")) + "\n" + str(item.get("text", "")))))
        rerank_score = round((coverage * 0.68) + (vector_score * 0.32) - (fts_score * 0.01), 6)
        reranked.append(
            item
            | {
                "rerank_score": rerank_score,
                "vector_score": round(vector_score, 6),
                "matched_terms": sorted(query_tokens & (title_tokens | body_tokens)),
            }
        )
    return sorted(reranked, key=lambda item: float(item.get("rerank_score") or 0.0), reverse=True)


def token_set(value: str) -> set[str]:
    return set(re.findall(r"[A-Za-z0-9_\uac00-\ud7a3]{2,}", value.lower()))


def text_embedding(value: str, *, dimensions: int = EMBEDDING_DIMENSIONS) -> list[float]:
    if os.environ.get("AIWS_EMBEDDING_PROVIDER", "").lower() == "ollama":
        vector = ollama_embedding(value)
        if vector:
            return normalize_vector(vector)
    return hash_embedding(value, dimensions=dimensions)


def hash_embedding(value: str, *, dimensions: int = EMBEDDING_DIMENSIONS) -> list[float]:
    """Return a deterministic local hash embedding.

    It is not a neural embedding model. It gives AIWS a local vector path that can
    later be swapped for real embeddings without changing retrieval contracts.
    """
    vector = [0.0] * dimensions
    tokens = re.findall(r"[A-Za-z0-9_\uac00-\ud7a3]{2,}", value.lower())
    for token in tokens:
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        bucket = int.from_bytes(digest[:4], "big") % dimensions
        sign = 1.0 if digest[4] & 1 else -1.0
        vector[bucket] += sign
    norm = math.sqrt(sum(item * item for item in vector))
    if not norm:
        return vector
    return [round(item / norm, 8) for item in vector]


def ollama_embedding(value: str) -> list[float]:
    """Return an Ollama neural embedding when explicitly enabled.

    This is opt-in via AIWS_EMBEDDING_PROVIDER=ollama. Failure falls back to the
    deterministic local hash embedding so chat never depends on embedding uptime.
    """
    model = os.environ.get("AIWS_EMBEDDING_MODEL", "nomic-embed-text")
    base_url = os.environ.get("AIWS_OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
    endpoint = f"{base_url}/api/embed"
    payload = json.dumps({"model": model, "input": value[:8000]}).encode("utf-8")
    req = request.Request(endpoint, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with request.urlopen(req, timeout=15) as response:
            data = json.loads(response.read().decode("utf-8"))
    except (OSError, error.URLError, error.HTTPError, json.JSONDecodeError):
        return []
    embeddings = data.get("embeddings") if isinstance(data, dict) else None
    if isinstance(embeddings, list) and embeddings and isinstance(embeddings[0], list):
        return [float(item) for item in embeddings[0]]
    embedding = data.get("embedding") if isinstance(data, dict) else None
    if isinstance(embedding, list):
        return [float(item) for item in embedding]
    return []


def normalize_vector(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(item * item for item in vector))
    if not norm:
        return vector
    return [round(item / norm, 8) for item in vector]


def vector_search(query: str, rows: list[tuple[Any, ...]], *, limit: int) -> list[dict[str, Any]]:
    query_vector = text_embedding(query)
    scored: list[dict[str, Any]] = []
    for chunk_id, source_path, title, text, vector_json in rows:
        try:
            vector = json.loads(str(vector_json))
        except json.JSONDecodeError:
            vector = []
        if not isinstance(vector, list):
            vector = []
        score = cosine_similarity(query_vector, [float(item) for item in vector])
        if score <= 0:
            continue
        scored.append(
            {
                "chunk_id": str(chunk_id),
                "source_path": str(source_path),
                "title": str(title),
                "text": str(text),
                "score": 0.0,
                "vector_score": score,
            }
        )
    return sorted(scored, key=lambda item: float(item.get("vector_score") or 0.0), reverse=True)[:limit]


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    return sum(a * b for a, b in zip(left, right, strict=True))


def merge_candidate_chunks(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for group in groups:
        for item in group:
            key = str(item.get("chunk_id", ""))
            if not key:
                continue
            current = merged.get(key, {})
            merged[key] = current | item | {
                "score": min(float(current.get("score", item.get("score", 0.0)) or 0.0), float(item.get("score", 0.0) or 0.0)),
                "vector_score": max(float(current.get("vector_score", 0.0) or 0.0), float(item.get("vector_score", 0.0) or 0.0)),
            }
    return list(merged.values())


def embedding_mode() -> str:
    if os.environ.get("AIWS_EMBEDDING_PROVIDER", "").lower() == "ollama":
        return f"ollama:{os.environ.get('AIWS_EMBEDDING_MODEL', 'nomic-embed-text')}:fallback={HASH_EMBEDDING_MODE}"
    return HASH_EMBEDDING_MODE


def read_index_metadata(database: Path) -> dict[str, str]:
    if not database.exists():
        return {}
    try:
        with sqlite3.connect(database) as conn:
            rows = conn.execute("SELECT key, value FROM metadata").fetchall()
    except sqlite3.Error:
        return {}
    return {str(key): str(value) for key, value in rows}


def ensure_index_tables(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5("
        "chunk_id UNINDEXED, source_path UNINDEXED, title, text, tokenize='unicode61'"
        ")"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS chunk_vectors("
        "chunk_id TEXT PRIMARY KEY, source_path TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, vector TEXT NOT NULL"
        ")"
    )


def index_tables_exist(database: Path) -> bool:
    try:
        with sqlite3.connect(database) as conn:
            rows = conn.execute(
                "SELECT name FROM sqlite_master WHERE name IN ('chunks', 'chunk_vectors')"
            ).fetchall()
    except sqlite3.Error:
        return False
    return {row[0] for row in rows} == {"chunks", "chunk_vectors"}


def write_metadata(conn: sqlite3.Connection, values: dict[str, str]) -> None:
    conn.execute("CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    conn.executemany(
        "INSERT INTO metadata(key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [(key, str(value)) for key, value in values.items()],
    )


def source_manifest(sources: list[tuple[str, str, str]]) -> dict[str, dict[str, str]]:
    return {
        source_path: {
            "title": title,
            "chars": str(len(text)),
            "digest": hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest(),
        }
        for source_path, title, text in sources
    }


def parse_source_manifest(value: str) -> dict[str, dict[str, str]]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    manifest: dict[str, dict[str, str]] = {}
    for key, item in parsed.items():
        if isinstance(item, dict):
            manifest[str(key)] = {str(child_key): str(child_value) for child_key, child_value in item.items()}
    return manifest


def sources_signature(sources: list[tuple[str, str, str]]) -> str:
    digest = hashlib.sha256()
    for source_path, title, text in sources:
        digest.update(source_path.encode("utf-8"))
        digest.update(b"\0")
        digest.update(title.encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(len(text)).encode("ascii"))
        digest.update(b"\0")
        digest.update(hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest().encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest()


def should_skip_path(project_root: Path, path: Path) -> bool:
    try:
        rel = path.relative_to(project_root)
    except ValueError:
        return True
    parts = set(rel.parts)
    if parts & SKIP_DIRS:
        return True
    if any(part.startswith(".") and part != ".aiws" for part in rel.parts):
        return True
    if path.name in {"project.json", "aiws.lock"}:
        return True
    if path.stat().st_size > 2_000_000:
        return True
    return False


def dedupe_sources(sources: list[tuple[str, str, str]]) -> list[tuple[str, str, str]]:
    seen: set[str] = set()
    deduped: list[tuple[str, str, str]] = []
    for source_path, title, text in sources:
        key = json.dumps([source_path, text[:200]], ensure_ascii=False)
        if key in seen:
            continue
        seen.add(key)
        deduped.append((source_path, title, text))
    return deduped
