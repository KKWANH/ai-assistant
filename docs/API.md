# API — REST surface + provider integration

> All API paths live under `/api`. The SPA at `/` is just the consumer of
> these. Loopback (`127.0.0.1`, `localhost`) skips auth and runs as the
> seeded admin; everything else needs a valid `ariadne_session` cookie.

For the architecture behind these endpoints see `docs/ARCHITECTURE.md`.
For installation see `docs/INSTALL.md`. For the eval harness that exercises
them see `docs/RAG_HARNESS.md`.

---

## Auth

| Method | Path                  | Auth needed | What it does                                          |
|--------|-----------------------|-------------|-------------------------------------------------------|
| POST   | `/api/auth/login`     | No          | `{username, password}` → sets `ariadne_session` cookie |
| POST   | `/api/auth/logout`    | No          | Deletes the session row + clears the cookie           |
| POST   | `/api/auth/reset`     | No          | Recovery — clears the cookie even when invalid        |
| GET    | `/api/auth/me`        | Yes         | `{account, accessContext: "local" \| "remote"}`        |

The reset endpoint exists because a stuck/malformed cookie can otherwise put
the user in a 401 loop with no client-side way out — see commit `a930275`.

### Cookie

`ariadne_session` — `HttpOnly`, `SameSite=Lax`, `Secure`, signed with the
per-install `cookie_secret` (stored in `settings` table, survives restarts).
Default lifetime: 30 days.

## Workspaces

| Method | Path                                       | What                                                              |
|--------|--------------------------------------------|-------------------------------------------------------------------|
| GET    | `/api/workspaces`                          | List workspaces the caller can view                               |
| POST   | `/api/workspaces`                          | Create — `{name, rootPath, starter?, include?, exclude?}`         |
| GET    | `/api/workspaces/:id`                      | Single workspace metadata (read-only — public visibility OK)      |
| PATCH  | `/api/workspaces/:id`                      | Rename / re-glob / change visibility (owner/admin only)           |
| DELETE | `/api/workspaces/:id`                      | Delete — **local only**                                           |
| POST   | `/api/workspaces/:id/scan`                 | Re-scan file tree                                                 |
| GET    | `/api/workspaces/:id/snapshot`             | Latest scan snapshot (read mode)                                  |
| GET    | `/api/workspaces/:id/search?q=…&topK=N`    | Hybrid retrieval over the workspace — returns chunks + strategy + warnings |
| GET    | `/api/workspaces/:id/file?path=…`          | Read one file's content (workspace-root-guarded, read mode)       |
| POST   | `/api/workspaces/:id/file/stage`           | Stage an edit — returns `runId` for the staged-diff page          |
| GET    | `/api/workspaces/:id/history`              | Git history of `.ariadne/` (apply commits annotated)              |
| GET    | `/api/workspaces/:id/history/:sha`         | Single commit's per-file diff                                     |
| POST   | `/api/workspaces/:id/history/rewind`       | Restore the workspace to the state before `{sha}` (apply commits only) |

### Workspace search response shape (the one you'll consume most)

```json
{
  "query": "segtree",
  "chunks": [
    { "path": "lib/segtree.c", "chunk": "…", "score": 0.0167 }
  ],
  "strategy": "hybrid",
  "indexed": true,
  "embeddingProvider": "ollama:nomic-embed-text:latest",
  "candidateCount": 12,
  "warnings": [],
  "fileCount": 7
}
```

`strategy` ∈ `"hybrid" | "semantic" | "keyword+symbol" | "keyword" | "none"`.
`indexed` is **`hasEmbeddingIndex`**, NOT `chunks.length > 0` — the
distinction was an early bug, see commit `3942024`.

## Surface (workspace-scoped React dashboards)

| Method | Path                                       | What                                                  |
|--------|--------------------------------------------|-------------------------------------------------------|
| GET    | `/api/workspaces/:id/surface`              | `{state, source}` — surface.tsx state + source        |
| PUT    | `/api/workspaces/:id/surface`              | Save surface.tsx — **local only**                     |
| POST   | `/api/workspaces/:id/surface/build`        | Bundle via esbuild → `surface-dist/bundle.js`         |

The compiled bundle is served back at `/surface/:workspaceId/bundle.js` and
loaded by `SurfaceView` into a sandboxed iframe.

## Actions

| Method | Path                                       | What                                                  |
|--------|--------------------------------------------|-------------------------------------------------------|
| GET    | `/api/workspaces/:id/actions`              | Workspace's `.ariadne/actions.yaml` parsed            |
| PUT    | `/api/workspaces/:id/actions`              | Save the yaml — **local only**                        |
| GET    | `/api/workspaces/:id/action-defs`          | Available action defs (built-in templates + workspace custom) |

Action block types: `ask_ai`, `web_analysis`, `run_script`, `read_file`,
`write_file`, `edit_file`, `run_tests`. See `apps/server/src/runs/actionEngine.ts`.

## Runs (action / template executions)

| Method | Path                                       | What                                                  |
|--------|--------------------------------------------|-------------------------------------------------------|
| GET    | `/api/runs?workspaceId=…`                  | List runs for a workspace                             |
| POST   | `/api/runs`                                | Start a run — `{workspaceId, templateId, input}`      |
| GET    | `/api/runs/:id`                            | Full run row + block results                          |
| GET    | `/api/runs/:id/context`                    | Candidate files + selected files                      |
| GET    | `/api/runs/:id/brief`                      | The brief output (when run is template-kind)          |
| GET    | `/api/runs/:id/evidence`                   | Claims + evidence pack                                |
| GET    | `/api/runs/:id/diff`                       | Diff between this and the previous run                |
| GET    | `/api/runs/:runId/staged`                  | Staged manifest (when run produced `edit_file` blocks) |

## Chat

| Method | Path                                       | What                                                  |
|--------|--------------------------------------------|-------------------------------------------------------|
| GET    | `/api/chats`                               | List chats                                            |
| POST   | `/api/chats`                               | Create chat — `{workspaceId?}`                        |
| GET    | `/api/chats/:id`                           | Messages + chat metadata                              |
| POST   | `/api/chats/:id/messages`                  | Send a user message (SSE stream of deltas back)       |
| POST   | `/api/chats/:id/messages/:msgId/regenerate`| Regenerate from a specific user message               |
| POST   | `/api/chats/:id/messages/:msgId/edit`     | Edit a user message (old version archived)            |
| POST   | `/api/chats/:id/stop`                      | Abort the active generation                           |
| GET    | `/api/chats/:id/active`                    | Reconnect to an in-flight generation                  |

Assistant messages carry `provider` + `model` columns so the UI's footer can
say "answered by `anthropic / claude-opus-4.5-…`" — useful when mixing models
in one chat. See commit `54fe238`.

## Skills (reusable prompt snippets)

| Method | Path                  | What                                                  |
|--------|-----------------------|-------------------------------------------------------|
| GET    | `/api/skills`         | User's skills + 6 built-ins                           |
| POST   | `/api/skills`         | Create — `{name, prompt, description?, variables?}`   |
| PATCH  | `/api/skills/:id`     | Edit (rejects `builtin:*` ids)                        |
| DELETE | `/api/skills/:id`     | Delete (same)                                         |

Skills support `{variable}` placeholders — the picker prompts for values
before insert. See commit `9702c07`.

## Attempts (multi-attempt for one chat)

| Method | Path                              | What                                          |
|--------|-----------------------------------|-----------------------------------------------|
| GET    | `/api/chats/:id/attempts`         | List attempts for a chat                      |
| POST   | `/api/chats/:id/attempts`         | Start a new attempt                           |
| GET    | `/api/attempts/:id`               | Single attempt + its staged manifest          |
| POST   | `/api/attempts/:id/abandon`       | Drop without applying                         |

## Schedules (cron-style action runs)

| Method | Path                  | What                                              |
|--------|-----------------------|---------------------------------------------------|
| GET    | `/api/schedules`      | List schedules                                    |
| POST   | `/api/schedules`      | Create — `{workspaceId, actionId, frequency}`     |
| PATCH  | `/api/schedules/:id`  | Edit frequency / toggle enabled                   |
| DELETE | `/api/schedules/:id`  |                                                   |

Frequencies are `hourly`/`daily`/`weekly`/`monthly` — true cron-style strings
are NOT supported in v0.1. Scheduler ticks every 60s.

## Reports (user feedback → maintainer queue)

| Method | Path                       | What                                          |
|--------|----------------------------|-----------------------------------------------|
| GET    | `/api/reports`             | Admin view of the feedback queue              |
| POST   | `/api/reports`             | Submit user feedback (any account)            |
| GET    | `/api/reports/:id`         | Single report + LLM triage                    |
| POST   | `/api/reports/:id/decision`| Admin decision (file as GitHub issue / dismiss) |

This is the **feedback** queue. It is NOT the runs archive — those live under
`/api/runs`. See `docs/RAG_HARNESS.md` for the early naming bug that conflated
the two.

## Providers

| Method | Path                        | What                                          |
|--------|-----------------------------|-----------------------------------------------|
| GET    | `/api/providers/status`     | Per-provider `{id, configured, reachable}`    |

`configured` = the relevant env var is set. `reachable` = a probe call (mainly
for Ollama, which can be installed but stopped).

## Settings

| Method | Path             | What                                  |
|--------|------------------|---------------------------------------|
| GET    | `/api/settings`  | Active provider/model + UI flags      |
| PATCH  | `/api/settings`  | Switch provider / model               |

The settings UI is for per-install choices — **API keys are env vars, not DB**
(see `docs/INSTALL.md` § 5).

## File-system browser (for the workspace picker)

| Method | Path                          | What                                          |
|--------|-------------------------------|-----------------------------------------------|
| GET    | `/api/fs/list?path=…`         | Directory listing (local only)                |

## Health

| Method | Path        | What                                          |
|--------|-------------|-----------------------------------------------|
| GET    | `/healthz`  | `{ok: true, uptimeMs}` — outside `/api`       |

---

## Provider integration — bring your own keys

Ariadne supports 6 providers. The active provider/model are stored in the
`settings` table (one global pair, per install). API keys come from the
process env, never from the DB.

| Provider   | Env var                | Notes                                          |
|------------|------------------------|------------------------------------------------|
| Anthropic  | `ANTHROPIC_API_KEY`    | Claude family                                  |
| OpenAI     | `OPENAI_API_KEY`       | GPT family + `text-embedding-3-small/large`    |
| Gemini     | `GEMINI_API_KEY`       | Google AI Studio key                           |
| Moonshot   | `MOONSHOT_API_KEY`     | OpenAI-compatible endpoint                     |
| Ollama     | (none)                 | Looks for `OLLAMA_BASE_URL`, defaults to `http://127.0.0.1:11434` |
| Mock       | (none)                 | Synthetic responses — used by tests / no-key onboarding |

Set the env vars in your shell rc, restart the supervisor, then in the UI
(Settings → Provider) switch to the one you want. The settings UI greys out
providers that aren't `configured`.

### Embedding provider (for RAG)

Picked automatically — `OPENAI_API_KEY` wins if set, otherwise Ollama if
reachable, otherwise no semantic index (keyword + symbol fallback). The
retriever surfaces this honestly in the `/search` response's `embeddingProvider`
field.

To force a re-embed after switching providers:

```bash
# In code; no UI yet for this
import { resetWorkspaceEmbeddings } from "apps/server/src/services/retrieval";
resetWorkspaceEmbeddings("<workspace-id>");
```

The incremental indexer (commit `a7060e3`) handles drift automatically on the
next scan — provider mismatch shows up in the search response's `warnings`.

---

## Calling the API from outside the SPA

```bash
# Log in (remote)
curl -X POST https://your-name.kwanho.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"…","password":"…"}' \
  -c cookies.txt

# Now any other call
curl -s https://your-name.kwanho.dev/api/workspaces -b cookies.txt | jq

# Workspace search
curl -s "https://your-name.kwanho.dev/api/workspaces/<id>/search?q=topic&topK=10" \
  -b cookies.txt | jq

# Stage a file edit
curl -X POST "https://your-name.kwanho.dev/api/workspaces/<id>/file/stage" \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"path":"notes.md","content":"updated body\n"}'
# Response: {"runId":"2026-05-25-001","added":3,"removed":1}
```

Write actions (file edits, deletes, scans) are **local only** when reached via
the tunnel — they return 403 `Forbidden` from remote. Same flow works on
loopback without auth.

## Rate limits / quotas

None enforced server-side in v0.1. Provider-side limits (Anthropic, OpenAI,
etc.) apply naturally — Ariadne surfaces those errors verbatim in the chat
UI's stream-error path.

---

## Versioning

Pre-1.0; the API shape can change. The `/healthz` response will gain a
`version` field when v1.0 freezes the surface.
