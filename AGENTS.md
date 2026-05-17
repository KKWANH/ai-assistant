## Product Direction

This project is not a ChatGPT clone. It is a local-first AI workbench where chat is only one interface for controlling projects, files, workflow apps, viewers, runs, artifacts, and connected resources.

When implementing a feature, do not stop at visual placeholders. Prefer one complete vertical slice over many shallow UI stubs.

A valid vertical slice must include:
1. typed backend contract,
2. API route,
3. persistent state if needed,
4. frontend UI,
5. loading/error/empty states,
6. run/artifact visibility when applicable,
7. at least one test or deterministic manual verification path.

Do not make tiny cosmetic changes when the requested change requires architectural work. If a feature requires changing the core data model, routing, API contracts, or runtime flow, change those layers directly.

For workflow apps and viewers, prioritize extensibility over defensive SaaS-style security. This is a local-first personal/team workbench. Still avoid accidental exposure of secrets, but do not block user-owned TypeScript/JS customization merely because it could be powerful.

Do not create fake UI for unavailable backend features. If a card, tab, or button exists, it must either:
- call a real backend capability,
- be clearly marked as planned,
- or be removed.

RAG means query-time retrieval over indexed chunks. Passing full uploaded text into a prompt is not sufficient. Any RAG implementation must include ingestion, chunking, indexing, retrieval, and visible source/context inspection.