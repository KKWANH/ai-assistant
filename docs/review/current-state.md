# Current State Review

Generated as part of the AIWS productization pass.

## Product Shape

AI Workbench Studio is currently a local-first Python/React workbench with file-based storage, local/server UI modes, project/session chat, deterministic file preprocessing, model-provider routing, `aiws.yaml` actions, run records, artifacts, and context receipts.

Core product loop:

```text
Folder -> aiws.yaml -> Context -> Actions -> Runs -> Artifacts -> Reports
```

## Executable Routes And Pages

SPA routes served by `src/aiws/ui.py`:

- `/` and `/home`: work session launcher.
- `/login`: auth screen.
- `/projects`: project list/dashboard entry.
- `/projects/new`: project creation.
- `/chat/<project>/<session>`: chat/work-session record.
- `/project/<project>`: project dashboard.
- `/actions`, `/actions/new`: action surfaces.
- `/profile`: account/profile settings.
- `/admin`: legacy admin page, local/admin only.
- `/prompt/<project>/<session>`: prompt context preview, protected by project access.

Static and file routes:

- `/assets/*`, `/aiws-icon.svg`: built web assets.
- `/avatar/<username>`: account avatar.
- `/attachment/<project>/<session>/<filename>`: chat attachment, protected by project access.

## Backend API Endpoints

Read APIs:

- `GET /api/workspace`
- `GET /api/account`
- `GET /api/runtime`
- `GET /api/openclaw`
- `GET /api/automations`
- `GET /api/home`
- `GET /api/action-library`
- `GET /api/models`
- `GET /api/workbench-contract`
- `GET /api/home-run?run_id=...`
- `GET /api/home-artifact?path=...`
- `GET /api/project-run?project=...&run_id=...`
- `GET /api/project-artifact?project=...&path=...`
- `GET /api/project-config/<project>`
- `GET /api/goal/<project>`
- `GET /api/chat/<project>/<session>`

Write APIs:

- `POST /api/ask/<project>/<session>`
- `POST /api/logout`
- `POST /api/automations/<slug>/run`
- `POST /api/home-actions/<id>/preview`
- `POST /api/home-actions/<id>/run`
- `POST /api/home-artifact/report`
- `POST /api/home-artifact/ask`
- `POST /api/project-config/<project>/import`
- `POST /api/project-actions/<project>/<command>/preview`
- `POST /api/project-actions/<project>/<command>/run`
- `POST /api/sessions/<project>`
- `POST /api/chats`
- `POST /api/session-title/<project>/<session>`
- `POST /api/move-chat/<project>/<session>`
- `POST /api/promote-chat/<project>/<session>`
- `POST /api/chat-artifact/<project>/<session>`
- `POST /api/move-chat-out/<project>/<session>`
- `POST /api/delete-session/<project>/<session>`
- `POST /api/project-title/<project>`
- `POST /api/delete-project/<project>`
- `POST /api/projects`
- `POST /api/profile`
- `POST /api/goal/<project>`

## Storage Structure

Workspace data is file-based under `AIWS_ROOT`:

```text
workspace_root/
  users.json
  config.json
  projects/
    <project>/
      project.json
      aiws.yaml
      goal.json
      sessions/
        <session>/
          session.json
          messages.jsonl
          session.md
          attachments/
          attachments.jsonl
          context_receipts.jsonl
      runs/
        <run_id>/
          run.json
          run.md
          result.json
          stdout.txt
          stderr.txt
          artifacts/
  users/<username>/home/
    runs/
    artifacts/
    files/
  usage/model_usage.jsonl
```

`messages.jsonl` remains the canonical append-friendly chat log. `session.md` is the human-readable archive.

## Data Flow

Project/session chat:

```text
HTTP API -> ui.handle_ask_api -> attachments/extraction -> runner.ask
  -> provider call
  -> context_manifest.build_context_manifest
  -> context_receipts.build_context_receipt
  -> storage.append_message
  -> work_sessions record
```

Home starter action:

```text
HTTP API -> home_workbench.run_action
  -> deterministic parser or artifact writer
  -> contracts.run_contract
  -> user home runs/<run_id>/run.json
  -> user home artifacts/<run_id>/*
```

Project action:

```text
HTTP API -> action_registry.load_config(aiws.yaml)
  -> validate permissions/path scope
  -> execute prompt_recipe/shell/python/file_index/codex_prompt
  -> project runs/<run_id>/run.json
  -> declared artifacts
```

## Model Provider Structure

Provider modules live under `src/aiws/providers/`:

- `ollama.py`: local model server.
- `gemini.py`: Google Gemini BYOK.
- `kimi.py`: Moonshot/Kimi BYOK.
- `openai.py`: OpenAI/Codex BYOK.
- `ernie.py`: Baidu Qianfan BYOK.

Pricing and rough cost estimates live in `src/aiws/costs.py`; UI-facing capability metadata is built by `src/aiws/core/workbench_contracts.py` and `src/aiws/core/model_capabilities.py`.

## File Upload And Extraction

Attachment handling lives in `src/aiws/attachments.py`.

Supported surfaces include text/Markdown, PDF, Office-style documents, images, CSV, XLS, and XLSX. CSV/Excel-style table analysis is deterministic-first via `src/aiws/core/csv_profile.py`; LLMs summarize computed profiles rather than raw spreadsheets when possible.

Risk controls already present:

- Upload size limits.
- Extension validation.
- Secret-like content scanning.
- Context receipt flags for raw text vs computed profile delivery.

## `aiws.yaml` Loading And Execution

`src/aiws/core/action_registry.py` parses `aiws.yaml`, normalizes commands/actions, validates project roots, rejects secret references, and enforces capabilities before shell/Python actions.

Supported action kinds:

- `prompt_recipe`
- `shell`
- `python`
- `file_index`
- `codex_prompt`
- `openclaw_status`

## Current Check Status

Baseline command run during this pass:

```text
source .venv/bin/activate && python -m pytest -q
139 passed
```

Frontend build is expected to be run after UI changes:

```text
cd web && npm run build
```

## Public Deployment Risk Points

Areas to keep locked down for Cloudflare/Tailscale/public-domain access:

- Runtime diagnostics must not expose local absolute paths, shell commands, localhost URLs, or tunnel token details to non-admin/public users.
- `cloudflared` token must not appear in process arguments or logs.
- `/api/openclaw`, `/api/automations`, and local admin links must stay admin-only.
- Attachment and artifact file APIs must keep resolving paths under the workspace/project roots.
- API key values must never be serialized to frontend payloads; only configured/missing is allowed.
- Raw provider errors should remain bounded and should not include secret-bearing request data.

## Productization Gaps

- `web/src/main.jsx` is smaller than before but still too large; the next safe frontend pass should extract Composer, model selector, Home workbench, and Right Inspector.
- The run contract now carries the acceptance shape (`workspace_id`, `session_id`, nested `model`, `context_receipt`, and `steps`), but project and home runs should eventually share one service rather than two call paths.
- Public runtime payloads hide operator details; keep adding tests when new diagnostics surfaces appear.
- Docker remains intentionally planned rather than implemented.
- `aiws.yaml` needs a dedicated schema guide.
- Example workspaces are missing.
- Frontend is still concentrated in `web/src/main.jsx`; incremental component extraction exists but is incomplete.
- Right Inspector and action cards need stricter “real state only” behavior.
- Memory should either be implemented or clearly marked as coming later.
