# Architecture

AIWS is intentionally boring: a Python backend, a React frontend, and file-based workspace storage.

## Layers

```text
web/src/
  React UI
    -> fetch /api/*

src/aiws/ui.py
  HTTP server, auth, CSRF, static assets
    -> app/routes/*

src/aiws/app/routes/
  API payload builders and route-specific adapters
    -> domain/*
    -> core/*

src/aiws/domain/
  Account, project, chat, goal, and usage operations
    -> storage.py

src/aiws/core/
  Workbench concepts:
  actions, context manifests, context receipts, work sessions,
  deterministic CSV/table profiling, model capability contracts

src/aiws/providers/
  Ollama, Gemini, Kimi, OpenAI, ERNIE provider adapters

src/aiws/storage.py
  File-based workspace invariants and project/session layout
```

## Request Flow

```text
Browser
  -> ui.py
  -> auth/CSRF/project access
  -> route handler
  -> domain/core service
  -> storage/provider/action execution
  -> JSON response
```

## Chat Flow

```text
POST /api/ask/<project>/<session>
  -> parse form and optional attachment
  -> validate project access
  -> extract or profile file context
  -> build execution plan preview
  -> runner.ask
  -> provider call
  -> build context manifest and receipt
  -> append messages.jsonl
  -> update work-session record
```

## Action Flow

```text
aiws.yaml
  -> action_registry.load_config
  -> validate root/path/security/capabilities
  -> execute prompt_recipe/shell/python/file_index/codex_prompt
  -> runs/<run_id>/run.json
  -> artifacts
  -> inspector/run timeline
```

## Storage Invariants

- Workspace data is file-based.
- Projects live under `<workspace-root>/projects/`.
- Skills live under `<workspace-root>/skills/`.
- Sessions store both `messages.jsonl` and `session.md`.
- Project depth is limited to `project` or `project/subproject`.
- Private projects are visible to owner/admin accounts.
- Public projects are visible to logged-in accounts.

## Public Surface

Server mode may be exposed through Cloudflare or Tailscale, but diagnostics and local implementation details must remain admin-only or hidden by `AIWS_PUBLIC_DEMO=true`.
