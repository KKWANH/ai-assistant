# Ariadne — Architecture

The current architecture of Ariadne. Pairs with `PRODUCT_PLAN.md` (the vision)
and `DESIGN_GUIDELINE.md` (the visual language). `README.md` is the user-facing
overview; this is the engineering reference.

## Monorepo

```
package.json            npm workspaces root
packages/shared/        @ariadne/shared — types, zod schemas, config, theme tokens, pricing
apps/server/            @ariadne/server — Fastify API + Gasp Filter + evidence/chat/agent + SPA host
apps/web/               @ariadne/web — React + Vite + Tailwind v4 SPA
apps/admin/             @ariadne/admin — supervisor + loopback admin dashboard
ops/                    ariadne control script, tunnel setup, zshrc installer
logs/  run/  data/      runtime state (gitignored)
```

All TypeScript runs through `tsx` — no build step except the web SPA (Vite).
Ports: server `4319`, admin dashboard `7459`.

## Deployment model

Ariadne is **local-first**: the server runs on the user's machine and reads
local folders. A Cloudflare Tunnel exposes it to other devices:

- **Quick tunnel** (default) — `cloudflared tunnel --url …` → an ephemeral
  `*.trycloudflare.com` URL, zero setup.
- **Named tunnel** — `ops/setup-tunnel.sh <hostname>` binds a stable custom
  domain (e.g. `ai.kwanho.dev`). The supervisor then runs
  `cloudflared tunnel run`. Selected by `ARIADNE_TUNNEL_NAME` /
  `ARIADNE_TUNNEL_HOSTNAME` in `.env`.

The server cannot run on stateless edge platforms — it needs the filesystem,
SQLite, local models, and child processes. The tunnel-to-local-machine is the
deployment model.

## Storage

- Central registry: SQLite at `data/ariadne.db` via Node's built-in
  `node:sqlite`. Tables: `workspaces`, `snapshots`, `runs`, `claims`, `settings`,
  `accounts`, `sessions`, `usage_events`, `chats`, `chat_messages`, FTS index.
  Migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, guarded `ALTER`).
- Per-workspace portable folder: `<workspaceRoot>/.ariadne/` —
  `runs/ snapshots/ artifacts/ evidence/ scripts/ surface-dist/`, plus
  `surface.tsx`, `actions.yaml`, `workspace.yaml`. Human-readable, copyable.
- Path guard: the app only ever writes inside `<workspaceRoot>/.ariadne/`.

## Auth & access

- DB-backed `accounts` (scrypt-hashed) + `sessions`; signed httpOnly cookie.
- An `onRequest` hook protects `/api/*`. **Access context** is derived per
  request: a Cloudflare-tunnelled request (carries `cf-connecting-ip`) or a
  non-loopback host → `remote`; otherwise `local`.
  - `local` → resolved as the admin account, no login.
  - `remote` → a valid session is required.
- Workspaces have `visibility` (`private` / `public`); accounts have a `mode`
  (`standard` / `simple`) and a `locale`. Script/surface/actions editing is
  local-only; remote may run/view.

## REST API (prefix `/api`, JSON; SSE for chat)

Grouped by area — workspaces, snapshots, templates, runs (the
scan → context-pick → brief → evidence → diff lifecycle), evidence, settings,
providers (live reachability), usage, auth, accounts, filesystem browse,
scripts, actions, surface (CRUD + esbuild build), search, and chat. Types and
zod schemas live in `@ariadne/shared`.

**Chat** streams Server-Sent Events from `POST /api/chats/:id/messages` —
`user_message`, `status`, `delta`, `agent_plan`, `agent_step`, `done`, `error`.

## Run lifecycle

Gated in two user steps: `POST /api/runs` scans the workspace, builds a
manifest, and asks the provider to pick candidate files (the **Gasp Filter** —
staged, non-vector context selection). The run rests at `context_pick`. After
the user approves, `POST /api/runs/:id/context` does the focused read, generates
the brief, extracts claims, maps evidence, splits unsupported claims, and
computes the re-run diff. Artifacts are written to `.ariadne/`.

## AI providers

`apps/server/src/providers/` exposes one interface used by every AI step:
`complete`, `completeStream` (token streaming), and optional
`completeWithImages` (vision). Adapters: `anthropic`, `openai`, `moonshot` and
`ollama` (OpenAI-compatible), `gemini`, and `mock` (the default — canned but
schema-correct, so the whole product runs with no API key). A metering wrapper
records token usage and cost per call.

## Agent (plan-and-execute)

Opt-in chat **agent mode** (`services/agent.ts`): the provider plans a task into
steps, executes tools (`web_search`, `read_file`, `list_files`,
`analyze_image`, `run_template`, `reason`, plus a workspace's custom
`actions.yaml` entries), re-plans as results arrive, and synthesises a final
streamed answer. Plan + step state stream live to the UI.

## Custom surfaces

A workspace may carry a user-authored `.ariadne/surface.tsx`. The server bundles
it with esbuild; the web app renders it in a `sandbox="allow-scripts"` iframe.
The surface talks to the authenticated parent via a postMessage SDK (read files,
CSV, run templates, …). The iframe is themed from the shared `THEME_TOKENS`.

## Supervisor (apps/admin)

Started by `ops/ariadne.sh`. Rotates logs on every start; spawns and watches the
server and `cloudflared`; restarts on crash with exponential backoff; serves a
loopback-only admin dashboard with live status, log tail, and an error analyzer.
