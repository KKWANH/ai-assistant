# Local AI Workspace — Project Specification

## 1. Product summary

**Local AI Workspace (`aiws`)** is a local-first personal AI workspace for organizing AI conversations by project, subproject, and session.

It is designed for a Mac mini local environment, but should also support optional server deployment for family access.

The system must support both:

1. Local models running directly on the user's Mac.
2. Cloud models accessed by API tokens.

The system must store conversations in a durable, readable file structure so the user can move across sessions easily and reuse past context.

## 2. Core concept

The product is not just a chatbot UI. It is a workspace layer above multiple models.

```text
User
↓
Project / Subproject / Session Workspace
↓
Skill Instructions
↓
Search Layer
↓
Model Provider
↓
File-based Conversation Store
```

## 3. Execution modes

The same core must support three modes.

### 3.1 CLI mode

Runs directly from terminal.

Example:

```bash
aiws --root ~/.ai-workspace project create "AI System"
aiws --root ~/.ai-workspace session create ai-system "Architecture Notes"
aiws --root ~/.ai-workspace prompt ai-system architecture-notes
```

Future:

```bash
aiws --root ~/.ai-workspace ask ai-system architecture-notes \
  --provider ollama \
  --model qwen3:14b \
  --content "Summarize this architecture."
```

### 3.2 Local UI mode

Runs a local web UI only on the user's machine.

```bash
aiws --root ~/.ai-workspace ui start --mode local --port 8765
```

Expected binding:

```text
127.0.0.1:8765
```

Purpose:

- fast local use
- no external exposure
- UI-based project/session/skill management

### 3.3 Server UI mode

Runs a network-facing web UI.

```bash
aiws --root ~/.ai-workspace ui start --mode server --port 8765 --password "change-me"
```

Expected binding:

```text
0.0.0.0:8765
```

Server mode must require a password.

This mode is intended to sit behind:

- Cloudflare Tunnel
- Tailscale
- reverse proxy with HTTPS

Do not expose the raw app directly to the public internet.

## 4. Workspace model

### 4.1 Hierarchy

The system supports exactly two project levels.

```text
Project
├─ Session
└─ Subproject
   └─ Session
```

Allowed:

```text
ai-system
ai-system/local-runner
```

Disallowed:

```text
ai-system/local-runner/ollama-test
```

### 4.2 Project

A project contains:

- slug
- title
- notes
- selected skills
- sessions
- optional subprojects

### 4.3 Subproject

A subproject is the only allowed nested project level.

Subprojects inherit parent skills and may add their own skills.

### 4.4 Session

A session is a conversation or writing unit.

Each session contains:

- session metadata
- message history
- human-readable Markdown archive
- machine-readable JSONL archive

## 5. Storage design

Expected workspace structure:

```text
~/.ai-workspace/
├─ projects/
│  └─ ai-system/
│     ├─ project.json
│     ├─ sessions/
│     │  └─ architecture-notes/
│     │     ├─ session.json
│     │     ├─ messages.jsonl
│     │     └─ session.md
│     └─ local-runner/
│        ├─ project.json
│        └─ sessions/
│           └─ step-1-mvp/
│              ├─ session.json
│              ├─ messages.jsonl
│              └─ session.md
└─ skills/
   └─ andrej-karpathy-skills/
      └─ CLAUDE.md
```

### 5.1 JSONL

`messages.jsonl` is the canonical machine-readable conversation log.

Each line should be a standalone JSON object.

Recommended fields:

```json
{
  "role": "user",
  "content": "...",
  "created_at": "2026-05-05T12:00:00+02:00",
  "metadata": {}
}
```

For assistant messages:

```json
{
  "role": "assistant",
  "content": "...",
  "created_at": "2026-05-05T12:00:05+02:00",
  "metadata": {
    "provider": "ollama",
    "model": "qwen3:14b"
  }
}
```

### 5.2 Markdown

`session.md` is the human-readable archive.

It should be regenerated or safely appended whenever the session changes.

## 6. Skills design

Skills are reusable instruction packs.

Supported file names:

- `CLAUDE.md`
- `SKILL.md`
- `skills.md`
- `README.md`

A skill directory may contain one or more of these files.

Example:

```text
skills/
└─ andrej-karpathy-skills/
   └─ CLAUDE.md
```

### 6.1 Skill application

When building prompt context:

1. Load parent project skills.
2. Load subproject skills.
3. Deduplicate skills while preserving order.
4. Include skill file content before session history.

### 6.2 UI requirements

The UI must allow:

- listing available skills
- selecting skills when creating a project
- editing selected skills on an existing project
- viewing which skills are active for a session

## 7. Model provider design

The core should eventually support multiple model providers.

### 7.1 Local provider

Initial local provider:

- Ollama

Default endpoint:

```text
http://127.0.0.1:11434/api/chat
```

Suggested local models:

- `qwen3:8b`
- `qwen3:14b`
- `gemma3:12b`
- `mistral-small3.2`

### 7.2 Cloud providers

Future providers:

- Kimi / Moonshot
- OpenAI
- Anthropic Claude
- Google Gemini
- OpenRouter or LiteLLM as optional routing layers

### 7.3 Routing philosophy

Suggested routing:

```text
fast/private/local      → Ollama
cheap cloud/search      → Kimi
complex reasoning       → OpenAI or Claude
long context/multimodal → Gemini
```

## 8. Search-first design

Search is mandatory for accurate daily conversation.

Local models must not answer fresh/current questions from internal weights only.

Future search modes:

```text
off     → never search
auto    → search if needed
always  → always search first
```

Possible providers:

- SearXNG
- Brave Search API
- Tavily
- Exa
- Kimi search
- provider-native web search where available

Search results should be stored as metadata when used.

Suggested assistant metadata:

```json
{
  "provider": "kimi",
  "model": "kimi-k2.5",
  "search": {
    "mode": "always",
    "queries": ["..."],
    "sources": [
      {
        "title": "...",
        "url": "...",
        "snippet": "..."
      }
    ]
  }
}
```

## 9. UI design principles

The UI should remain simple.

Primary UI objects:

- project list
- subproject list
- session list
- active session view
- message composer
- skill selector
- provider/model selector
- search mode selector

Avoid adding a heavy frontend framework until the backend/core stabilizes.

## 10. Security principles

### Local mode

- bind only to `127.0.0.1`
- no password required by default
- not reachable from other machines

### Server mode

- bind to `0.0.0.0`
- password required
- should be deployed behind Cloudflare Tunnel, Tailscale, or reverse proxy
- avoid exposing raw port directly

### API keys

Do not commit API keys.

Use environment variables or local config files excluded from Git.

Suggested future environment variables:

```text
AIWS_OPENAI_API_KEY
AIWS_ANTHROPIC_API_KEY
AIWS_GEMINI_API_KEY
AIWS_KIMI_API_KEY
AIWS_BRAVE_SEARCH_API_KEY
AIWS_TAVILY_API_KEY
```

## 11. MVP roadmap

### MVP 1 — Local Workspace Core

Status: implemented.

- workspace init
- project/subproject/session storage
- JSONL + Markdown archive
- skill selection
- skill inheritance
- prompt context generation

### MVP 2 — Three execution modes

Status: implemented.

- CLI mode
- local UI mode
- server UI mode with password guard
- UI-based project/session/skill operations

### MVP 3 — Direct Ollama runner

Next target.

- `aiws ask`
- Ollama provider
- message persistence
- mocked tests

### MVP 4 — Cloud provider router

- Kimi
- OpenAI
- Claude
- Gemini
- provider configuration
- model selection

### MVP 5 — Search-first pipeline

- search modes
- search provider abstraction
- source metadata storage
- answer grounding

### MVP 6 — File/RAG support

- file upload
- text extraction
- chunking
- embeddings
- vector search
- per-project knowledge base

### MVP 7 — Family/parent deployment

- restricted UI
- simple account/password model
- model/provider limits
- cost guardrails
- Cloudflare/Tailscale deployment guide

## 12. Engineering style

Follow these engineering principles:

1. Minimal changes.
2. Explicit assumptions.
3. Tests before broad refactors.
4. No speculative abstractions.
5. Keep core independent from UI.
6. Do not duplicate storage logic.
7. Preserve human-readable archives.
8. Avoid deep hierarchy creep.
9. Keep server security conservative.
10. Prefer working local-first behavior over cloud complexity.
