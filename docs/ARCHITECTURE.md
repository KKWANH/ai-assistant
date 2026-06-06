# Ariadne — Architecture

The current architecture of Ariadne. Pairs with
`PERFORMANCE_ARCHITECTURE.md` (the speed contract), and
`DESIGN_GUIDELINE.md` (the visual language). `README.md` is the user-facing
overview; this is the engineering reference.

## System diagram

```
                        ┌──────────────────────────────┐
                        │  Browser  ·  any device      │
                        └──────────────┬───────────────┘
                                       │ https
                  ┌────────────────────▼─────────────────────┐
                  │   Cloudflare Tunnel                       │
                  │   ai.kwanho.dev  ·  or *.trycloudflare    │
                  └────────────────────┬─────────────────────┘
                                       │ loopback only
        ┌──────────────────────────────▼───────────────────────────────────┐
        │  Your machine                                                     │
        │                                                                   │
        │  ┌────────────────────────────────────────────────────────────┐  │
        │  │  Supervisor  (apps/admin)                                  │  │
        │  │  · log rotation · process watch · admin dashboard (7459)   │  │
        │  └──────┬─────────────────────────┬───────────────────────────┘  │
        │         │spawns                  │spawns                          │
        │  ┌──────▼───────────┐    ┌───────▼───────────────┐                │
        │  │  cloudflared     │    │  Ariadne server (4319)│                │
        │  │  (tunnel proc.)  │    │  Fastify · TypeScript  │                │
        │  └──────────────────┘    └───┬───────────────────┘                │
        │                              │                                    │
        │                              ├─ SQLite  data/ariadne.db           │
        │                              ├─ Local folders  <workspaceRoot>    │
        │                              │     ├─ .ariadne/  (per-workspace)  │
        │                              │     │   runs / snapshots / claims  │
        │                              │     │   evidence / actions.yaml    │
        │                              │     │   surface.tsx OR             │
        │                              │     │     surface/ (AH folder form)│
        │                              │     │   surface-dist/bundle.js     │
        │                              │     └─ user files (read-only       │
        │                              │                   except staged    │
        │                              │                   diff applies)    │
        │                              ├─ AI providers (your API keys)      │
        │                              │     · Anthropic · OpenAI · Gemini  │
        │                              │     · Moonshot/Kimi · Ollama · vLLM│
        │                              │     · Mock (no key)                │
        │                              └─ MCP stdio servers (lazy spawn)    │
        │                                                                   │
        │  React SPA bundled by Vite, served from server                    │
        └───────────────────────────────────────────────────────────────────┘
```

Loopback (`localhost`) and remote (tunnel) requests are split: tunnel
requests can read + chat + run pre-approved actions, but **cannot edit
surfaces, scripts, hooks, or MCP servers**. The gate uses the
`cf-connecting-ip` header the tunnel always adds — spoofed `Host`
headers can't cross it.

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

A workspace may carry a user-authored dashboard. Two layouts supported:

| Layout | Entry path | Use when |
|---|---|---|
| **Single-file** | `.ariadne/surface.tsx` | Small dashboards, one component |
| **Folder** (AH.3) | `.ariadne/surface/index.tsx` | Large dashboards; split into types / yaml / utils / primitives / sections / index. Bundled the same way — esbuild follows imports. |

```
.ariadne/surface/                ← AH.3 folder form (preferred when growing)
├── index.tsx                    ← entry; default export = the page
├── types.ts                     ← shared interfaces
├── yaml.ts                      ← inline parser (if YAML data)
├── utils.ts                     ← formatters / FX / heuristics
├── primitives.tsx               ← Section / KpiCard / Table / Badge / …
├── sections.tsx                 ← page-level sections
└── …any other files you want imported by index.tsx
```

Build pipeline (`apps/server/src/services/surfaceBuild.ts`):

1. Esbuild reads `.ariadne/surface/index.tsx` (or `surface.tsx` fallback).
2. Bundles with `@ariadne/surface` aliased to `apps/server/src/surface/runtime.tsx`
   — React, hooks (`useState`, `useEffect`, `useMemo`, …), `useAriadne()`
   SDK, chart primitives (`LineChart`, `BarChart`, `PieChart`).
3. Outputs single IIFE → `.ariadne/surface-dist/bundle.js`.
4. Web app renders it in a `sandbox="allow-scripts"` iframe.
5. Iframe ↔ parent talks via postMessage SDK: `readCsv`, `readText`,
   `listFiles`, `runTemplate`, `getQuotes`, `getFxRates`. Themed from the
   shared `THEME_TOKENS`.

Reference implementation: the Portfolio v2 surface at
`data/portfolio/.ariadne/surface/*` (gitignored; per
`docs/PORTFOLIO_STARTER_V2.md`). 6 files, bundle ~1.1 MB, brokerage-app
shape (action strip + net-worth + 4-chart allocation grid + accounts
table + sortable positions table + cash & manual assets + analysis
links).

## Supervisor (apps/admin)

Started by `ops/ariadne.sh`. Rotates logs on every start; spawns and watches the
server and `cloudflared`; restarts on crash with exponential backoff; serves a
loopback-only admin dashboard with live status, log tail, and an error analyzer.
