/**
 * The core route registry — "register, don't hardcode", applied to the backend.
 *
 * index.ts no longer names 28 route modules one by one; it iterates CORE_ROUTES.
 * Adding an API route is now: write `routes/<domain>.ts`, then append ONE entry
 * here. The `domain` + `description` also feed the developer docs (the API
 * inventory generator reads them), so a new domain is documented automatically.
 *
 * Scope: these all register under the `/api` prefix INSIDE the authenticated
 * scope (the auth onRequest hook runs first). Routes that must live outside that
 * scope — `health` (no auth) and `surfaceHost` (the unauthenticated sandbox
 * shell) — are registered explicitly in index.ts and are intentionally NOT here.
 */
import type { FastifyInstance } from "fastify";

import { authRoutes } from "./auth.js";
import { workspaceRoutes } from "./workspaces.js";
import { templateRoutes } from "./templates.js";
import { runRoutes } from "./runs.js";
import { settingsRoutes } from "./settings.js";
import { fsRoutes } from "./fs.js";
import { usageRoutes } from "./usage.js";
import { scriptRoutes } from "./scripts.js";
import { searchRoutes } from "./search.js";
import { chatRoutes } from "./chat.js";
import { compareRoutes } from "./compare.js";
import { providerRoutes } from "./providers.js";
import { accountRoutes } from "./account.js";
import { surfaceRoutes } from "./surface.js";
import { gitRoutes } from "./git.js";
import { terminalRoutes } from "./terminal.js";
import { actionRoutes } from "./actions.js";
import { triggerRoutes } from "./triggers.js";
import { alertRoutes } from "./alerts.js";
import { reportRoutes } from "./reports.js";
import { evalCaseRoutes } from "./evalCases.js";
import { memoryRoutes } from "./memory.js";
import { mcpRoutes } from "./mcp.js";
import { hooksRoutes } from "./hooks.js";
import { marketDataRoutes } from "./marketData.js";
import { filesRoutes } from "./files.js";
import { skillRoutes } from "./skills.js";
import { scheduleRoutes } from "./schedules.js";
import { attemptRoutes } from "./attempts.js";
import { surfaceHostRoutes } from "./surfaceHost.js";

export interface RouteModule {
  /** The route-file domain, e.g. "workspaces" — also the API Reference group. */
  domain: string;
  /** One line on what this domain's endpoints do (source of truth for the docs). */
  description: string;
  /** The Fastify plugin that registers the endpoints. */
  register: (app: FastifyInstance) => Promise<void>;
}

export const CORE_ROUTES: RouteModule[] = [
  { domain: "auth", description: "Login / logout / session — and the local-vs-remote access model (loopback = admin).", register: authRoutes },
  { domain: "workspaces", description: "Create, scan, configure, and snapshot workspaces — the folder-rooted unit everything hangs off.", register: workspaceRoutes },
  { domain: "templates", description: "Run templates — turn files into a structured output.", register: templateRoutes },
  { domain: "runs", description: "Template/agent runs — context pick, brief, evidence, staged diff, apply, and history rewind.", register: runRoutes },
  { domain: "settings", description: "The active AI provider + model and other server-wide settings.", register: settingsRoutes },
  { domain: "fs", description: "Browse the host filesystem (the folder picker when creating a workspace). Local-only.", register: fsRoutes },
  { domain: "usage", description: "Token usage + per-account limits.", register: usageRoutes },
  { domain: "scripts", description: "Workspace scripts in .ariadne/scripts/ — list, read, run.", register: scriptRoutes },
  { domain: "search", description: "RAG search over a workspace's indexed chunks; cross-workspace content search.", register: searchRoutes },
  { domain: "chat", description: "Conversations + streaming assistant replies (SSE). The send pipeline: triage → retrieval → provider → metering.", register: chatRoutes },
  { domain: "compare", description: "Run one prompt against N models concurrently (cross-vendor compare).", register: compareRoutes },
  { domain: "providers", description: "Configured AI providers and their reachability (keys, local models).", register: providerRoutes },
  { domain: "account", description: "The signed-in account: profile, locale, UI mode (simple/standard), saved context.", register: accountRoutes },
  { domain: "surface", description: "User-authored custom screens (.ariadne/surface.tsx) — bundle, build, RAG, ask, persisted state.", register: surfaceRoutes },
  { domain: "git", description: "The workspace's own git repo: status, per-file diff, and selective commit. Local-only commit.", register: gitRoutes },
  { domain: "terminal", description: "A real PTY shell in the workspace root over a WebSocket. Local-only.", register: terminalRoutes },
  { domain: "actions", description: "Workspace actions.yaml — tools the agent planner may use (run_script, read_file, …).", register: actionRoutes },
  { domain: "triggers", description: "Event webhooks — POST /api/triggers/:secret fires a run; the secret IS the auth.", register: triggerRoutes },
  { domain: "alerts", description: "In-app notifications (the bell).", register: alertRoutes },
  { domain: "reports", description: "User-filed problem reports + the admin review queue.", register: reportRoutes },
  { domain: "evalCases", description: "RAG eval cases for the retrieval harness.", register: evalCaseRoutes },
  { domain: "memory", description: "Per-workspace agent memory — facts injected into context.", register: memoryRoutes },
  { domain: "mcp", description: "Model Context Protocol servers — register external tools the agent can call.", register: mcpRoutes },
  { domain: "hooks", description: "Per-workspace commands that fire on events (staged_apply, post_scan, memory_added).", register: hooksRoutes },
  { domain: "marketData", description: "Market-data helpers used by the portfolio example project.", register: marketDataRoutes },
  { domain: "files", description: "Read workspace files + binary-document previews (markdown cache, PDF page images).", register: filesRoutes },
  { domain: "skills", description: "Reusable skill definitions surfaced to the agent + the composer.", register: skillRoutes },
  { domain: "schedules", description: "Scheduled runs (the scheduler ticks every 60s) — list, create, run-now.", register: scheduleRoutes },
  { domain: "attempts", description: "Parallel attempts of a run (fan-out) + their diffs.", register: attemptRoutes },
];

/** Routes registered OUTSIDE the /api auth scope — no cookie, no auth hook. Add
 *  an unauthenticated route (a webhook receiver, OAuth callback, a `.well-known`
 *  endpoint, an embed host) by appending here; index.ts iterates this after the
 *  /api scope and before the SPA static fallback. (`health` stays separate — it
 *  registers first, before /api, as an always-up liveness probe.) */
export const PUBLIC_ROUTES: RouteModule[] = [
  { domain: "surfaceHost", description: "Serves the sandboxed surface host page + esbuild bundle the iframe loads.", register: surfaceHostRoutes },
];
