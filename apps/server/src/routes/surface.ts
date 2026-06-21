/**
 * Surface routes — registered INSIDE the /api prefix (authenticated).
 *
 * GET  /api/workspaces/:id/surface              → { state: SurfaceState, source: string }
 * PUT  /api/workspaces/:id/surface              → save source (LOCAL only)
 * POST /api/workspaces/:id/surface/build        → build bundle, return { ok, error }
 * GET  /api/workspaces/:id/surface/folder       → list files in .ariadne/surface/ (AK)
 * PUT  /api/workspaces/:id/surface/folder/file  → save a single file in .ariadne/surface/ (AK)
 * POST /api/workspaces/:id/surface/folder/file  → create a new file in .ariadne/surface/ (AL3)
 * DELETE /api/workspaces/:id/surface/folder/file → delete a file in .ariadne/surface/ (AL3)
 * GET  /api/workspaces/:id/file?path=<rel>      → { content: string } of a text file in workspace root
 */

import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { SurfacePutSchema } from "@ariadne/shared";
import type { SurfaceState, Run } from "@ariadne/shared";
import { safeResolveUnderRoot } from "../security/pathGuard.js";
import {
  ensureAriadneFolder,
  readSurface,
  writeSurface,
  surfaceBundlePath,
  surfaceTsxPath,
} from "../ariadneFolder.js";
import { buildSurface } from "../services/surfaceBuild.js";
import { stageEdit, applyStagedEdits } from "../services/stagedEdits.js";
import { dbInsertRun, dbListRuns, dbGetLatestSnapshot } from "../db/repo.js";
import { retrieveRelevantChunks } from "../services/retrieval.js";
import { makeDateRunId } from "../runs/engine.js";
import { requireWorkspace, rejectRemoteAccess, isOwnerOrAdmin } from "./workspaceGuard.js";
import { checkSensitive } from "../security/sensitive.js";
import { getActiveSettings } from "../config.js";
import { getProvider } from "../providers/index.js";
import { resolveOllamaModel } from "../services/ollamaModels.js";

function getSurfaceState(workspaceRoot: string): SurfaceState {
  const tsxPath = surfaceTsxPath(workspaceRoot);
  const bundlePath = surfaceBundlePath(workspaceRoot);

  const exists = fs.existsSync(tsxPath);
  const built = fs.existsSync(bundlePath);

  // Read build error from a sidecar file if present
  const errorPath = bundlePath + ".error";
  const buildError = fs.existsSync(errorPath)
    ? fs.readFileSync(errorPath, "utf-8").trim() || null
    : null;

  const updatedAt = exists
    ? fs.statSync(tsxPath).mtime.toISOString()
    : null;

  return { exists, built, buildError, updatedAt };
}

export async function surfaceRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/workspaces/:id/surface
  app.get<{ Params: { id: string } }>("/workspaces/:id/surface", async (req, reply) => {
    const workspace = await requireWorkspace(req.params.id, req, reply, "read");
    if (!workspace) return;

    ensureAriadneFolder(workspace.rootPath);
    const state = getSurfaceState(workspace.rootPath);
    const source = readSurface(workspace.rootPath) ?? "";
    return reply.send({ state, source });
  });

  // POST /api/workspaces/:id/surface/ask — one-shot completion for a surface's
  // useAriadne().ask(prompt). Read-gated; runs on the account's active model so a
  // custom UI can call the AI (composing its own prompt, e.g. from files it read).
  app.post<{ Params: { id: string }; Body: { prompt?: string } }>(
    "/workspaces/:id/surface/ask",
    async (req, reply) => {
      const workspace = await requireWorkspace(req.params.id, req, reply, "read");
      if (!workspace) return;
      const prompt = req.body?.prompt;
      if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return reply.status(400).send({ error: "prompt is required" });
      }
      try {
        const settings = getActiveSettings();
        const model =
          settings.provider === "ollama" ? await resolveOllamaModel(settings.model) : settings.model;
        const provider = await getProvider({ provider: settings.provider, model });
        const { text } = await provider.complete({
          system:
            "You are a helpful assistant embedded in a workspace surface. Be concise and answer the prompt directly.",
          prompt: prompt.slice(0, 8000),
        });
        return reply.send({ text });
      } catch (err) {
        return reply.status(500).send({ error: "Completion failed", detail: String(err) });
      }
    },
  );

  // POST /api/workspaces/:id/surface/search — RAG query for a surface's
  // useAriadne().search(query). Read-gated; returns the top relevant chunks so a
  // custom UI can surface what's relevant to its own query.
  app.post<{ Params: { id: string }; Body: { query?: string } }>(
    "/workspaces/:id/surface/search",
    async (req, reply) => {
      const workspace = await requireWorkspace(req.params.id, req, reply, "read");
      if (!workspace) return;
      const query = req.body?.query;
      if (!query || typeof query !== "string" || !query.trim()) {
        return reply.status(400).send({ error: "query is required" });
      }
      const snapshot = dbGetLatestSnapshot(req.params.id);
      if (!snapshot || snapshot.files.length === 0) return reply.send({ results: [] });
      try {
        const chunks = await retrieveRelevantChunks(workspace.rootPath, snapshot.files, query.slice(0, 1000), {
          workspaceId: workspace.id,
          topK: 8,
        });
        return reply.send({ results: chunks.map((c) => ({ path: c.path, text: c.chunk })) });
      } catch (err) {
        return reply.status(500).send({ error: "Search failed", detail: String(err) });
      }
    },
  );

  // GET/POST /api/workspaces/:id/surface/state — a surface's own persisted JSON
  // state (useAriadne().getState / setState). Lets a custom UI remember its
  // choices across reloads. Stored at .ariadne/surface-state.json.
  app.get<{ Params: { id: string } }>("/workspaces/:id/surface/state", async (req, reply) => {
    const workspace = await requireWorkspace(req.params.id, req, reply, "read");
    if (!workspace) return;
    const file = path.join(workspace.rootPath, ".ariadne", "surface-state.json");
    if (!fs.existsSync(file)) return reply.send({ state: null });
    try {
      return reply.send({ state: JSON.parse(fs.readFileSync(file, "utf-8")) });
    } catch {
      return reply.send({ state: null });
    }
  });

  app.post<{ Params: { id: string }; Body: { state?: unknown } }>(
    "/workspaces/:id/surface/state",
    async (req, reply) => {
      const workspace = await requireWorkspace(req.params.id, req, reply, "write");
      if (!workspace) return;
      const json = JSON.stringify(req.body?.state ?? null);
      if (json.length > 256_000) return reply.status(413).send({ error: "State too large (256KB max)" });
      ensureAriadneFolder(workspace.rootPath);
      fs.writeFileSync(path.join(workspace.rootPath, ".ariadne", "surface-state.json"), json);
      return reply.send({ ok: true as const });
    },
  );

  // PUT /api/workspaces/:id/surface — LOCAL access only
  app.put<{ Params: { id: string } }>("/workspaces/:id/surface", async (req, reply) => {
    if (
      await rejectRemoteAccess(
        "Editing the surface is not permitted from remote access. Connect locally to edit surfaces.",
        req,
        reply,
      )
    )
      return;

    const workspace = await requireWorkspace(req.params.id, req, reply);
    if (!workspace) return;

    const parsed = SurfacePutSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", detail: parsed.error.message });
    }

    ensureAriadneFolder(workspace.rootPath);
    try {
      writeSurface(workspace.rootPath, parsed.data.source);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: "Failed to write surface", detail: msg });
    }

    const state = getSurfaceState(workspace.rootPath);
    return reply.send({ state, source: parsed.data.source });
  });

  // POST /api/workspaces/:id/surface/build
  app.post<{ Params: { id: string } }>("/workspaces/:id/surface/build", async (req, reply) => {
    const workspace = await requireWorkspace(req.params.id, req, reply);
    if (!workspace) return;

    ensureAriadneFolder(workspace.rootPath);
    const result = await buildSurface(workspace.rootPath);

    // Persist error so GET /surface can reflect it
    const errorPath = surfaceBundlePath(workspace.rootPath) + ".error";
    if (!result.ok && result.error) {
      fs.writeFileSync(errorPath, result.error, "utf-8");
    } else {
      // Clear stale error file on success
      if (fs.existsSync(errorPath)) fs.unlinkSync(errorPath);
    }

    return reply.send(result);
  });

  // ── AK — multi-file surface folder editor support ─────────────────────

  // GET /api/workspaces/:id/surface/folder
  // Lists files in .ariadne/surface/ (the v2 folder-form layout) so the
  // editor can show a multi-file view. Returns [] when the folder doesn't
  // exist yet (single-file layout). Path is relative to the surface folder.
  app.get<{ Params: { id: string } }>(
    "/workspaces/:id/surface/folder",
    async (req, reply) => {
      const workspace = await requireWorkspace(req.params.id, req, reply, "read");
      if (!workspace) return;

      const surfaceDir = path.join(workspace.rootPath, ".ariadne", "surface");
      if (!fs.existsSync(surfaceDir) || !fs.statSync(surfaceDir).isDirectory()) {
        return reply.send({ files: [], folderExists: false });
      }

      // Walk the folder recursively (1 level deep is enough for our shape
      // but recursive is cheap and future-proof). Only return text files
      // we'd actually want to edit — .tsx / .ts / .js / .jsx / .css /
      // .json / .md / .yaml are the cover-set; anything else is skipped.
      const allowedExt = /\.(tsx|ts|jsx|js|css|json|md|ya?ml)$/i;
      const out: Array<{ path: string; size: number; updatedAt: string; content: string }> = [];
      function walk(dir: string, prefix: string) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith(".")) continue;          // hide dotfiles
          const abs = path.join(dir, entry.name);
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            // Skip surface-dist (build output) — never editable.
            if (entry.name === "surface-dist") continue;
            walk(abs, rel);
            continue;
          }
          if (!allowedExt.test(entry.name)) continue;
          const stat = fs.statSync(abs);
          let content = "";
          try { content = fs.readFileSync(abs, "utf-8"); } catch { /* skip */ }
          out.push({
            path: rel,
            size: stat.size,
            updatedAt: stat.mtime.toISOString(),
            content,
          });
        }
      }
      walk(surfaceDir, "");
      // Sort: index.tsx first (entry point), then alphabetical.
      out.sort((a, b) => {
        if (a.path === "index.tsx") return -1;
        if (b.path === "index.tsx") return 1;
        return a.path.localeCompare(b.path);
      });
      return reply.send({ files: out, folderExists: true });
    },
  );

  // PUT /api/workspaces/:id/surface/folder/file — save a single file
  // inside .ariadne/surface/. LOCAL access only, same gating as the
  // single-file PUT /surface route.
  app.put<{ Params: { id: string }; Body: { path?: string; content?: string } }>(
    "/workspaces/:id/surface/folder/file",
    async (req, reply) => {
      if (
        await rejectRemoteAccess(
          "Editing the surface folder is not permitted from remote access. Connect locally.",
          req,
          reply,
        )
      )
        return;

      const workspace = await requireWorkspace(req.params.id, req, reply);
      if (!workspace) return;

      const relPath = (req.body?.path ?? "").trim();
      const content = req.body?.content;
      if (!relPath || typeof content !== "string") {
        return reply.status(400).send({ error: "path and content are required" });
      }
      if (!/^[a-zA-Z0-9_\-./]+\.(tsx|ts|jsx|js|css|json|md|ya?ml)$/i.test(relPath)) {
        return reply.status(400).send({ error: "Bad file path or extension" });
      }
      if (relPath.includes("..")) {
        return reply.status(403).send({ error: "Path traversal not allowed" });
      }

      const surfaceDir = path.resolve(workspace.rootPath, ".ariadne", "surface");
      const dest = path.resolve(surfaceDir, relPath);
      if (!dest.startsWith(surfaceDir + path.sep) && dest !== surfaceDir) {
        return reply.status(403).send({ error: "Resolved path escapes the surface folder" });
      }

      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try {
        fs.writeFileSync(dest, content, "utf-8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: "Failed to write file", detail: msg });
      }
      return reply.send({ ok: true, path: relPath });
    },
  );

  // POST /api/workspaces/:id/surface/folder/file — create a NEW file (AL3).
  // Distinct from PUT (which assumes the file may exist + overwrites).
  // Refuses to overwrite — the user calls PUT for that.
  app.post<{ Params: { id: string }; Body: { path?: string; content?: string } }>(
    "/workspaces/:id/surface/folder/file",
    async (req, reply) => {
      if (
        await rejectRemoteAccess(
          "Adding surface files is not permitted from remote access.",
          req,
          reply,
        )
      )
        return;

      const workspace = await requireWorkspace(req.params.id, req, reply);
      if (!workspace) return;

      const relPath = (req.body?.path ?? "").trim();
      const content = req.body?.content ?? "";
      if (!relPath || typeof content !== "string") {
        return reply.status(400).send({ error: "path is required" });
      }
      if (!/^[a-zA-Z0-9_\-./]+\.(tsx|ts|jsx|js|css|json|md|ya?ml)$/i.test(relPath)) {
        return reply.status(400).send({ error: "Bad file path or extension" });
      }
      if (relPath.includes("..")) {
        return reply.status(403).send({ error: "Path traversal not allowed" });
      }

      const surfaceDir = path.resolve(workspace.rootPath, ".ariadne", "surface");
      const dest = path.resolve(surfaceDir, relPath);
      if (!dest.startsWith(surfaceDir + path.sep) && dest !== surfaceDir) {
        return reply.status(403).send({ error: "Resolved path escapes the surface folder" });
      }
      if (fs.existsSync(dest)) {
        return reply.status(409).send({ error: "File already exists — use PUT to overwrite" });
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try {
        fs.writeFileSync(dest, content, "utf-8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: "Failed to create file", detail: msg });
      }
      return reply.send({ ok: true, path: relPath });
    },
  );

  // DELETE /api/workspaces/:id/surface/folder/file?path=<rel> — delete a
  // file in .ariadne/surface/ (AL3). LOCAL only. Refuses to delete
  // index.tsx — that's the entry point.
  app.delete<{ Params: { id: string }; Querystring: { path?: string } }>(
    "/workspaces/:id/surface/folder/file",
    async (req, reply) => {
      if (
        await rejectRemoteAccess(
          "Deleting surface files is not permitted from remote access.",
          req,
          reply,
        )
      )
        return;

      const workspace = await requireWorkspace(req.params.id, req, reply);
      if (!workspace) return;

      const relPath = (req.query.path ?? "").trim();
      if (!relPath) return reply.status(400).send({ error: "path query param required" });
      if (relPath === "index.tsx") {
        return reply.status(400).send({ error: "index.tsx is the entry point and cannot be deleted" });
      }
      if (relPath.includes("..")) {
        return reply.status(403).send({ error: "Path traversal not allowed" });
      }

      const surfaceDir = path.resolve(workspace.rootPath, ".ariadne", "surface");
      const dest = path.resolve(surfaceDir, relPath);
      if (!dest.startsWith(surfaceDir + path.sep)) {
        return reply.status(403).send({ error: "Resolved path escapes the surface folder" });
      }
      if (!fs.existsSync(dest)) {
        return reply.status(404).send({ error: "File not found" });
      }
      try {
        fs.unlinkSync(dest);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: "Failed to delete file", detail: msg });
      }
      return reply.send({ ok: true });
    },
  );

  // GET /api/workspaces/:id/file?path=<rel>
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    "/workspaces/:id/file",
    async (req, reply) => {
      const workspace = await requireWorkspace(req.params.id, req, reply, "read");
      if (!workspace) return;

      const relPath = req.query.path;
      if (!relPath) return reply.status(400).send({ error: "Missing query param: path" });

      // Resolve and guard against path traversal
      const resolved = path.resolve(workspace.rootPath, relPath);
      if (!resolved.startsWith(path.resolve(workspace.rootPath) + path.sep) &&
          resolved !== path.resolve(workspace.rootPath)) {
        return reply.status(403).send({ error: "Path traversal not allowed" });
      }

      // Defense-in-depth: a workspace may be public (viewable by guests), but its
      // SENSITIVE files must not be served to non-owners. Owner/admin still read
      // everything; a viewer of a public workspace is blocked from sensitive paths.
      if (checkSensitive(relPath) && !isOwnerOrAdmin(workspace.createdBy, req.account)) {
        return reply.status(403).send({ error: "Forbidden", detail: "This file is marked sensitive." });
      }

      if (!fs.existsSync(resolved)) {
        return reply.status(404).send({ error: "File not found" });
      }

      let content: string;
      try {
        content = fs.readFileSync(resolved, "utf-8");
      } catch {
        return reply.status(500).send({ error: "Failed to read file" });
      }

      return reply.send({ content });
    }
  );

  // PUT /api/workspaces/:id/file — overwrite a data file in the workspace root.
  // LOCAL access only; restricted to plain data file types; never touches .ariadne.
  app.put<{ Params: { id: string }; Body: { path?: string; content?: string } }>(
    "/workspaces/:id/file",
    async (req, reply) => {
      if (
        await rejectRemoteAccess(
          "Editing workspace files is not permitted from remote access. Connect locally to edit.",
          req,
          reply,
        )
      )
        return;

      const workspace = await requireWorkspace(req.params.id, req, reply);
      if (!workspace) return;

      const relPath = req.body?.path;
      const content = req.body?.content;
      if (typeof relPath !== "string" || !relPath || typeof content !== "string") {
        return reply.status(400).send({ error: "path and content are required" });
      }
      if (!/\.(csv|tsv|txt|json|md|ya?ml)$/i.test(relPath)) {
        return reply
          .status(400)
          .send({ error: "Only data files (csv, tsv, txt, json, md, yaml) may be edited" });
      }

      const resolved = safeResolveUnderRoot(workspace.rootPath, relPath);
      if (!resolved) {
        return reply.status(403).send({ error: "Path traversal not allowed" });
      }
      const ariadneDir = path.join(path.resolve(workspace.rootPath), ".ariadne");
      if (resolved === ariadneDir || resolved.startsWith(ariadneDir + path.sep)) {
        return reply.status(403).send({ error: "The .ariadne folder is managed and cannot be edited here" });
      }
      if (!fs.existsSync(resolved)) {
        return reply.status(404).send({ error: "File not found" });
      }

      try {
        fs.writeFileSync(resolved, content, "utf-8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: "Failed to write file", detail: msg });
      }

      return reply.send({ ok: true });
    }
  );

  // POST /api/workspaces/:id/file/create — create a NEW data file in the
  // workspace root by pasting its content (the "긴 글을 파일로 저장" feature).
  // Mirrors the PUT guards above but REFUSES to clobber an existing file (409),
  // and creates any missing parent folders so a nested "notes/draft.md" works.
  // LOCAL access only.
  app.post<{ Params: { id: string }; Body: { path?: string; content?: string } }>(
    "/workspaces/:id/file/create",
    async (req, reply) => {
      if (
        await rejectRemoteAccess(
          "Creating workspace files is not permitted from remote access. Connect locally to edit.",
          req,
          reply,
        )
      )
        return;

      const workspace = await requireWorkspace(req.params.id, req, reply);
      if (!workspace) return;

      const relPath = req.body?.path;
      const content = req.body?.content ?? "";
      if (typeof relPath !== "string" || !relPath.trim() || typeof content !== "string") {
        return reply.status(400).send({ error: "path and content are required" });
      }
      if (!/\.(csv|tsv|txt|json|md|ya?ml)$/i.test(relPath)) {
        return reply
          .status(400)
          .send({ error: "Only data files (csv, tsv, txt, json, md, yaml) may be created" });
      }

      const resolved = safeResolveUnderRoot(workspace.rootPath, relPath);
      if (!resolved) {
        return reply.status(403).send({ error: "Path traversal not allowed" });
      }
      const ariadneDir = path.join(path.resolve(workspace.rootPath), ".ariadne");
      if (resolved === ariadneDir || resolved.startsWith(ariadneDir + path.sep)) {
        return reply.status(403).send({ error: "The .ariadne folder is managed and cannot be edited here" });
      }
      if (fs.existsSync(resolved)) {
        return reply.status(409).send({ error: "A file with that name already exists" });
      }

      try {
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, content, "utf-8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: "Failed to create file", detail: msg });
      }

      return reply.send({ ok: true });
    }
  );

  // POST /api/workspaces/:id/file/stage — stage a data-file edit for review.
  // Same shape as the direct PUT above, but routes through stagedEdits +
  // creates a new Run so the change shows up at /runs/:runId/diff. The UI's
  // Data tab now uses this path; the direct PUT stays for callers that need
  // immediate writes (Surface SDK, headless flows). The whole point of this
  // route is to give Data-tab edits the same "review before applying"
  // workflow that AI-proposed edits already have.
  app.post<{ Params: { id: string }; Body: { path?: string; content?: string } }>(
    "/workspaces/:id/file/stage",
    async (req, reply) => {
      if (
        await rejectRemoteAccess(
          "Staging workspace files is not permitted from remote access.",
          req,
          reply,
        )
      )
        return;

      const workspace = await requireWorkspace(req.params.id, req, reply);
      if (!workspace) return;

      const relPath = req.body?.path;
      const content = req.body?.content;
      if (typeof relPath !== "string" || !relPath || typeof content !== "string") {
        return reply.status(400).send({ error: "path and content are required" });
      }
      // Wider allow-list than the direct PUT — staging doesn't touch disk
      // until the user clicks Apply on the diff view, so the safety check
      // here only needs to keep out clearly-dangerous filenames (executable
      // entry points, dotfiles outside the project, etc.). Most plain-text
      // editable types are fine to stage. The Apply step still rejects
      // anything outside the workspace root via the same safeResolveUnderRoot.
      if (
        !/\.(c|h|cc|cpp|hpp|ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|sh|bash|zsh|css|html|svg|csv|tsv|txt|json|md|ya?ml|toml|ini|conf|env\.example|sql)$/i.test(relPath) &&
        !/(^|\/)Makefile$/i.test(relPath)
      ) {
        return reply
          .status(400)
          .send({ error: "File type not allowed for staging" });
      }

      const resolved = safeResolveUnderRoot(workspace.rootPath, relPath);
      if (!resolved) {
        return reply.status(403).send({ error: "Path traversal not allowed" });
      }
      const ariadneDir = path.join(path.resolve(workspace.rootPath), ".ariadne");
      if (resolved === ariadneDir || resolved.startsWith(ariadneDir + path.sep)) {
        return reply
          .status(403)
          .send({ error: "The .ariadne folder is managed and cannot be edited here" });
      }

      const before = fs.existsSync(resolved) ? fs.readFileSync(resolved, "utf-8") : null;
      const action: "create" | "modify" | "replace" = before === null ? "create" : "modify";

      // New synthetic Run so the diff view + apply flow work unchanged.
      // kind="action" with a manual-data-edit actionId is the smallest
      // change that fits the existing schema; the diff/apply UI doesn't
      // care where the staged manifest came from.
      //
      // provider: "mock" is the honest tag here — no AI call happened,
      // so it shouldn't pollute usage analytics that filter on real
      // provider invocations. startedAt + completedAt are stamped now
      // because the "run" conceptually starts and finishes the moment
      // the stage is recorded.
      const runId = makeDateRunId(dbListRuns());
      const now = new Date().toISOString();
      const run: Run = {
        id: runId,
        kind: "action",
        workspaceId: workspace.id,
        templateId: "manual-data-edit",
        templateName: `Edit ${relPath}`,
        status: "completed",
        input: { path: relPath },
        model: "",
        provider: "mock",
        createdAt: now,
        startedAt: now,
        completedAt: now,
        candidateFiles: [],
        selectedFiles: [],
        tokenEstimate: 0,
        evidenceCount: 0,
        unsupportedCount: 0,
        blockResults: [],
        artifacts: {},
        trace: [],
        previousRunId: null,
        error: null,
        createdBy: req.account?.id ?? null,
        createdByName: req.account?.displayName ?? null,
        usage: null,
      };
      dbInsertRun(run);

      try {
        const stats = await stageEdit({
          runId,
          workspace,
          path: relPath,
          action,
          before,
          after: content,
        });
        // Lightweight UI-pref files (watchlist, recurring-buy plans, todo
        // check state) auto-apply so surface toggles persist instantly without
        // a manual Apply. Financial data (positions CSV, etc.) still routes
        // through the review/Apply flow.
        let applied = false;
        if (/(^|\/)targets\/(watch|sparplan|todos)\.json$/.test(relPath)) {
          try {
            await applyStagedEdits(workspace.id, runId, [relPath], req.accessContext === "local");
            applied = true;
          } catch {
            // Best-effort — fall back to the normal staged-review flow.
          }
        }
        return reply.send({
          runId,
          added: stats.added,
          removed: stats.removed,
          applied,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: "Failed to stage edit", detail: msg });
      }
    },
  );
}
