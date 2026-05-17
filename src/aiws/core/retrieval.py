"""Project-scoped retrieval for local workspace context.

This is intentionally boring: SQLite FTS5, local files only, no embedding service.
It gives AIWS a real retrieval step before we add optional semantic indexing.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

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


def index_project(root: str | Path, project_path: str) -> dict[str, Any]:
    """Rebuild the local retrieval index for a project."""
    project_root = storage.project_dir(root, project_path)
    database = db_path(root, project_path)
    chunks: list[RetrievalChunk] = []
    for source_path, title, text in iter_project_text_sources(root, project_path):
        for index, chunk_text in enumerate(chunk_text_blocks(text)):
            chunks.append(
                RetrievalChunk(
                    chunk_id=f"{source_path}#{index}",
                    source_path=source_path,
                    title=title,
                    text=chunk_text,
                )
            )
    with sqlite3.connect(database) as conn:
        conn.execute("DROP TABLE IF EXISTS chunks")
        conn.execute("DROP TABLE IF EXISTS chunk_vectors")
        conn.execute(
            "CREATE VIRTUAL TABLE chunks USING fts5("
            "chunk_id UNINDEXED, source_path UNINDEXED, title, text, tokenize='unicode61'"
            ")"
        )
        conn.execute(
            "CREATE TABLE chunk_vectors("
            "chunk_id TEXT PRIMARY KEY, source_path TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, vector TEXT NOT NULL"
            ")"
        )
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
        conn.execute("DELETE FROM metadata")
        conn.execute(
            "INSERT INTO metadata(key, value) VALUES (?, ?)",
            ("project_path", project_path),
        )
        conn.execute(
            "INSERT INTO metadata(key, value) VALUES (?, ?)",
            ("project_root", str(project_root)),
        )
        conn.commit()
    return {"project_path": project_path, "chunks": len(chunks), "db_path": str(database)}


def search_project(root: str | Path, project_path: str, query: str, *, limit: int = 5) -> list[dict[str, Any]]:
    """Return reranked local chunks for a query, rebuilding the index first for v1 freshness."""
    if not query.strip():
        return []
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


def format_retrieval_context(chunks: list[dict[str, Any]]) -> str:
    if not chunks:
        return ""
    lines = ["## Retrieved Project Context", "Use these local project chunks as supporting context. Do not invent beyond them.", ""]
    for index, chunk in enumerate(chunks, start=1):
        source = chunk.get("source_path", "unknown")
        title = chunk.get("title", source)
        text = str(chunk.get("text", "")).strip()
        lines.extend([f"### RAG {index}: {title}", f"- Source: `{source}`", "", text[:1600], ""])
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
