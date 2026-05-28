/**
 * Files routes — extraction (markdown) + screenshot (PDF page → PNG).
 *
 * GET  /api/files/markitdown-status
 *   → { available, version, formats }
 *
 * POST /api/files/extract
 *   body: { workspaceId, path }
 *   → { markdown, source, hash, bytes, truncated }
 *   404 if workspace/path missing, 415 if extension unsupported,
 *   503 if markitdown isn't installed and there's no cached entry.
 *
 * GET  /api/files/pdf-screenshot
 *   query: workspaceId, path, page=1, scale=2
 *   → image/png buffer (Content-Disposition inline)
 *
 * All routes resolve the file relative to the workspace's rootPath and
 * refuse paths that escape it (../ segments).
 */

import path from "node:path";
import type { FastifyInstance } from "fastify";
import { dbGetWorkspace } from "../db/repo.js";
import { getMarkitdownStatus } from "../services/markitdown.js";
import {
  getOrExtractMarkdown,
  isMarkdownCached,
} from "../services/markdownCache.js";
import { renderPdfPage } from "../services/pdfScreenshot.js";
import { MARKITDOWN_FORMATS } from "../services/markitdown.js";
import logger from "../logger.js";

/** Resolve `subPath` relative to the workspace root, rejecting escapes
 *  via ../ or absolute paths that don't fall under the root. */
function safeJoinWorkspace(rootPath: string, subPath: string): string {
  // Normalise both so path.relative correctly compares them.
  const normalisedRoot = path.resolve(rootPath);
  const candidate = path.resolve(normalisedRoot, subPath);
  const rel = path.relative(normalisedRoot, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path escapes workspace root: ${subPath}`);
  }
  return candidate;
}

export async function filesRoutes(app: FastifyInstance): Promise<void> {
  // ────────────────────────────────────────────────────────────────
  // GET /api/files/markitdown-status
  // ────────────────────────────────────────────────────────────────
  app.get("/files/markitdown-status", async (_req, reply) => {
    const s = getMarkitdownStatus();
    return reply.send({
      available: s.available,
      version: s.version,
      formats: Array.from(MARKITDOWN_FORMATS).sort(),
    });
  });

  // ────────────────────────────────────────────────────────────────
  // POST /api/files/extract — convert file to markdown via markitdown.
  // ────────────────────────────────────────────────────────────────
  app.post<{ Body: { workspaceId?: string; path?: string } }>(
    "/files/extract",
    async (req, reply) => {
      const { workspaceId, path: subPath } = req.body ?? {};
      if (!workspaceId || !subPath) {
        return reply.status(400).send({ error: "workspaceId and path required" });
      }
      const ws = dbGetWorkspace(workspaceId);
      if (!ws) return reply.status(404).send({ error: "Workspace not found" });

      let absPath: string;
      try {
        absPath = safeJoinWorkspace(ws.rootPath, subPath);
      } catch (e) {
        return reply.status(400).send({ error: String((e as Error).message) });
      }

      const ext = path.extname(absPath).toLowerCase();
      if (!MARKITDOWN_FORMATS.has(ext)) {
        return reply.status(415).send({
          error: `Extension ${ext} not supported by markitdown`,
          supported: Array.from(MARKITDOWN_FORMATS).sort(),
        });
      }

      try {
        const result = await getOrExtractMarkdown(ws.rootPath, absPath);
        return reply.send(result);
      } catch (e) {
        const msg = String((e as Error).message);
        // Distinguish "not installed" from "conversion failed" so the
        // client can show different messaging.
        if (msg.includes("not installed") || msg.includes("not available")) {
          return reply.status(503).send({
            error: "markitdown not installed",
            hint: "pip install 'markitdown[pdf,docx,pptx,xlsx]' or set MARKITDOWN_PATH",
          });
        }
        logger.warn({ absPath, err: msg }, "extract failed");
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // ────────────────────────────────────────────────────────────────
  // GET /api/files/markdown-cached — quick existence check (no read).
  // ────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { workspaceId?: string; path?: string } }>(
    "/files/markdown-cached",
    async (req, reply) => {
      const workspaceId = req.query.workspaceId;
      const subPath = req.query.path;
      if (!workspaceId || !subPath) {
        return reply.status(400).send({ error: "workspaceId and path required" });
      }
      const ws = dbGetWorkspace(workspaceId);
      if (!ws) return reply.status(404).send({ error: "Workspace not found" });
      let absPath: string;
      try {
        absPath = safeJoinWorkspace(ws.rootPath, subPath);
      } catch (e) {
        return reply.status(400).send({ error: String((e as Error).message) });
      }
      const info = await isMarkdownCached(ws.rootPath, absPath);
      return reply.send(info);
    },
  );

  // ────────────────────────────────────────────────────────────────
  // GET /api/files/pdf-screenshot — render one PDF page as PNG.
  // ────────────────────────────────────────────────────────────────
  app.get<{
    Querystring: { workspaceId?: string; path?: string; page?: string; scale?: string };
  }>("/files/pdf-screenshot", async (req, reply) => {
    const { workspaceId, path: subPath } = req.query;
    if (!workspaceId || !subPath) {
      return reply.status(400).send({ error: "workspaceId and path required" });
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const scale = Math.min(4, Math.max(1, Number(req.query.scale) || 2));
    const ws = dbGetWorkspace(workspaceId);
    if (!ws) return reply.status(404).send({ error: "Workspace not found" });

    let absPath: string;
    try {
      absPath = safeJoinWorkspace(ws.rootPath, subPath);
    } catch (e) {
      return reply.status(400).send({ error: String((e as Error).message) });
    }
    if (path.extname(absPath).toLowerCase() !== ".pdf") {
      return reply.status(415).send({ error: "Only PDFs are supported (DOCX/PPTX screenshot is on the roadmap)" });
    }

    try {
      const result = await renderPdfPage(absPath, page, scale);
      reply.header("Content-Type", "image/png");
      reply.header(
        "Content-Disposition",
        `inline; filename="page-${result.page}-of-${result.totalPages}.png"`,
      );
      reply.header("X-Pdf-Total-Pages", String(result.totalPages));
      reply.header("X-Pdf-Page", String(result.page));
      reply.header("X-Pdf-Scale", String(result.scale));
      reply.header("Cache-Control", "private, max-age=300");
      return reply.send(result.buffer);
    } catch (e) {
      const msg = String((e as Error).message);
      const status = msg.includes("out of range") ? 416 : 500;
      logger.warn({ absPath, page, err: msg }, "pdf screenshot failed");
      return reply.status(status).send({ error: msg });
    }
  });
}
