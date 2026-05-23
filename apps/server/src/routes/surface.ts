/**
 * Surface routes — registered INSIDE the /api prefix (authenticated).
 *
 * GET  /api/workspaces/:id/surface          → { state: SurfaceState, source: string }
 * PUT  /api/workspaces/:id/surface          → save source (LOCAL only)
 * POST /api/workspaces/:id/surface/build    → build bundle, return { ok, error }
 * GET  /api/workspaces/:id/file?path=<rel>  → { content: string } of a text file in workspace root
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
import { stageEdit } from "../services/stagedEdits.js";
import { dbInsertRun, dbListRuns } from "../db/repo.js";
import { makeDateRunId } from "../runs/engine.js";
import { requireWorkspace, rejectRemoteAccess } from "./workspaceGuard.js";

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
    const workspace = await requireWorkspace(req.params.id, req, reply);
    if (!workspace) return;

    ensureAriadneFolder(workspace.rootPath);
    const state = getSurfaceState(workspace.rootPath);
    const source = readSurface(workspace.rootPath) ?? "";
    return reply.send({ state, source });
  });

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

  // GET /api/workspaces/:id/file?path=<rel>
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    "/workspaces/:id/file",
    async (req, reply) => {
      const workspace = await requireWorkspace(req.params.id, req, reply);
      if (!workspace) return;

      const relPath = req.query.path;
      if (!relPath) return reply.status(400).send({ error: "Missing query param: path" });

      // Resolve and guard against path traversal
      const resolved = path.resolve(workspace.rootPath, relPath);
      if (!resolved.startsWith(path.resolve(workspace.rootPath) + path.sep) &&
          resolved !== path.resolve(workspace.rootPath)) {
        return reply.status(403).send({ error: "Path traversal not allowed" });
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
      if (!/\.(csv|tsv|txt|json|md|ya?ml)$/i.test(relPath)) {
        return reply
          .status(400)
          .send({ error: "Only data files (csv, tsv, txt, json, md, yaml) may be staged" });
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
        provider: "anthropic",
        createdAt: now,
        startedAt: null,
        completedAt: null,
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
        return reply.send({
          runId,
          added: stats.added,
          removed: stats.removed,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: "Failed to stage edit", detail: msg });
      }
    },
  );
}
