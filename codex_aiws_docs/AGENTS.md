# AGENTS.md — Local AI Workspace Development Guide

This file gives Codex project-specific instructions.

## Project identity

This repository implements **Local AI Workspace (`aiws`)**, a local-first AI workspace for Mac.

The product organizes AI conversations as:

```text
Project
└─ optional Subproject
   └─ Session
```

It supports three execution modes using one shared core:

1. CLI mode.
2. Local UI mode bound to `127.0.0.1`.
3. Server UI mode bound to `0.0.0.0` with password required.

## Current source layout

```text
aiws/
  __init__.py
  cli.py
  storage.py
  web.py
skills/
  andrej-karpathy-skills/
    CLAUDE.md
tests/
  test_storage.py
pyproject.toml
README.md
```

## Development rules

1. Read existing code before editing.
2. Make surgical changes only.
3. Do not refactor unrelated code.
4. Keep storage logic in the core layer, not duplicated in CLI or UI.
5. Keep project depth limited to root project + one optional subproject.
6. Preserve JSONL and Markdown session storage.
7. Add tests for every behavior change.
8. Run tests before finishing.
9. Do not add cloud dependencies unless the task explicitly asks for them.
10. Do not commit secrets or API keys.

## Test command

Use:

```bash
python -m unittest discover -s tests
```

If the project later adopts pytest, update this file.

## Existing behavior to preserve

- `aiws --root <path> init`
- `aiws --root <path> skills list`
- `aiws --root <path> project create ...`
- `aiws --root <path> session create ...`
- `aiws --root <path> session append ...`
- `aiws --root <path> prompt ...`
- `aiws --root <path> ui start --mode local ...`
- `aiws --root <path> ui start --mode server ...`

## Skill behavior

Skill directories live under:

```text
<workspace-root>/skills/<skill-name>/
```

Supported instruction file names:

- `CLAUDE.md`
- `SKILL.md`
- `skills.md`
- `README.md`

Subprojects inherit parent project skills and may add their own.

## Next milestone recommendation

Implement `aiws ask` with Ollama first.

Target command:

```bash
aiws --root ~/.ai-workspace ask ai-system/local-runner step-1-mvp \
  --provider ollama \
  --model qwen3:14b \
  --content "What should we implement next?"
```

Definition of done:

1. Builds prompt context from project, skills, and session.
2. Appends user message to the session.
3. Calls Ollama at `http://127.0.0.1:11434/api/chat` by default.
4. Appends assistant response to JSONL.
5. Updates Markdown session archive.
6. Prints response to stdout.
7. Tests mock the Ollama HTTP call.

## Non-goals for the Ollama milestone

Do not implement yet:

- Kimi/OpenAI/Claude/Gemini providers.
- Web search.
- RAG/file upload.
- User accounts.
- Docker deployment.
- Heavy frontend framework.

## Code style preference

Prefer clear Python standard-library code unless a dependency is necessary.

If adding a dependency, explain why it is needed.
