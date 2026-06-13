/**
 * Curated metadata that enriches the auto-generated API inventory: human
 * groupings of the 31 route domains and per-endpoint detail (summary, response
 * shape, example) for the core endpoints. The inventory stays accurate via the
 * generator; this file adds the prose the generator can't infer.
 */

/** Logical groups for the API Reference nav, in display order. Each lists the
 *  route-file domains it contains. */
export const API_CATEGORIES: { id: string; label: string; domains: string[] }[] = [
  { id: "core", label: "Core", domains: ["workspaces", "chat", "settings", "account", "auth"] },
  { id: "files", label: "Files & data", domains: ["files", "fs", "search", "git"] },
  { id: "ai", label: "AI & runs", domains: ["runs", "attempts", "templates", "providers", "compare", "usage"] },
  { id: "surfaces", label: "Custom UI (surfaces)", domains: ["surface", "surfaceHost"] },
  { id: "automation", label: "Automation", domains: ["actions", "hooks", "schedules", "triggers", "scripts", "terminal"] },
  { id: "knowledge", label: "Knowledge", domains: ["memory", "skills", "mcp"] },
  { id: "ops", label: "Operations", domains: ["health", "reports", "alerts", "marketData", "evalCases"] },
];

/** Description for the one route domain not in any registry. The core +
 *  public route domains' blurbs live ONCE in routes/registry.ts and reach the
 *  docs via the generated DOMAIN_DESCRIPTIONS (see ApiReference.domainBlurb). */
export const DOMAIN_BLURBS: Record<string, string> = {
  health: "Liveness probe, outside the /api auth scope.",
};

/** Per-endpoint curated detail, keyed by `"METHOD /api/path"`. Optional — the
 *  inventory renders fine without it; this adds depth on the core endpoints. */
export interface EndpointDetail {
  summary: string;
  /** Plain-language response shape. */
  response?: string;
  /** A copy-pasteable example (curl / ws). */
  example?: string;
  /** Access note when it differs from the default cookie/local-admin auth. */
  access?: string;
}

export const ENDPOINT_DETAILS: Record<string, EndpointDetail> = {
  "GET /api/workspaces": {
    summary: "List all workspaces the caller can view.",
    response: "Workspace[] — { id, name, rootPath, fileCount, visibility, defaultProvider/Model, … }",
    example: `curl -s localhost:4319/api/workspaces`,
  },
  "POST /api/workspaces": {
    summary: "Create a workspace rooted at a local folder. Optionally scaffold from a starter template.",
    response: "Workspace",
    example: `curl -s -X POST localhost:4319/api/workspaces \\\n  -H 'content-type: application/json' \\\n  -d '{"name":"Notes","rootPath":"/Users/me/notes"}'`,
  },
  "PATCH /api/workspaces/:id": {
    summary: "Update a workspace: name, include/exclude globs, visibility, home view, or its per-workspace model override (defaultProvider/defaultModel).",
    response: "Workspace",
  },
  "POST /api/workspaces/:id/scan": {
    summary: "(Re)scan the root folder → a snapshot (file list + metadata) and refresh the embedding index. Emits an SSE `scan-complete` event.",
  },
  "GET /api/workspaces/:id/snapshot": {
    summary: "The latest stored scan: the file tree, extensions, counts, markdown-cache flags.",
    response: "Snapshot — { files: FileMeta[], … }",
  },
  "GET /api/workspaces/:id/events": {
    summary: "SSE stream of workspace push events (scan-complete, markdown-warmed, embedding-indexed). The UI subscribes to invalidate caches.",
    access: "EventSource; auto-reconnecting on the client.",
  },
  "PUT /api/workspaces/:id/file": {
    summary: "Overwrite an existing data file (csv/tsv/txt/json/md/yaml). 404 if it doesn't exist.",
    access: "Local only.",
  },
  "POST /api/workspaces/:id/file/create": {
    summary: "Create a NEW data file by pasting content. 409 if it already exists; creates parent folders.",
    access: "Local only.",
  },
  "POST /api/chats/:id/messages": {
    summary: "Send a message and stream the assistant reply over SSE. Runs the full pipeline (triage → retrieval → provider) unless mode is 'instant'. Honors the chat's per-workspace model override.",
    response: "SSE: delta / status / sources / done events.",
    access: "Per-message workspace-view check on chat.workspaceId.",
  },
  "GET /api/workspaces/:id/git/status": {
    summary: "Branch + ahead/behind + changed files with status kinds (modified/added/deleted/untracked/renamed/conflicted).",
    response: "{ isRepo, branch, ahead, behind, files: GitFileStatus[] }",
    example: `curl -s localhost:4319/api/workspaces/<id>/git/status`,
  },
  "GET /api/workspaces/:id/git/diff": {
    summary: "Unified diff for one file (working-tree, or staged). Untracked files render as an add-diff. Path is validated to stay inside the repo.",
    response: "{ diff: string }",
  },
  "POST /api/workspaces/:id/git/commit": {
    summary: "Stage the selected paths and commit ONLY those (a pathspec commit). Uses the repo's own git identity.",
    response: "{ ok, sha }",
    access: "Local only + workspace write.",
  },
  "GET /api/workspaces/:id/terminal": {
    summary: "WebSocket → a PTY running $SHELL in the workspace root. server→client: raw output; client→server: JSON { type:'input'|'resize', … }.",
    access: "Local only + workspace write. Refused over the tunnel.",
    example: `const ws = new WebSocket('ws://localhost:4319/api/workspaces/<id>/terminal');\nws.onmessage = e => term.write(e.data);\nws.send(JSON.stringify({ type: 'input', data: 'ls\\r' }));`,
  },
  "POST /api/workspaces/:id/surface/build": {
    summary: "esbuild-bundle the workspace's `.ariadne/surface.tsx` (aliasing @ariadne/surface → the runtime). The sandboxed iframe loads the bundle.",
    response: "{ ok, error? }",
  },
  "POST /api/triggers/:secret": {
    summary: "Fire a workspace run via webhook. The secret in the path IS the authentication — this route is exempt from the cookie gate (start-anchored allowlist).",
    access: "Secret-authenticated; no cookie.",
    example: `curl -s -X POST localhost:4319/api/triggers/<secret> -d '{}'`,
  },
  "PUT /api/settings": {
    summary: "Set the active AI provider + model (the account-global default; workspaces can override theirs).",
  },
  "GET /api/auth/me": {
    summary: "The current account + access context (local/remote). Local (loopback) resolves as the seeded admin with no login.",
    response: "{ account, accessContext }",
  },
};
