/**
 * Agent-attempt routes — view, apply, abandon a chat's staged edit set.
 *
 * Three endpoints; everything else (the diff manifest payload, the
 * apply machinery, etc.) reuses the Phase A primitives via the
 * stagingIdForAttempt() helper.
 */
import type { FastifyInstance } from "fastify";
import {
  getAttempt,
  getOpenAttemptForChat,
  listAttemptsForChat,
  applyAttempt,
  abandonAttempt,
  stagingIdForAttempt,
} from "../services/attempts.js";
import { getStagedManifest } from "../services/stagedEdits.js";
import { dbGetChat } from "../db/repo.js";
import { isOwnerOrAdmin } from "./workspaceGuard.js";

export async function attemptRoutes(app: FastifyInstance): Promise<void> {
  // Resolve the chat's open attempt — used by the chat UI to render
  // the "Staged edits" chip without polling all attempts.
  app.get<{ Params: { chatId: string } }>(
    "/chats/:chatId/open-attempt",
    async (req, reply) => {
      const chat = dbGetChat(req.params.chatId);
      if (!chat) return reply.status(404).send({ error: "Chat not found" });
      if (!isOwnerOrAdmin(chat.createdBy, req.account)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const attempt = getOpenAttemptForChat(req.params.chatId);
      return reply.send(attempt ?? null);
    },
  );

  // Every attempt for the chat (open + applied + abandoned), newest
  // first. Powers the attempts list page.
  app.get<{ Params: { chatId: string } }>(
    "/chats/:chatId/attempts",
    async (req, reply) => {
      const chat = dbGetChat(req.params.chatId);
      if (!chat) return reply.status(404).send({ error: "Chat not found" });
      if (!isOwnerOrAdmin(chat.createdBy, req.account)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      return reply.send(listAttemptsForChat(req.params.chatId));
    },
  );

  // The attempt's staged manifest (same shape as run-staged so the
  // diff viewer can render either).
  app.get<{ Params: { id: string } }>("/attempts/:id", async (req, reply) => {
    const attempt = getAttempt(req.params.id);
    if (!attempt) return reply.status(404).send({ error: "Attempt not found" });
    const chat = dbGetChat(attempt.chatId);
    if (chat && !isOwnerOrAdmin(chat.createdBy, req.account)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const manifest = getStagedManifest(attempt.workspaceId, stagingIdForAttempt(attempt.id));
    return reply.send({ attempt, manifest });
  });

  // Apply selected paths from the attempt → workspace + history commit.
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/attempts/:id/apply",
    async (req, reply) => {
      const attempt = getAttempt(req.params.id);
      if (!attempt) return reply.status(404).send({ error: "Attempt not found" });
      const chat = dbGetChat(attempt.chatId);
      if (chat && !isOwnerOrAdmin(chat.createdBy, req.account)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const body = (req.body ?? {}) as { paths?: unknown };
      const paths = Array.isArray(body.paths)
        ? body.paths.filter((p): p is string => typeof p === "string")
        : null;
      if (!paths || paths.length === 0) {
        return reply.status(400).send({ error: "paths[] is required" });
      }
      try {
        const result = await applyAttempt(req.params.id, paths, req.accessContext === "local");
        return reply.send(result);
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // Wipe the staged tree + mark abandoned.
  app.post<{ Params: { id: string } }>("/attempts/:id/abandon", async (req, reply) => {
    const attempt = getAttempt(req.params.id);
    if (!attempt) return reply.status(404).send({ error: "Attempt not found" });
    const chat = dbGetChat(attempt.chatId);
    if (chat && !isOwnerOrAdmin(chat.createdBy, req.account)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    abandonAttempt(req.params.id);
    return reply.send({ ok: true });
  });
}
