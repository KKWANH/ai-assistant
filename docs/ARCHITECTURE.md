# Ariadne — Architecture & Contract (v0.1)

This is the build contract shared by the backend, frontend, and supervisor.
It implements `PRODUCT_PLAN.md` + `DESIGN_GUIDELINE.md`.

## Deployment model

Ariadne is **local-first**: the server runs on the user's Mac and reads their
local folders. To reach it from other devices, a **Cloudflare Quick Tunnel**
(`cloudflared tunnel --url http://localhost:<port>`) exposes it on a temporary
`*.trycloudflare.com` domain — no Cloudflare account or DNS needed.

```
 other device ──▶ https://<random>.trycloudflare.com
                        │  (cloudflared quick tunnel)
                        ▼
              Ariadne server  localhost:4319   ── serves API + built SPA
                        ▲
              supervisor (apps/admin) monitors & restarts it
              admin dashboard  localhost:7459   (loopback only)
```

## Monorepo layout

```
package.json            npm workspaces root
tsconfig.base.json
packages/shared/         @ariadne/shared — types, zod schemas, config
apps/server/             @ariadne/server — Fastify API + static SPA host
apps/web/                @ariadne/web — React + Vite + Tailwind SPA
apps/admin/              @ariadne/admin — supervisor + admin dashboard
ops/                     ariadne control script + zshrc alias installer
logs/  run/  data/       runtime state (gitignored)
```

Ports: server `4319`, admin dashboard `7459` (override via `ARIADNE_PORT`,
`ARIADNE_ADMIN_PORT`). All TS runs through `tsx` — no build step except the web SPA.

## Storage

- Central registry: SQLite at `data/ariadne.db` via Node's built-in
  `node:sqlite` (no native module to compile). Holds workspaces, runs,
  claims, settings, and an FTS5 file-metadata index.
- Per-workspace portable folder: `<workspaceRoot>/.ariadne/` with
  `runs/ snapshots/ artifacts/ evidence/ workspace.yaml` — human-readable,
  copyable (PRODUCT_PLAN §10).
- Security (PRODUCT_PLAN §12): the app only ever **writes** inside
  `<workspaceRoot>/.ariadne/`; a path guard rejects writes elsewhere. No shell
  execution. Sensitive patterns excluded by default.

## REST API (server, prefix `/api`)

All JSON. Errors: `{ "error": string, "detail"?: string }` with 4xx/5xx.

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET  | `/healthz` | — | `{ ok, uptime }` |
| GET  | `/api/workspaces` | — | `Workspace[]` |
| POST | `/api/workspaces` | `CreateWorkspaceInput` | `Workspace` |
| GET  | `/api/workspaces/:id` | — | `Workspace` |
| PATCH| `/api/workspaces/:id` | `UpdateWorkspaceInput` | `Workspace` |
| POST | `/api/workspaces/:id/scan` | — | `Snapshot` |
| GET  | `/api/workspaces/:id/snapshot` | — | `Snapshot` |
| GET  | `/api/templates` | — | `Template[]` |
| GET  | `/api/templates/:id` | — | `Template` |
| GET  | `/api/runs` | `?workspaceId=` | `Run[]` |
| POST | `/api/runs` | `CreateRunInput` | `Run` (status `context_pick`) |
| GET  | `/api/runs/:id` | — | `Run` |
| GET  | `/api/runs/:id/context` | — | `ContextPick` |
| POST | `/api/runs/:id/context` | `ConfirmContextInput` | `Run` (status `generating`) |
| GET  | `/api/runs/:id/brief` | — | `{ markdown: string }` |
| GET  | `/api/runs/:id/evidence` | — | `EvidencePack` |
| GET  | `/api/runs/:id/diff` | — | `RunDiff` |
| GET  | `/api/settings` | — | `Settings` |
| PUT  | `/api/settings` | `UpdateSettingsInput` | `Settings` |

Types and zod schemas live in `@ariadne/shared`. Import them — do not redeclare.

## Run lifecycle

A run is gated in two user steps (PRODUCT_PLAN §5, DESIGN_GUIDELINE §3.5):

1. `POST /api/runs` → server scans the workspace, builds the manifest, asks the
   provider to pick candidate files from manifest metadata only. Run rests at
   status `context_pick`. Trace records `scan, manifest, candidate_select`.
2. User reviews candidates in the Context Pick screen, then
   `POST /api/runs/:id/context`. Server does the focused read of approved files,
   generates the Brief, extracts claims, maps evidence, splits unsupported
   claims, and (if a previous run exists) computes the diff. Status → `completed`.
   Artifacts are written into `.ariadne/`.

Run execution is async; the frontend polls `GET /api/runs/:id` (~1s) and renders
the phase-based progress from `run.trace`.

## Provider interface

`apps/server/src/providers/` exposes one interface used by all run steps:

```ts
interface AiProvider {
  id: ProviderId;
  complete(req: { system: string; prompt: string; json?: boolean }):
    Promise<{ text: string }>;
}
```

Adapters: `anthropic` (@anthropic-ai/sdk), `openai` (openai SDK),
`moonshot` (openai SDK, baseURL `https://api.moonshot.ai/v1`),
`ollama` (openai SDK, baseURL `http://localhost:11434/v1`),
`gemini` (@google/genai), `mock` (canned structured output, default — lets the
loop run with no API key). The active provider comes from settings / env.

## Supervisor (apps/admin)

Started by `ops/ariadne.sh start` as a backgrounded daemon. It:

- rotates logs on every start: moves `logs/<name>.log` →
  `logs/archive/<name>-<timestamp>.log`, opens a fresh file;
- spawns and pipes to logs: the Ariadne server, and `cloudflared`;
- captures the `trycloudflare.com` URL from cloudflared output →
  `run/tunnel-url.txt`;
- health-checks `GET /healthz`; on crash/unhealthy, restarts with exponential
  backoff and increments a restart counter;
- serves the **admin dashboard** on `127.0.0.1:7459` (loopback only): live
  status, restart history, log tail, and an error analyzer that scans logs,
  groups errors, and prints plain-language diagnoses.

`ariadne.sh` verbs: `start | stop | restart | status | logs | admin`.
`ops/install-aliases.sh` registers a managed block in `~/.zshrc`.
