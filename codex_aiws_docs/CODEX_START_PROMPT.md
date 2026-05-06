# Codex Start Prompt — Local AI Workspace

You are working on a local-first AI workspace project called **Local AI Workspace (`aiws`)**.

The user wants to develop this locally with Codex on a Mac mini. Treat this as an iterative engineering project, not a one-shot prototype. Make small, verifiable changes. Do not over-engineer.

## Current project state

The repository already contains an MVP v2 with:

- Python package: `aiws`
- CLI entrypoint: `aiws`
- Core storage logic: `aiws/storage.py`
- CLI wrapper: `aiws/cli.py`
- Minimal web UI wrapper: `aiws/web.py`
- Tests: `tests/test_storage.py`
- Example skill: `skills/andrej-karpathy-skills/CLAUDE.md`
- README: `README.md`

Current implemented features:

1. Workspace initialization.
2. Project creation.
3. Optional subproject creation, but only one subproject level is allowed.
4. Session creation.
5. Message append.
6. JSONL message archive.
7. Markdown session archive.
8. Project-level skills selection.
9. Subproject skill inheritance.
10. Prompt context generation from project metadata, skills, and session history.
11. Three execution modes:
   - CLI mode
   - local UI mode bound to `127.0.0.1`
   - server UI mode bound to `0.0.0.0` with password required

## Product goal

Build a personal AI workspace that can run in three modes using the same core:

```text
Local AI Workspace Core
├─ CLI mode
├─ local-hosted UI mode
└─ server-hosted UI mode
```

The core must stay independent of any specific UI or model provider.

The system should eventually support:

- local LLM execution through Ollama
- cloud LLM routing through Kimi, OpenAI, Anthropic/Claude, and Google Gemini
- search-first answers for daily use
- file-based conversation storage
- project/subproject/session organization
- project-selectable skills such as `CLAUDE.md`, `SKILL.md`, and `skills.md`
- parent/family access through a password-protected server mode

## Important design constraints

### 1. Local-first

The user must be able to run the system directly on their Mac without any remote server.

The local mode should be fast and private.

### 2. Same core, three wrappers

Do not duplicate business logic between CLI, local UI, and server UI.

Storage, project/session logic, skill resolution, and prompt context generation must live in the core layer.

### 3. Project depth limit

The hierarchy is exactly:

```text
Project
└─ optional Subproject
   └─ Sessions
```

Allowed:

```text
ai-system
ai-system/local-runner
```

Not allowed:

```text
ai-system/local-runner/ollama-test
```

### 4. File-based durable storage

Every session must be stored in both:

- `messages.jsonl` for machine use
- `session.md` for human reading

Avoid locking important conversation data only inside an opaque DB.

### 5. Skills must be selectable from UI and CLI

Skills are not only command-line flags. A user must be able to select, update, and review skills in the UI when creating or editing a project.

A project may have multiple skills.

Subprojects inherit parent skills and may add their own.

Supported skill file names:

- `CLAUDE.md`
- `SKILL.md`
- `skills.md`
- `README.md`

### 6. Search is essential

For daily conversation, speed and accuracy matter. Local models must not rely only on their internal knowledge for fresh facts.

Eventually add a search-first pipeline:

```text
user message
→ decide/search mode
→ search provider
→ collect sources
→ answer with model
→ store answer + source metadata
```

Search modes should eventually be:

- `off`
- `auto`
- `always`

Initial search providers may include:

- SearXNG
- Brave Search API
- Tavily
- Kimi search
- provider-native search for OpenAI/Claude/Gemini if available

### 7. Low-cost model routing matters

Kimi or similar low-cost providers should be supported as a default inexpensive cloud model.

Do not assume every cloud call should use the most expensive model.

Suggested future routing:

```text
local quick/private       → Ollama model
cheap cloud + search      → Kimi
high-stakes reasoning     → OpenAI / Claude
long context/multimodal   → Gemini
```

## Development behavior

Follow these rules:

1. Read the repository before changing code.
2. State any assumptions before implementing.
3. Prefer small, surgical changes.
4. Do not rewrite unrelated code.
5. Keep the storage API stable unless a change is clearly necessary.
6. Add or update tests for every behavior change.
7. Run tests before finishing.
8. If something is ambiguous, make a minimal reasonable choice and document it.

## Suggested next milestone

Implement **MVP 3: `aiws ask` with Ollama provider**.

Command target:

```bash
aiws --root ~/.ai-workspace ask ai-system/local-runner step-1-mvp \
  --provider ollama \
  --model qwen3:14b \
  --content "What should we implement next?"
```

Expected behavior:

1. Resolve workspace root.
2. Load project and session.
3. Build prompt context including project metadata, inherited skills, and session history.
4. Append the user message to the session.
5. Call local Ollama API.
6. Append the assistant response to `messages.jsonl`.
7. Regenerate or append to `session.md`.
8. Print the assistant response to stdout.

Suggested default Ollama endpoint:

```text
http://127.0.0.1:11434/api/chat
```

Suggested implementation files:

```text
aiws/providers/base.py
aiws/providers/ollama.py
aiws/runner.py
```

But keep it minimal. If fewer files are enough, prefer fewer files.

## MVP 3 non-goals

Do not implement these yet unless explicitly asked:

- Kimi/OpenAI/Claude/Gemini providers
- search pipeline
- file upload/RAG
- authentication overhaul
- database migration
- advanced UI framework
- Docker packaging
- Cloudflare/Tailscale deployment

## Definition of done for MVP 3

The task is done when:

1. `aiws ask ... --provider ollama --model <model> --content <text>` works against a running local Ollama instance.
2. User and assistant messages are both stored in JSONL.
3. Markdown session output is updated.
4. Existing tests pass.
5. New tests cover provider selection and message persistence, with Ollama network calls mocked.
6. No unrelated refactors are included.

## First action

Start by reading:

```text
README.md
pyproject.toml
aiws/storage.py
aiws/cli.py
aiws/web.py
tests/test_storage.py
```

Then propose a short implementation plan and proceed.
