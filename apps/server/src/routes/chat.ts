/**
 * Chat routes — /api/chats (and /api/uploads/:id)
 *
 * All routes live inside the /api scope and benefit from the auth onRequest hook.
 * The POST /api/chats/:id/messages endpoint streams Server-Sent Events:
 *
 *   {type:"user_message", message}
 *   {type:"status", text}               (progress updates)
 *   {type:"delta", text}                (streaming token chunks)
 *   {type:"agent_plan", steps}          (agent mode only)
 *   {type:"agent_step", step}           (agent mode only)
 *   {type:"done", message}              (final assistant message)
 *   {type:"error", error}               (on any failure)
 */

import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Chat, ChatMessage, ChatAttachment, ChatStreamEvent, SearchResult } from "@ariadne/shared";
import { CreateChatSchema, UpdateChatSchema, PostMessageSchema } from "@ariadne/shared";
import type { PostAttachmentInput } from "@ariadne/shared";
import {
  dbCreateChat,
  dbListChats,
  dbGetChat,
  dbUpdateChat,
  dbDeleteChat,
  dbInsertMessage,
  dbListMessages,
} from "../db/repo.js";
import { getProvider } from "../providers/index.js";
import { meteringProvider } from "../runs/engine.js";
import { getActiveSettings } from "../config.js";
import { saveUpload, readUpload } from "../services/uploads.js";
import { buildChatContext } from "../services/chatContext.js";
import type { AttachmentRef } from "../services/chatContext.js";
import { runAgent } from "../services/agent.js";
import logger from "../logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

function autoTitle(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  return trimmed.length <= 40 ? trimmed : trimmed.slice(0, 40) + "…";
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // GET /api/chats
  // -------------------------------------------------------------------------
  app.get("/chats", async (_req, reply) => {
    return reply.send(dbListChats());
  });

  // -------------------------------------------------------------------------
  // POST /api/chats
  // -------------------------------------------------------------------------
  app.post<{ Body: unknown }>("/chats", async (req, reply) => {
    const parsed = CreateChatSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", detail: parsed.error.message });
    }
    const { title, workspaceId } = parsed.data;
    const ts = now();
    const chat: Chat = {
      id: newId(),
      title: title?.trim() || "New chat",
      workspaceId: workspaceId ?? null,
      createdBy: req.account?.id ?? null,
      createdAt: ts,
      updatedAt: ts,
    };
    dbCreateChat(chat);
    return reply.status(201).send(chat);
  });

  // -------------------------------------------------------------------------
  // GET /api/chats/:id
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/chats/:id", async (req, reply) => {
    const chat = dbGetChat(req.params.id);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    return reply.send(chat);
  });

  // -------------------------------------------------------------------------
  // PATCH /api/chats/:id
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string }; Body: unknown }>("/chats/:id", async (req, reply) => {
    const existing = dbGetChat(req.params.id);
    if (!existing) return reply.status(404).send({ error: "Chat not found" });

    const parsed = UpdateChatSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", detail: parsed.error.message });
    }

    const updated = dbUpdateChat(req.params.id, {
      title: parsed.data.title,
      workspaceId: parsed.data.workspaceId,
      updatedAt: now(),
    });
    return reply.send(updated);
  });

  // -------------------------------------------------------------------------
  // DELETE /api/chats/:id
  // -------------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>("/chats/:id", async (req, reply) => {
    const existing = dbGetChat(req.params.id);
    if (!existing) return reply.status(404).send({ error: "Chat not found" });
    dbDeleteChat(req.params.id);
    return reply.send({ ok: true });
  });

  // -------------------------------------------------------------------------
  // POST /api/chats/:id/messages  → SSE stream
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/chats/:id/messages",
    async (req, reply) => {
      const chat = dbGetChat(req.params.id);
      if (!chat) return reply.status(404).send({ error: "Chat not found" });

      const parsed = PostMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid request body",
          detail: parsed.error.message,
        });
      }

      const { content, attachments: rawAttachments, webSearch, agentMode } = parsed.data;

      // Reject if both content is empty and no attachments
      const hasContent = content.trim().length > 0;
      const hasAttachments = rawAttachments && rawAttachments.length > 0;
      if (!hasContent && !hasAttachments) {
        return reply.status(400).send({ error: "Message must have content or at least one attachment" });
      }

      // --- Hijack the raw response for SSE ---
      reply.hijack();
      const raw = reply.raw;

      raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      function sseEmit(event: ChatStreamEvent): void {
        try {
          raw.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch {
          // client disconnected
        }
      }

      function sseEnd(): void {
        try {
          raw.end();
        } catch {
          // ignore
        }
      }

      try {
        // --- Save attachments to disk and build ChatAttachment[] ---
        const chatAttachments: ChatAttachment[] = [];
        const attachmentRefs: AttachmentRef[] = [];

        if (rawAttachments) {
          for (const att of rawAttachments as PostAttachmentInput[]) {
            const uploadId = newId();
            const meta = saveUpload(uploadId, att.name, att.mediaType, att.dataBase64);
            chatAttachments.push({
              id: uploadId,
              name: att.name,
              mediaType: att.mediaType,
              kind: meta.kind,
              size: meta.size,
            });
            attachmentRefs.push({ uploadId });
          }
        }

        // --- Insert user message ---
        const userMsgId = newId();
        const userMsg: ChatMessage = {
          id: userMsgId,
          chatId: chat.id,
          role: "user",
          content,
          attachments: chatAttachments,
          webSearch: webSearch ?? false,
          searchResults: null,
          agent: null,
          createdAt: now(),
        };
        dbInsertMessage(userMsg);
        sseEmit({ type: "user_message", message: userMsg });

        // --- Auto-title on first message ---
        const history = dbListMessages(chat.id);
        const isFirstMessage = history.filter((m) => m.role === "user").length === 1;
        const isDefaultTitle = chat.title === "New chat";
        if (isFirstMessage && isDefaultTitle && hasContent) {
          const newTitle = autoTitle(content);
          dbUpdateChat(chat.id, { title: newTitle, updatedAt: now() });
        }

        // --- Build context ---
        const settings = getActiveSettings();
        const historyWithoutCurrent = history.filter((m) => m.id !== userMsgId);
        sseEmit({ type: "status", text: "Building context…" });

        let contextResult;
        try {
          contextResult = await buildChatContext(chat, historyWithoutCurrent, {
            content,
            attachments: attachmentRefs,
            // In agent mode the agent runs its own web_search steps — skip the
            // duplicate pre-search here.
            webSearch: agentMode ? false : (webSearch ?? false),
          });
        } catch (err) {
          logger.warn({ chatId: chat.id, err }, "Failed to build chat context");
          contextResult = {
            system: "You are Ariadne's assistant — a calm, precise, local-first AI workspace assistant.",
            prompt: `User: ${content}`,
            images: [],
            searchResults: null,
          };
        }

        // --- Get provider ---
        const assistantMsgId = newId();
        const rawProvider = await getProvider(settings);
        const provider = meteringProvider(rawProvider, assistantMsgId, settings.model);

        // --- Agent mode or regular mode ---
        let assistantContent: string;
        let agentTrace: import("@ariadne/shared").AgentTrace | null = null;
        let agentSearchResults: SearchResult[] | null = null;

        if (agentMode) {
          // Agent plan-and-execute loop
          try {
            const agentResult = await runAgent({
              chat,
              history: historyWithoutCurrent,
              userMessage: content,
              provider,
              emit: sseEmit,
            });
            assistantContent = agentResult.content;
            agentTrace = agentResult.agent;
            agentSearchResults = agentResult.searchResults;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn({ chatId: chat.id, err }, "Agent loop error");
            assistantContent = `I encountered an error during the agent loop: ${msg}`;
          }
        } else {
          // Regular streaming
          sseEmit({ type: "status", text: "Generating…" });

          try {
            const hasImages = contextResult.images.length > 0;

            if (hasImages && provider.completeWithImages) {
              // Vision call — no streaming for images (fall back to complete)
              const result = await provider.completeWithImages({
                system: contextResult.system,
                prompt: contextResult.prompt,
                images: contextResult.images,
              });
              assistantContent = result.text;
              // Emit the whole text as one delta so the client renders it
              sseEmit({ type: "delta", text: assistantContent });
            } else {
              assistantContent = "";
              await provider.completeStream(
                {
                  system: contextResult.system,
                  prompt: contextResult.prompt,
                },
                (delta) => {
                  assistantContent += delta;
                  sseEmit({ type: "delta", text: delta });
                },
                (status) => {
                  sseEmit({ type: "status", text: status });
                },
              );
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn({ chatId: chat.id, err }, "AI provider streaming error");
            assistantContent =
              "I'm sorry, I encountered an error while generating a response. " +
              `(${msg}) Please check your provider settings and try again.`;
            sseEmit({ type: "delta", text: assistantContent });
          }
        }

        // --- Insert assistant message ---
        const assistantMsg: ChatMessage = {
          id: assistantMsgId,
          chatId: chat.id,
          role: "assistant",
          content: assistantContent,
          attachments: [],
          webSearch: false,
          searchResults: agentSearchResults ?? contextResult.searchResults,
          agent: agentTrace,
          createdAt: now(),
        };
        dbInsertMessage(assistantMsg);

        // --- Bump chat updated_at ---
        dbUpdateChat(chat.id, { updatedAt: now() });

        sseEmit({ type: "done", message: assistantMsg });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ chatId: chat.id, err }, "Unexpected error in chat SSE handler");
        sseEmit({ type: "error", error: msg });
      } finally {
        sseEnd();
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /api/uploads/:id
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/uploads/:id", async (req, reply) => {
    const upload = readUpload(req.params.id);
    if (!upload) return reply.status(404).send({ error: "Upload not found" });
    return reply
      .type(upload.meta.mediaType)
      .send(upload.data);
  });
}
