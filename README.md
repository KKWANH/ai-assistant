# AI Workbench Studio (AIWS)

**Local-first AI cockpit for projects, files, and agent runs.**

Not another ChatGPT clone. AI Workbench Studio turns a project folder into a configurable AI cockpit for chats, files, actions, run logs, artifacts, model routing, and diagnostics.

AIWS organizes conversations, project files, goals, prompt recipes, and local command runs around your own folders. It is designed for a Mac mini or similar personal machine first, with optional family access through a private tunnel and bring-your-own-key cloud models.

This MVP focuses on a reliable file-based foundation:

- CLI mode for fully local terminal workflows.
- Local UI mode bound to `127.0.0.1`.
- Server UI mode bound to `0.0.0.0` with required password authentication.
- Two-level project hierarchy: `project` or `project/subproject`.
- JSONL and Markdown archives for every session.
- Reusable project skills with parent-to-subproject inheritance.
- `aiws.yaml` project commands for prompt recipes, shell scripts, Python scripts, file indexing, Codex prompts, and optional OpenClaw status checks.
- Context & Files inspector for attached files, context manifests, runs, artifacts, and diagnostics.
- Experimental Agent Plan preview for controlled Planner -> Execute -> Analyze -> Report workflows.

## Core Idea

```text
local folder + aiws.yaml + files + scripts + chat = customizable AI workspace
```

Examples:

- Investment rebalancing workspace with CSV/YAML inputs and Python reports.
- Paper review workspace with PDF files, review criteria, and prompt recipes.
- Development workspace with goals, files, test commands, and Codex-ready prompts.
- Family document workspace for receipts, schedules, travel docs, and explanations.

## Architecture

```text
React UI
  -> Python HTTP server
    -> file-based workspace storage
    -> provider registry: Ollama, Kimi, Gemini, OpenAI
    -> action registry: prompt_recipe, shell, python, file_index, codex_prompt, openclaw_status
    -> local run artifacts under project/runs/{run_id}/
```

Screenshots:

- `docs/screenshots/login.png` placeholder
- `docs/screenshots/chat.png` placeholder
- `docs/screenshots/model-picker.png` placeholder
- `docs/screenshots/project-commands.png` placeholder

## Install For Local Development

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## Test

```bash
python -m pytest
```

For the React web UI bundle:

```bash
cd web
npm install
npm run build
```

## CLI Example

```bash
aiws init --root ~/.ai-workspace
aiws skills list --root ~/.ai-workspace

aiws account create kwanho \
  --root ~/.ai-workspace \
  --password "change-this" \
  --admin

aiws account create parent \
  --root ~/.ai-workspace \
  --password "change-this-too"

aiws project create "AI System" \
  --root ~/.ai-workspace \
  --owner kwanho \
  --visibility private \
  --skills andrej-karpathy-skills \
  --notes "Local-first AI gateway for Mac mini."

aiws project create "Local Runner" \
  --root ~/.ai-workspace \
  --parent ai-system

aiws session create ai-system/local-runner "Ollama MVP" \
  --root ~/.ai-workspace

aiws session append ai-system/local-runner ollama-mvp \
  --root ~/.ai-workspace \
  --role user \
  --content "How should we implement the Ollama runner?"

aiws prompt ai-system/local-runner ollama-mvp \
  --root ~/.ai-workspace
```

## Accounts And Project Visibility

AIWS uses a file-based MVP account store at:

```text
workspace_root/users.json
```

Passwords are hashed with PBKDF2-SHA256. Projects can be:

- `private`: visible to the owner and admin accounts.
- `public`: visible to every logged-in account.

Admin accounts can list every project and inspect per-account usage counters.

```bash
aiws account list --root ~/.ai-workspace
aiws project list --root ~/.ai-workspace --user kwanho
```

Accounts also have profile context used for conversations:

```bash
aiws account update kwanho \
  --root ~/.ai-workspace \
  --name "Kwanho Kim" \
  --age "40" \
  --job "Engineer" \
  --situation "Building a local-first AI workspace." \
  --language ko \
  --memory "Prefers concise Korean answers."
```

The UI profile page supports language selection and image-only avatar upload.

This is intentionally simple for the MVP. For broader internet exposure, keep AIWS behind Cloudflare Tunnel or Tailscale and avoid exposing the raw port directly.

## Ask With Ollama

Install and run Ollama separately, then pull a model:

```bash
ollama serve
ollama pull qwen3:0.6b
```

Ask stores both the user message and assistant response in the session:

```bash
aiws ask ai-system/local-runner ollama-mvp \
  --root ~/.ai-workspace \
  --provider ollama \
  --model qwen3:0.6b \
  --content "What should we implement next?"
```

For better local quality on a 24GB Mac, try `qwen3:8b` after the smoke test works.

Kimi uses Moonshot's OpenAI-compatible API. Set one of:

```bash
cp .env.example .env
# then set AIWS_KIMI_API_KEY=... or MOONSHOT_API_KEY=...
```

Then run:

```bash
aiws ask ai-system/local-runner ollama-mvp \
  --root ~/.ai-workspace \
  --provider kimi \
  --model kimi-k2.5 \
  --search-mode auto \
  --content "What is the latest context I should consider?"
```

Model cost estimates:

```bash
aiws models costs --root ~/.ai-workspace
```

Search modes:

- `off`: local project/session/file context only.
- `auto`: currently still local-only; reserved for future web search.
- `always`: currently disabled until a real search provider is configured.

AIWS does not pretend to browse the web yet. The current search module records intent and has a provider boundary; a real web-search provider is a future increment.

## Attachments

The web UI can upload session attachments:

- text: `.txt`, `.md`
- documents: `.pdf`, `.docx`
- images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`

Text extraction is lightweight and intentionally conservative. Full OCR and rich PDF parsing are future modules.

## Custom Project Commands

Projects can include an `aiws.yaml` file:

```yaml
name: Investment Rebalancer
description: Local portfolio rebalancing workspace
root: .
permissions:
  file_read: true
  file_write: confirm
  shell: confirm
  network: false
context:
  include:
    - files/*.csv
    - files/*.yaml
    - files/*.md
  exclude:
    - .env
    - secrets/*
commands:
  summarize_portfolio:
    kind: prompt_recipe
    label: 현재 포트폴리오 요약
    prompt: |
      files/portfolio.csv와 목표 비중을 읽고 현재 포트폴리오를 요약해줘.
  rebalance_plan:
    kind: python
    label: 리밸런싱 계산
    script: scripts/calculate_rebalance.py
    args:
      - files/portfolio.csv
      - files/target_allocation.yaml
      - artifacts/rebalance-table.csv
```

Every command run writes:

```text
projects/<project>/runs/<run_id>/
  run.md
  stdout.txt
  stderr.txt
  result.json
```

The bundled example is in `templates/investment-rebalancer/`.

## Runtime Launcher

Run AIWS and local model services together:

```bash
aiws run \
  --root ~/.ai-workspace \
  --mode local \
  --port 8765 \
  --models ollama \
  --idle-timeout 1800 \
  --status-path ~/.ai-workspace/runtime-status.json
```

`aiws run` starts the UI, starts `ollama serve` when requested, writes a JSON status file, and stops the owned Ollama process after the workspace has been idle for the configured timeout. Use `--models none` to run only the UI.

The older generic supervisor remains available for arbitrary commands:

```bash
aiws supervise --status-path /tmp/aiws-status.json -- aiws ui start --root ~/.ai-workspace --mode local --port 8765
```

## Local UI

```bash
aiws run \
  --root ~/.ai-workspace \
  --mode local \
  --port 8765 \
  --models ollama
```

Open `http://127.0.0.1:8765`.

## Server UI

```bash
aiws run \
  --root ~/.ai-workspace \
  --mode server \
  --port 8765 \
  --models ollama
```

Server mode binds to `0.0.0.0` and refuses to start without a password. Put it behind Cloudflare Tunnel, Tailscale, or a trusted reverse proxy before exposing it outside your network.

If accounts already exist in the workspace, server mode can use account login instead of the legacy `--password` bootstrap guard.

## Hosting Recommendation

For this product, the recommended low-cost path is:

1. Run AIWS on the Mac mini.
2. Keep the canonical files on the Mac mini.
3. Use Tailscale for private family access first.
4. Use Cloudflare Tunnel later if browser-only public-domain access is needed.

Vercel is not the first choice for AIWS because the app needs local file storage, local Ollama, and long-running local services. A serverless deployment would either lose the local-first storage advantage or require moving state/model calls elsewhere.

Detailed docs:

- [Hosting Runbook](docs/HOSTING_RUNBOOK.md)
- [Security Test Plan](docs/SECURITY_TEST_PLAN.md)
- [Safe Home Deployment Checklist](docs/HOME_DEPLOYMENT_CHECKLIST.md)

## Mac Mini Self-Host Checklist

1. Install Python dependencies with `pip install -e ".[dev]"`.
2. Build the UI once with `cd web && npm install && npm run build`.
3. Initialize the workspace with `aiws init --root ~/.ai-workspace`.
4. Create one admin account and one family test account.
5. Keep projects `private` by default; use `public` only for family-shared material.
6. Start local use with `aiws run --root ~/.ai-workspace --mode local --port 8765 --models ollama`.
7. Start browser access with `aiws-cloudflare start`, then open the URL from `aiws-cloudflare status`.
   For a stable custom domain such as `ai.kwanho.dev`, use a named Cloudflare Tunnel.
   See [Cloudflare Custom Domain Runbook](docs/CLOUDFLARE_CUSTOM_DOMAIN.md).
8. Add Kimi by copying `.env.example` to `.env` and setting `AIWS_KIMI_API_KEY` or `MOONSHOT_API_KEY`.
9. Create regular backups:

```bash
aiws backup create --root ~/.ai-workspace --output ~/aiws-workspace-backup
```

Restore test:

```bash
aiws backup restore ~/aiws-workspace-backup.tar.gz --root ~/.ai-workspace-restored
aiws project list --root ~/.ai-workspace-restored
```

## Storage Layout

```text
workspace_root/
  projects/
    ai-system/
      project.json
      sessions/
        ollama-mvp/
          session.json
          messages.jsonl
          session.md
      local-runner/
        project.json
        sessions/
          ...
  skills/
    andrej-karpathy-skills/
      CLAUDE.md
```

## Roadmap

Implemented foundations include Ollama, Kimi, Gemini, OpenAI-compatible providers, account login, project visibility, file attachments, cost estimates, Cloudflare launcher support, goals, and project command recipes.

Still planned:

- richer PDF parsing with `pypdf` and optional OCR
- real web search provider integration
- vector/RAG indexing over selected project files
- stronger project memory summarization
- richer artifacts panel
- Playwright E2E coverage
- component-level frontend refactor beyond the action panel split
