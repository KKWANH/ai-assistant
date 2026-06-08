/**
 * Lecture-prep routes — read a semester workspace as courses → weeks →
 * materials, and scaffold new course/week folders.
 *
 *   GET  /api/workspaces/:id/lecture          — the folder structure
 *   POST /api/workspaces/:id/lecture/folder   — create a course (and week)
 *
 * Both gate on the same workspace access as the rest of the workspace API:
 * read for the structure, write to scaffold.
 */
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { requireWorkspace } from "./workspaceGuard.js";
import { getLectureStructure, scaffoldLectureFolder } from "../services/lecturePrep.js";
import { generateDeckOutline, buildPptx } from "../services/deckGen.js";
import { retrieveRelevantChunks, formatChunksForPrompt } from "../services/retrieval.js";
import { dbGetLatestSnapshot } from "../db/repo.js";
import { getActiveSettings } from "../config.js";
import { getProvider } from "../providers/index.js";
import { resolveOllamaModel } from "../services/ollamaModels.js";
import { safeResolveUnderRoot } from "../security/pathGuard.js";

/** A filesystem-safe .pptx filename derived from a deck title. */
function deckFileName(title: string): string {
  const base = title.replace(/[/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "deck";
  return `${base}.pptx`;
}

export async function lectureRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>("/workspaces/:id/lecture", async (req, reply) => {
    const ws = await requireWorkspace(req.params.id, req, reply, "read");
    if (!ws) return;
    return reply.send(getLectureStructure(ws.rootPath));
  });

  app.post<{ Params: { id: string }; Body: { course?: string; week?: string } }>(
    "/workspaces/:id/lecture/folder",
    async (req, reply) => {
      const ws = await requireWorkspace(req.params.id, req, reply, "write");
      if (!ws) return;
      const course = req.body?.course?.trim();
      const week = req.body?.week?.trim() || undefined;
      if (!course) return reply.status(400).send({ error: "course is required" });
      try {
        const result = scaffoldLectureFolder(ws.rootPath, course, week);
        return reply.status(201).send(result);
      } catch (err) {
        return reply.status(400).send({ error: "Could not create folder", detail: String(err) });
      }
    },
  );

  // Generate a .pptx deck for a topic, grounded in the workspace's materials,
  // saved to the workspace root. Returns the outline (for the preview) + the
  // file name (for download). Write-gated — it both generates and saves.
  app.post<{ Params: { id: string }; Body: { topic?: string } }>(
    "/workspaces/:id/deck",
    async (req, reply) => {
      const ws = await requireWorkspace(req.params.id, req, reply, "write");
      if (!ws) return;
      const topic = req.body?.topic?.trim();
      if (!topic) return reply.status(400).send({ error: "topic is required" });

      let grounding = "";
      const snapshot = dbGetLatestSnapshot(req.params.id);
      if (snapshot && snapshot.files.length > 0) {
        try {
          const chunks = await retrieveRelevantChunks(ws.rootPath, snapshot.files, topic, {
            workspaceId: ws.id,
            topK: 8,
          });
          grounding = formatChunksForPrompt(chunks);
        } catch {
          /* fall back to topic-only generation */
        }
      }

      const settings = getActiveSettings();
      const model =
        settings.provider === "ollama" ? await resolveOllamaModel(settings.model) : settings.model;
      const provider = await getProvider({ provider: settings.provider, model });

      try {
        const deck = await generateDeckOutline(topic, grounding, provider);
        const pptx = await buildPptx(deck);
        const fileName = deckFileName(deck.title);
        const dest = safeResolveUnderRoot(path.resolve(ws.rootPath), fileName);
        if (!dest) return reply.status(400).send({ error: "Unsafe file name" });
        fs.writeFileSync(dest, pptx);
        return reply.send({ deck, fileName });
      } catch (err) {
        return reply.status(500).send({ error: "Deck generation failed", detail: String(err) });
      }
    },
  );

  // Download a generated deck from the workspace root.
  app.get<{ Params: { id: string }; Querystring: { name?: string } }>(
    "/workspaces/:id/deck-file",
    async (req, reply) => {
      const ws = await requireWorkspace(req.params.id, req, reply, "read");
      if (!ws) return;
      const name = req.query.name?.trim();
      if (!name) return reply.status(400).send({ error: "name is required" });
      const abs = safeResolveUnderRoot(path.resolve(ws.rootPath), name);
      if (!abs || !fs.existsSync(abs)) return reply.status(404).send({ error: "Deck not found" });
      return reply
        .type("application/vnd.openxmlformats-officedocument.presentationml.presentation")
        .header(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`,
        )
        .send(fs.readFileSync(abs));
    },
  );
}
