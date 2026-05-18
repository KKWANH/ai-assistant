# Productization Self-Review

## Completed In This Pass

- Added project-scoped RAG v1:
  - SQLite FTS5 indexing.
  - Local deterministic hash-vector embeddings.
  - Hybrid candidate merge and lexical/vector rerank.
  - Retrieval chunks recorded in context receipts with matched terms and scores.
- Added retrieval-first context planning:
  - Normal chat no longer dumps prior attachments by default.
  - Full project/previous-file context is only used when the user explicitly asks for it.
  - `used_context.json`, context manifests, and receipts now record `context_mode`.
- Added source IDs for retrieved chunks:
  - Retrieved context is labeled as `[R1]`, `[R2]`, etc.
  - The system prompt asks models to cite retrieved facts with those IDs.
- Added retrieval index status/rebuild API shape:
  - `/api/retrieval/status` reports indexed/stale/chunk/source counts.
  - `/api/retrieval/rebuild` forces a rebuild.
- Generalized trusted viewer payloads:
  - Viewer bundles now load `/api/project-viewers/{project}/{viewerId}/payload`.
  - Viewer manifests can declare artifact payload patterns.
  - The investment dashboard keeps backward-compatible deterministic payload behavior.
- Added linked-resource RAG scope:
  - Approved `resolvedImports` are searched as linked artifact chunks.
  - Receipt chunks now carry linked alias/project/resource metadata.
  - Unapproved links still produce no retrieval candidates.
- Added source preview affordance in the receipt:
  - Retrieved chunks are clickable.
  - A compact preview panel shows path, linked alias/resource metadata, and stored text preview.
- Added linked-resource payload injection for trusted viewers:
  - Viewer manifests can request `linkedResources`/`resources`/`aliases`.
  - Payloads include approved linked artifact content under `linkedResources`.
- Replaced full retrieval rebuilds with manifest-driven incremental indexing:
  - Source manifests track per-file digests.
  - Changed/removed sources are deleted and reinserted without dropping the full index.
  - UI startup now launches a lightweight retrieval index watcher that refreshes stale project indexes in the background.
- Promoted source preview from inline block to a full right-side source drawer.
- Fixed route parsing so query strings and hash fragments do not leak into project slugs or Workflow App routes.
- Made Workflow App runs focus the completed viewer/dashboard area after artifacts are produced.
- Reframed README and docs around folder-native workspaces, context receipts, runs, and artifacts.
- Added example workspaces for document review, table analysis, and Codex briefs.
- Added install/start/dev/lint/test/build/doctor scripts for open-source onboarding.
- Hardened runtime payloads so public views do not include local paths, localhost URLs, process IDs, admin commands, or diagnostics.
- Added a stable `scripts/doctor.sh` entrypoint and a default Ollama model check.
- Added run-record fields used by the UI and acceptance criteria: `workspace_id`, `session_id`, `action_label`, nested `model`, `context_receipt`, and `steps`.
- Split the context receipt renderer out of `main.jsx` and fixed the Right Inspector diagnostics visibility check.

## Verification Targets

- Python lint: `python -m ruff check src tests`
- Backend tests: `python -m pytest -q`
- Frontend typecheck: `npm run typecheck`
- Frontend lint: `npm run lint`
- Frontend tests: `npm run test`
- Frontend build: `npm run build`
- Frontend e2e: `npm run test:e2e`
- Shell syntax: `bash -n scripts/*.sh`

## Remaining Risks

- RAG uses local hash-vector embeddings, not neural embeddings. It is private and deterministic, but not semantically equivalent to OpenAI/Ollama embedding models.
- Retrieval now skips full rebuilds when the source signature is unchanged, but it still scans source signatures at search time. Large projects still need file-event or explicit incremental indexing.
- Source IDs are available in prompt/receipt, but the chat UI still needs a richer click-to-preview source drawer.
- Receipt source previews exist inline; a full drawer with source navigation/search remains a later UI pass.
- Linked-resource RAG currently searches latest exported artifact text directly. It does not yet maintain separate persistent indexes per imported resource alias.
- The retrieval watcher is a lightweight local polling watcher, not a platform-native filesystem event watcher.
- Home Chat Tools and project Workflow Apps still have separate execution contracts.
- Sidebar/chat/home/model/viewer styles still include global CSS; ProjectDashboard has moved further toward module ownership.
- Docker support is documented as planned, not implemented.
- Public-domain deployments still depend on the operator setting `AIWS_PUBLIC_DEMO=true`, `AIWS_SHOW_DIAGNOSTICS=false`, and authentication.
