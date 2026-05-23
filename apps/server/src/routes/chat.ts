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
import { CreateChatSchema, UpdateChatSchema, PostMessageSchema, PROVIDER_LABELS } from "@ariadne/shared";
import type { PostAttachmentInput, ProviderId } from "@ariadne/shared";
import {
  dbCreateChat,
  dbListChats,
  dbGetChat,
  dbUpdateChat,
  dbDeleteChat,
  dbInsertMessage,
  dbListMessages,
  dbGetWorkspace,
  dbGetMessage,
  dbEditMessageContent,
  dbDeleteMessagesAfter,
} from "../db/repo.js";
import { loadActionDefs } from "../services/actions.js";
import { getProvider } from "../providers/index.js";
import { meteringProvider } from "../runs/engine.js";
import { getActiveSettings, isProviderConfigured } from "../config.js";
import { saveUpload, readUpload } from "../services/uploads.js";
import { buildChatContext } from "../services/chatContext.js";
import type { AttachmentRef } from "../services/chatContext.js";
import { runAgent } from "../services/agent.js";
import { extractAccountContextInBackground } from "../services/accountContext.js";
import { decideWebSearch, detectActionIntent, generateChatTitle } from "../services/triage.js";
import { resolveOllamaModel } from "../services/ollamaModels.js";
import { isOwnerOrAdmin } from "./workspaceGuard.js";
import {
  beginGeneration,
  endGeneration,
  getGenerationStatus,
  abortGeneration,
  applyEventToGeneration,
} from "../services/generations.js";
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

/** Plain-language message when the active provider has no API key. */
function noProviderKeyMessage(provider: ProviderId, locale: string | undefined): string {
  const label = PROVIDER_LABELS[provider];
  if (locale === "ko") {
    return (
      `현재 선택된 AI 제공자 '${label}'에 API 키가 설정되어 있지 않아 답변을 만들 수 없습니다.\n\n` +
      `채팅 입력창 아래 모델 메뉴에서 키가 필요 없는 **Ollama**(로컬 모델)나 **Mock**으로 바꾸거나, ` +
      `\`.env\` 파일에 해당 제공자의 API 키를 추가해 주세요.`
    );
  }
  return (
    `The selected AI provider "${label}" has no API key configured, so I can't generate a response.\n\n` +
    `Switch to a keyless provider — **Ollama** (local) or **Mock** — in the model menu below the chat box, ` +
    `or add the provider's API key to your \`.env\` file.`
  );
}

/** Turn a raw provider/SDK error into a plain-language message. */
function friendlyProviderError(err: unknown, provider: ProviderId, locale: string | undefined): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/api[\s-]?key|authentication|unauthoriz|\b401\b/i.test(raw)) {
    return noProviderKeyMessage(provider, locale);
  }
  return locale === "ko"
    ? "답변을 생성하는 중 문제가 발생했습니다. 잠시 후 다시 시도하거나, 채팅 입력창의 모델 설정을 확인해 주세요."
    : "Something went wrong while generating a response. Please try again in a moment, or check the model settings in the chat box.";
}

// ---------------------------------------------------------------------------
// Shared assistant-streaming core (used by both POST /messages and
// POST /messages/:id/regenerate)
// ---------------------------------------------------------------------------

interface StreamReplyOptions {
  chat: Chat;
  /** History BEFORE the user turn we're answering. */
  history: ChatMessage[];
  userContent: string;
  attachmentRefs: AttachmentRef[];
  webSearchMode: "on" | "off" | "auto" | undefined;
  agentMode: boolean;
  /** Used for locale + saved profile context. */
  accountLocale: string | undefined;
  accountContext: string | undefined;
  emit: (e: ChatStreamEvent) => void;
  controller: AbortController;
  assistantMsgId: string;
  /** First user turn of a chat → may auto-write a title. */
  shouldGenerateTitle: boolean;
}

interface StreamReplyResult {
  assistantContent: string;
  agentTrace: import("@ariadne/shared").AgentTrace | null;
  searchResults: SearchResult[] | null;
  generatedTitle: string | null;
}

/**
 * Run the answer pass (no-key notice / agent / streaming chat) plus the
 * conditional first-message title call. Returns what the caller needs to
 * insert the assistant message and update the chat row.
 */
async function streamAssistantReply(opts: StreamReplyOptions): Promise<StreamReplyResult> {
  const {
    chat, history, userContent, attachmentRefs, webSearchMode, agentMode,
    accountLocale, accountContext, emit, controller, assistantMsgId,
    shouldGenerateTitle,
  } = opts;

  const settings = getActiveSettings();
  const hasContent = userContent.trim().length > 0;

  let assistantContent = "";
  let agentTrace: import("@ariadne/shared").AgentTrace | null = null;
  let agentSearchResults: SearchResult[] | null = null;
  let contextSearchResults: SearchResult[] | null = null;
  let generatedTitle: string | null = null;

  if (!isProviderConfigured(settings.provider)) {
    assistantContent = noProviderKeyMessage(settings.provider, accountLocale);
    emit({ type: "delta", text: assistantContent });
    return { assistantContent, agentTrace, searchResults: null, generatedTitle: null };
  }

  const model =
    settings.provider === "ollama"
      ? await resolveOllamaModel(settings.model)
      : settings.model;
  const rawProvider = await getProvider({ provider: settings.provider, model });
  const provider = meteringProvider(rawProvider, assistantMsgId, model);

  // First-turn title generation runs in parallel with the answer, resolved
  // before we return so the caller can apply it to the chat row.
  const chatTitlePromise: Promise<string> | null = shouldGenerateTitle && hasContent
    ? generateChatTitle(provider, userContent, controller.signal).catch(() => "")
    : null;

  // Best-effort: surface a relevant workspace action as a chat suggestion.
  if (chat.workspaceId) {
    const ws = dbGetWorkspace(chat.workspaceId);
    if (ws) {
      const { actions } = loadActionDefs(ws.rootPath);
      if (actions.length > 0) {
        void detectActionIntent(provider, userContent, actions, controller.signal)
          .then((s) => {
            if (s) emit({
              type: "intent_suggestion",
              actionId: s.actionId,
              actionName: s.actionName,
              reason: s.reason,
            });
          })
          .catch(() => { /* fail-open */ });
      }
    }
  }

  if (agentMode) {
    try {
      const agentResult = await runAgent({
        chat,
        history,
        userMessage: userContent,
        provider,
        emit,
        signal: controller.signal,
        accountContext,
      });
      assistantContent = agentResult.content;
      agentTrace = agentResult.agent;
      agentSearchResults = agentResult.searchResults;
    } catch (err) {
      if (controller.signal.aborted) {
        assistantContent = "";
      } else {
        logger.warn({ chatId: chat.id, err }, "Agent loop error");
        assistantContent = friendlyProviderError(err, settings.provider, accountLocale);
        emit({ type: "delta", text: assistantContent });
      }
    }
  } else {
    const webMode = webSearchMode ?? "off";
    let webSearchInput: boolean | Promise<boolean>;
    if (webMode === "auto" && hasContent) {
      emit({ type: "status", text: "Checking whether a web search helps…" });
      webSearchInput = decideWebSearch(provider, userContent, controller.signal);
    } else {
      webSearchInput = webMode === "on";
    }

    emit({ type: "status", text: "Building context…" });
    let contextResult;
    try {
      contextResult = await buildChatContext(chat, history, {
        content: userContent,
        attachments: attachmentRefs,
        webSearch: webSearchInput,
      }, accountContext);
    } catch (err) {
      logger.warn({ chatId: chat.id, err }, "Failed to build chat context");
      contextResult = {
        system:
          "You are Ariadne's assistant — a calm, precise, local-first AI workspace assistant. " +
          "Always reply in the same language the user writes in.",
        prompt: `User: ${userContent}`,
        images: [],
        searchResults: null,
      };
    }
    contextSearchResults = contextResult.searchResults;

    emit({ type: "status", text: "Generating…" });
    try {
      const hasImages = contextResult.images.length > 0;
      if (hasImages && provider.completeWithImages) {
        const result = await provider.completeWithImages({
          system: contextResult.system,
          prompt: contextResult.prompt,
          images: contextResult.images,
          signal: controller.signal,
        });
        assistantContent = result.text;
        emit({ type: "delta", text: assistantContent });
      } else {
        await provider.completeStream(
          { system: contextResult.system, prompt: contextResult.prompt, signal: controller.signal },
          (delta) => { assistantContent += delta; emit({ type: "delta", text: delta }); },
          (status) => { emit({ type: "status", text: status }); },
        );
      }
    } catch (err) {
      if (controller.signal.aborted) {
        // Stopped by the user — keep whatever streamed so far.
      } else {
        logger.warn({ chatId: chat.id, err }, "AI provider streaming error");
        assistantContent = friendlyProviderError(err, settings.provider, accountLocale);
        emit({ type: "delta", text: assistantContent });
      }
    }
  }

  if (chatTitlePromise && assistantContent.trim()) {
    const title = await chatTitlePromise;
    if (title) generatedTitle = title;
  }

  return {
    assistantContent,
    agentTrace,
    searchResults: agentSearchResults ?? contextSearchResults,
    generatedTitle,
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // GET /api/chats
  // -------------------------------------------------------------------------
  app.get("/chats", async (req, reply) => {
    // Private by default — an account sees only its own chats; admin sees all.
    return reply.send(dbListChats().filter((c) => isOwnerOrAdmin(c.createdBy, req.account)));
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
      createdByName: req.account?.displayName ?? null,
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
    if (!isOwnerOrAdmin(chat.createdBy, req.account)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
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

      // Keep the SSE stream alive through quiet periods (agent planning, a
      // slow first token) so a proxy or tunnel never drops an idle stream.
      const heartbeat = setInterval(() => {
        try {
          raw.write(": keep-alive\n\n");
        } catch {
          // client gone
        }
      }, 15_000);

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
          webSearch: webSearch === "on",
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

        // --- Settings + generation registration ---
        const settings = getActiveSettings();
        const historyWithoutCurrent = history.filter((m) => m.id !== userMsgId);
        const assistantMsgId = newId();

        // The generation survives client disconnect; a reconnecting client
        // (or a stop request) finds it by chat id.
        const controller = new AbortController();
        const gen = beginGeneration({
          chatId: chat.id,
          messageId: assistantMsgId,
          agentMode: agentMode ?? false,
          controller,
        });
        const emit = (event: ChatStreamEvent): void => {
          applyEventToGeneration(gen, event);
          sseEmit(event);
        };

        // --- Produce the answer: delegated to the shared core ---
        const replyResult = await streamAssistantReply({
          chat,
          history: historyWithoutCurrent,
          userContent: content,
          attachmentRefs,
          webSearchMode: webSearch,
          agentMode: agentMode ?? false,
          accountLocale: req.account?.locale,
          accountContext: req.account?.context,
          emit,
          controller,
          assistantMsgId,
          shouldGenerateTitle: isFirstMessage && isDefaultTitle,
        });
        let assistantContent = replyResult.assistantContent;
        const agentTrace = replyResult.agentTrace;
        const searchResults = replyResult.searchResults;
        const generatedTitle = replyResult.generatedTitle;

        // If the user stopped before any visible output (no text, no steps),
        // leave a small marker so the turn doesn't render blank.
        if (
          controller.signal.aborted &&
          !assistantContent.trim() &&
          (agentTrace?.steps.length ?? 0) === 0
        ) {
          assistantContent = "_(stopped)_";
        }

        // --- Insert assistant message ---
        const assistantMsg: ChatMessage = {
          id: assistantMsgId,
          chatId: chat.id,
          role: "assistant",
          content: assistantContent,
          attachments: [],
          webSearch: false,
          searchResults,
          agent: agentTrace,
          createdAt: now(),
        };
        dbInsertMessage(assistantMsg);

        // Fold any durable facts from this conversation into the user's saved
        // profile — background, throttled, best-effort (never blocks the chat).
        setImmediate(() => void extractAccountContextInBackground(req.account.id, chat.id));

        // --- Bump chat updated_at (and apply the generated title, if any) ---
        dbUpdateChat(chat.id, {
          updatedAt: now(),
          ...(generatedTitle ? { title: generatedTitle } : {}),
        });

        sseEmit({ type: "done", message: assistantMsg });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ chatId: chat.id, err }, "Unexpected error in chat SSE handler");
        sseEmit({ type: "error", error: msg });
      } finally {
        clearInterval(heartbeat);
        endGeneration(chat.id);
        sseEnd();
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /api/chats/:id/messages/:messageId/regenerate  → SSE stream
  //   Edit a user message + drop the now-stale assistant reply that
  //   followed it + stream a fresh answer. The previous content goes
  //   into the message's `revisions` log so it's recoverable from the
  //   "수정됨" history popover.
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string; messageId: string }; Body: unknown }>(
    "/chats/:id/messages/:messageId/regenerate",
    async (req, reply) => {
      const chat = dbGetChat(req.params.id);
      if (!chat) return reply.status(404).send({ error: "Chat not found" });
      if (!isOwnerOrAdmin(chat.createdBy, req.account)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const existing = dbGetMessage(req.params.messageId);
      if (!existing || existing.chatId !== chat.id) {
        return reply.status(404).send({ error: "Message not found" });
      }
      if (existing.role !== "user") {
        return reply.status(400).send({ error: "Only user messages can be regenerated" });
      }
      const body = (req.body ?? {}) as {
        content?: unknown;
        webSearch?: unknown;
        agentMode?: unknown;
      };
      const nextContent =
        typeof body.content === "string" && body.content.trim()
          ? body.content.trim()
          : existing.content;
      const webSearchMode: "on" | "off" | "auto" | undefined =
        body.webSearch === "on" || body.webSearch === "off" || body.webSearch === "auto"
          ? body.webSearch
          : (existing.webSearch ? "on" : "off");
      const agentMode = Boolean(body.agentMode);

      // 1. Save the prior content (if changed) and update in place.
      let userMsg = existing;
      if (nextContent !== existing.content) {
        const edited = dbEditMessageContent(existing.id, nextContent, now());
        if (edited) userMsg = edited;
      }
      // 2. Drop every later message (assistant reply + any following turns).
      dbDeleteMessagesAfter(chat.id, userMsg.id);

      // --- SSE scaffolding (mirrors POST /messages) ---
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      function sseEmit(event: ChatStreamEvent): void {
        try { raw.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* gone */ }
      }
      function sseEnd(): void {
        try { raw.end(); } catch { /* ignore */ }
      }
      const heartbeat = setInterval(() => {
        try { raw.write(": keep-alive\n\n"); } catch { /* gone */ }
      }, 15_000);

      try {
        // Emit the (edited) user message so the client UI replaces the
        // previous bubble in place.
        sseEmit({ type: "user_message", message: userMsg });

        const assistantMsgId = newId();
        const controller = new AbortController();
        const gen = beginGeneration({
          chatId: chat.id,
          messageId: assistantMsgId,
          agentMode,
          controller,
        });
        const emit = (event: ChatStreamEvent): void => {
          applyEventToGeneration(gen, event);
          sseEmit(event);
        };

        // History BEFORE this user message (so the model answers fresh
        // rather than seeing its own prior — now-deleted — reply).
        const history = dbListMessages(chat.id).filter((m) => m.id !== userMsg.id);

        const result = await streamAssistantReply({
          chat,
          history,
          userContent: nextContent,
          attachmentRefs: [],   // attachments are tied to the original send
          webSearchMode,
          agentMode,
          accountLocale: req.account?.locale,
          accountContext: req.account?.context,
          emit,
          controller,
          assistantMsgId,
          // Title was already generated on the first send — don't redo it.
          shouldGenerateTitle: false,
        });

        let assistantContent = result.assistantContent;
        if (
          controller.signal.aborted &&
          !assistantContent.trim() &&
          (result.agentTrace?.steps.length ?? 0) === 0
        ) {
          assistantContent = "_(stopped)_";
        }

        const assistantMsg: ChatMessage = {
          id: assistantMsgId,
          chatId: chat.id,
          role: "assistant",
          content: assistantContent,
          attachments: [],
          webSearch: false,
          searchResults: result.searchResults,
          agent: result.agentTrace,
          createdAt: now(),
        };
        dbInsertMessage(assistantMsg);

        setImmediate(() => void extractAccountContextInBackground(req.account.id, chat.id));
        dbUpdateChat(chat.id, { updatedAt: now() });

        sseEmit({ type: "done", message: assistantMsg });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ chatId: chat.id, err }, "Unexpected error in regenerate SSE handler");
        sseEmit({ type: "error", error: msg });
      } finally {
        clearInterval(heartbeat);
        endGeneration(chat.id);
        sseEnd();
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/chats/:id/stop — abort an in-progress generation
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>("/chats/:id/stop", async (req, reply) => {
    abortGeneration(req.params.id);
    return reply.send({ ok: true });
  });

  // -------------------------------------------------------------------------
  // GET /api/chats/:id/active — status of an in-progress generation, if any
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/chats/:id/active", async (req, reply) => {
    return reply.send({ active: getGenerationStatus(req.params.id) });
  });

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
