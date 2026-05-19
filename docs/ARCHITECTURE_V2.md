# AIWS Architecture V2

AIWS is a traceable local AI workflow workbench, not a ChatGPT clone. Its durable
pipeline is:

`Folder -> aiws.yaml manifest -> Context Pack -> Context Receipt -> Action -> Run -> Artifact -> Report`

At every moment the system must be able to answer:

- What workspace/project am I in?
- What files and context are active?
- What model/provider is being used?
- Did anything leave the local machine?
- What action was executed?
- What run record was created?
- What artifact was produced?
- Can I inspect, reproduce, or audit it later?

## Product Identity

The product is local-first, file-backed, inspectable, reproducible, typed,
modular, and security-aware. The backend owns the domain. The frontend renders
domain state. The filesystem is the durable database. UI code may present domain
concepts, but it must not invent them.

The intended use cases are private project research, coding briefs, document
analysis, file workflows, personal workflow apps, and later secure server/tunnel
access for family or public demo mode.

## Domain Nouns

The core nouns are explicit backend types:

- Workspace: local or server operating scope and root storage boundary.
- User: actor identity for local, server, or public-demo use.
- Project: two-level maximum project path with manifest, files, sessions, runs,
  artifacts, security policy, and goal.
- Session: conversational or action-thread state attached to a project.
- Message: append-only conversational record with optional model/run/context
  references.
- Manifest: `aiws.yaml` declaration of context, actions, workflow apps, views,
  permissions, and resource imports/exports.
- Context Pack: explicit set of context items selected for a model/action.
- Context Receipt: audit record of what was sent, to whom, over what network
  mode, at what cost, and with which files/artifacts.
- Action: manifest-defined or system-defined operation with capabilities,
  preview, approval, and execution policy.
- Run: persisted execution timeline for an action.
- Artifact: durable output produced by a run.
- Usage Record: token/cost/network accounting entry.
- Security Policy: project-level restrictions for paths, shell, Python, network,
  cloud, and public safety.

## Backend Layers

The backend uses a layered/hexagonal architecture under `src/aiws`.

`domain/` contains pure models, value objects, enums, validation, and invariants.
It has no FastAPI, filesystem, model provider, or UI assumptions.

`application/` contains use cases and services such as workspace, project,
session, context, action, run, artifact, model, usage, and auth services. It
depends on domain models and application ports.

`application/ports/` defines interfaces for file stores, model providers, action
executors, text extractors, clocks, and ID generators.

`infrastructure/` contains adapters for filesystem storage, repositories, locks,
migrations, model providers, action executors, context extraction, security
guards, and usage/cost tracking.

`api/` contains HTTP DTOs, dependencies, errors, and routes. API routes call
application services and do not contain business policy.

`cli/` contains local operational commands for init, run, doctor, backup, and
restore.

## Frontend Layers

The frontend comes after backend contracts are stable. It uses TypeScript,
React, Vite, typed API responses, and CSS Modules.

`web/src/domain/` mirrors backend DTOs with generated types or zod schemas.
`web/src/api/` contains typed fetch/query/mutation code.
`web/src/app/` contains routing and the workbench shell.
`web/src/features/` contains project, session, context, action, run, artifact,
model, and file UI features.
`web/src/ui/` contains primitives, layout helpers, and global reset/tokens only.

The UI should feel calm, dense, dark, workflow-first, and inspectable. The nouns
Project, Session, Action, Run, Artifact, and Context Receipt must be visually
obvious.

## Storage Layout

The filesystem is the v1 durable database. All persisted records are human
readable. JSON stores current state, JSONL stores append-only records, and
Markdown mirrors provide readable summaries.

```text
workspace_root/
  workspace.json
  users.json
  settings.json
  skills/
  projects/
    project-slug/
      project.json
      goal.json
      GOAL.md
      aiws.yaml
      files/
      sessions/
        session-slug/
          session.json
          messages.jsonl
          session.md
          attachments/
          context_receipts.jsonl
      runs/
        run-id/
          run.json
          run.md
          steps.jsonl
          logs.jsonl
          stdout.txt
          stderr.txt
          result.json
          context_receipt.json
          artifacts/
      artifacts/
        artifact-index.jsonl
      indexes/
        file-index.json
        chunks.jsonl
  users/
  usage/
    model_usage.jsonl
  audit/
    audit.jsonl
```

All writes must be atomic and go through repositories/services. Random code must
not write directly to arbitrary filesystem paths.

## API Map

The HTTP API is typed and grouped by domain:

- `GET /api/health`
- Workspace: `GET /api/workspace`, `POST /api/workspace/init`,
  `GET /api/workspace/diagnostics`
- Projects: list, create, get, patch, delete, goal, manifest, validate
- Sessions: list, create, get, patch, delete
- Messages: list, append, attach files
- Context: preview packs and read receipts
- Actions: list, preview, run
- Runs: list, read, logs, cancel
- Artifacts: list, metadata, content, download
- Models: providers, models, cost estimate
- Usage: summary and records
- Settings: read and patch

## Security Model

Security is a domain concept. The system implements:

- PathGuard to keep resolved paths under workspace/project roots and block
  traversal or symlinks that escape allowed roots.
- SecretScanner to exclude default secret paths such as `.env`, `*.pem`,
  `*.key`, `.ssh/*`, `secrets/*`, `credentials/*`, `wallets/*`, `private/*`,
  and `.git/*`.
- Redaction for API keys, tokens, credentials, and private local paths where
  needed.
- CapabilityGuard for shell, Python, network, cloud, file writes, and external
  paths.
- Public mode restrictions that hide diagnostics, local paths, admin links, raw
  secret errors, and localhost implementation details.

Shell and Python actions require explicit approval. Cloud providers are blocked
for local-only projects. Every meaningful model call creates a Context Receipt
and Usage Record.

## Implementation Phases

1. Architecture document.
2. Domain models and domain tests.
3. File storage layout, repositories, atomic writes, JSON/JSONL helpers, locks,
   and path guard.
4. Project/session/message services and minimal API.
5. Manifest/action loading, validation, normalization, and preview.
6. Run creation, timeline, logs, stdout/stderr, and `run.md`.
7. Safe action execution for prompt recipes, file index, and Codex prompt; then
   shell/Python with approval.
8. Context packs, context items, exclusions, computed profiles, receipts.
9. Model providers starting with Ollama, then cloud providers.
10. Artifact registry, viewers, metadata, and download/open/copy.
11. UI shell and polish after backend contracts are stable.
12. Security/public mode hardening.
13. Optional migration/importer from old workspace layout.
