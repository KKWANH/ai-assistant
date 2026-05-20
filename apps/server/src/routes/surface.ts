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
import type { SurfaceState } from "@ariadne/shared";
import {
  ensureAriadneFolder,
  readSurface,
  writeSurface,
  surfaceBundlePath,
  surfaceTsxPath,
} from "../ariadneFolder.js";
import { buildSurface } from "../services/surfaceBuild.js";
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
}
