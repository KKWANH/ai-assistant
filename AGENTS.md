# AGENTS.md - Local AI Workspace Development Guide

This repository implements **Local AI Workspace (AIWS)**, a local-first personal AI workspace for organizing AI conversations by project, optional subproject, and session.

## Architecture Summary

AIWS keeps business logic in the core package and exposes it through:

- CLI mode.
- Local UI mode bound to `127.0.0.1`.
- Server UI mode bound to `0.0.0.0` with password required.

Core storage, skill resolution, prompt context generation, and project/session rules live in `src/aiws/storage.py`.

## Do Not Overbuild

- Prefer boring, readable Python.
- Avoid speculative abstractions.
- Do not add model providers, search, RAG, accounts, or deployment tooling until explicitly requested.
- Keep changes surgical and tied to the task.

## Test Commands

Use:

```bash
python -m pytest
```

## Storage Invariants

- Workspace data is file-based.
- Projects live under `<workspace-root>/projects/`.
- Skills live under `<workspace-root>/skills/`.
- Each session stores both `messages.jsonl` and `session.md`.
- JSONL is the canonical append-friendly machine log.
- Markdown is the human-readable archive regenerated after message changes.

## Project Depth Rule

Only two project levels are allowed:

- Allowed: `project`
- Allowed: `project/subproject`
- Forbidden: `project/subproject/third-level`

Reject invalid paths explicitly.

## UI Security Rule

- Local UI mode must bind only to `127.0.0.1`.
- Server UI mode must bind to `0.0.0.0`.
- Server UI mode must require authentication through either workspace accounts or the legacy bootstrap password.
- Do not expose server mode without authentication.

## Account And Visibility Rule

- Workspace accounts live in `users.json`.
- Passwords must be hashed, never stored as plaintext.
- Projects must include `owner` and `visibility`.
- `private` projects are visible to the owner and admin accounts.
- `public` projects are visible to logged-in accounts.
- Admin accounts may inspect all projects and per-account usage.

## Skill Inheritance Rule

- Root projects may select one or more skills.
- Subprojects inherit parent project skills.
- Subprojects may add their own skills.
- Prompt context must deduplicate inherited and local skills while preserving order.

## Definition of Done

- Behavior is implemented with minimal scope.
- Tests cover behavior changes.
- `python -m pytest` passes.
- Existing storage invariants remain intact.
- No secrets or API keys are committed.
