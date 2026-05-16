# AI Workbench Studio

AI Workbench Studio is a local-first AI cockpit that turns your project folder into a traceable workspace for chats, files, model runs, actions, and artifacts.

```text
Folder -> aiws.yaml -> Context -> Actions -> Runs -> Artifacts -> Reports
```

AIWS is built for people who want AI help on local projects without losing sight of what files were used, what model was selected, what left the machine, and what output was created.

## Why AIWS?

Most AI tools start from a blank chat. AIWS starts from your folder.

- Keep project chats, files, goals, runs, and artifacts together.
- Use local Ollama models first, with optional BYOK cloud providers.
- Inspect context receipts after model calls.
- Run repeatable `aiws.yaml` actions.
- Keep storage file-based and easy to back up.
- Host locally, then optionally expose through Tailscale or Cloudflare Tunnel.

## What Makes It Different?

- **Folder-native workspace**: projects live under a local workspace root.
- **Configurable actions**: `aiws.yaml` defines prompt recipes, file indexes, Codex briefs, shell/Python actions, and expected artifacts.
- **Inspectable AI runs**: action runs produce `run.json`, `run.md`, logs, and artifacts.
- **Context receipt**: every meaningful model call can show model, provider, local/cloud mode, estimated cost, files used, exclusions, chunks, and network mode.
- **Local-first model routing**: Qwen/Ollama by default; Gemini, Kimi, OpenAI, and ERNIE through your own API keys.
- **Public tunnel awareness**: diagnostics and local implementation details are kept away from non-admin/public views.

## Quickstart

```bash
git clone https://github.com/KKWANH/ai-assistant.git
cd ai-assistant
./scripts/install.sh
./scripts/start.sh
```

Then open:

```text
http://127.0.0.1:8765
```

If you prefer manual setup:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cd web && npm install && npm run build && cd ..
aiws init --root ~/.ai-workspace
aiws run --root ~/.ai-workspace --mode local --port 8765 --models ollama
```

## Local Model Setup

Install Ollama and pull a local model:

```bash
ollama serve
ollama pull qwen3:8b
```

AIWS defaults to local Ollama for private short text. Cloud models are optional and require your own API keys in `.env`.

## Example Workflows

### 1. Summarize Documents

Use `examples/document-review/` to review local notes and documents into a markdown artifact.

### 2. Analyze CSV

Use `examples/csv-analysis/` or attach a CSV/XLS/XLSX file from Home. AIWS profiles tables deterministically before asking a model to summarize the computed profile.

### 3. Create A Codex Task Prompt

Use `examples/codex-brief/` or the Home Workbench action to turn a goal into an implementation brief.

### 4. Build A Project Workspace

Create a folder with `aiws.yaml`, include local notes/data/scripts, and let AIWS track context, runs, and artifacts.

### 5. Investment Advisor Workbench

Use `examples/investment-advisor/` or import the `investment-advisor` template into a project. It shows how to build a custom AIWS app with portfolio CSVs, ETF/stock watchlists, target-allocation scenarios, network-approved market snapshots, deterministic rebalance math, and Markdown report artifacts. It is educational scaffolding, not financial advice.

## `aiws.yaml`

`aiws.yaml` is the project control file.

```yaml
version: 1
name: Research Workspace
description: Local AI workbench for document review and notes.
root: .

context:
  include:
    - notes/**/*.md
    - data/**/*.csv
  exclude:
    - .env
    - secrets/**
    - keys/**
    - .git/**

commands:
  summarize_docs:
    kind: prompt_recipe
    label: Summarize documents
    prompt: |
      Review the included notes and write a markdown summary.
    outputs:
      - artifacts/summary.md
```

See [docs/aiws-yaml.md](docs/aiws-yaml.md).

## Context Receipt

A context receipt answers:

- Which provider/model was used?
- Was it local, cloud, or network-assisted?
- What was the estimated cost?
- Which files and chunks were used?
- Which files were excluded?
- Was raw file text sent, or only a computed profile?
- Was web/network access allowed?

Receipt title pattern:

```text
Context receipt · local · 1 file · 0 USD
```

## Runs And Artifacts

Action runs are saved as inspectable records:

```text
projects/<project>/runs/<run_id>/
  run.json
  run.md
  result.json
  stdout.txt
  stderr.txt
  artifacts/
```

Home starter actions use:

```text
users/<username>/home/runs/
users/<username>/home/artifacts/
```

Artifacts are treated as work products, not just attachments. The UI shows type, source run, size, and open/download/copy actions where available.

## Security Model

AIWS is local-first, but server mode and public tunnels still need care.

- Local mode binds to `127.0.0.1`.
- Server mode binds to `0.0.0.0` and requires authentication.
- Public tunnel/domain access should use accounts and strong passwords.
- API key values are never sent to the frontend.
- Common secret paths are excluded from context.
- Diagnostics, local paths, admin scripts, and localhost URLs are hidden from non-admin/public views.

Recommended public-demo flags:

```bash
AIWS_PUBLIC_DEMO=true
AIWS_SHOW_DIAGNOSTICS=false
AIWS_ALLOW_ADMIN_LINKS=false
```

See [SECURITY.md](SECURITY.md).

## Cloudflare / Tailscale Access

For family/browser access, prefer a tunnel rather than exposing a raw port.

- Tailscale: private network access.
- Cloudflare quick tunnel: temporary testing URL.
- Cloudflare named tunnel: stable custom domain such as `ai.kwanho.dev`.

See:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/HOSTING_RUNBOOK.md](docs/HOSTING_RUNBOOK.md)
- [docs/CLOUDFLARE_CUSTOM_DOMAIN.md](docs/CLOUDFLARE_CUSTOM_DOMAIN.md)
- [docs/HOME_DEPLOYMENT_CHECKLIST.md](docs/HOME_DEPLOYMENT_CHECKLIST.md)

## Useful Commands

```bash
./scripts/install.sh
./scripts/start.sh
./scripts/dev.sh
./scripts/lint.sh
./scripts/test.sh
./scripts/build.sh
./scripts/doctor.sh
./scripts/aiws-doctor.sh
```

Direct Python commands:

```bash
source .venv/bin/activate
python -m pytest
python -m ruff check src tests
cd web && npm run build
```

## Storage Layout

```text
workspace_root/
  users.json
  projects/
    project/
      project.json
      aiws.yaml
      goal.json
      sessions/
        session/
          session.json
          messages.jsonl
          session.md
          attachments/
          context_receipts.jsonl
      runs/
  users/<username>/home/
    runs/
    artifacts/
  usage/model_usage.jsonl
```

## Roadmap

- Stronger component split in `web/src`.
- More deterministic parsers for PDFs and Office files.
- Richer artifact viewer.
- Optional Playwright smoke tests.
- Docker support: planned, but local Mac/Linux install is the recommended first path.

## Contributing

Keep changes boring and inspectable:

- Preserve file-based storage.
- Keep project depth to `project` or `project/subproject`.
- Add tests for behavior changes.
- Do not log secrets.
- Do not expose diagnostics in public views.
