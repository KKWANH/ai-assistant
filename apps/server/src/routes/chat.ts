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
  dbDeleteEmptyChats,
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
import { createAlert } from "../services/alerts.js";
import { accountOverLimit } from "../services/limits.js";
import { getActiveSettings, isProviderConfigured } from "../config.js";
import { saveUpload, readUpload } from "../services/uploads.js";
import { buildChatContext, buildSummarizedHistory, shouldCompactHistory } from "../services/chatContext.js";
import type { AttachmentRef } from "../services/chatContext.js";
import { runAgent } from "../services/agent.js";
import { extractAccountContextInBackground } from "../services/accountContext.js";
import { decideWebSearch, decideAgentMode, detectActionIntent, generateChatTitle } from "../services/triage.js";
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
  // 401 / auth failures split into two cases:
  //   (a) NO key configured at all → use the "set up a key" message.
  //   (b) Key IS configured but provider rejected it → distinct "key
  //       was rejected, check it's valid" message. Without this split,
  //       a typo'd key shows "no API key configured" which sends the
  //       user looking in the wrong place.
  if (/api[\s-]?key|authentication|unauthoriz|\b401\b/i.test(raw)) {
    if (!isProviderConfigured(provider)) {
      return noProviderKeyMessage(provider, locale);
    }
    const label = PROVIDER_LABELS[provider];
    return locale === "ko"
      ? `'${label}' API 키가 거부되었습니다 (401 Invalid Authentication). \`.env\` 파일의 키 값이 정확한지, 만료되지 않았는지 확인하시고 서버를 재시작해 주십시오.`
      : `The "${label}" API key was rejected (401 Invalid Authentication). Check the key value in your \`.env\` is correct and not expired, then restart the server.`;
  }
  return locale === "ko"
    ? "답변을 생성하는 중 문제가 발생했습니다. 잠시 후 다시 시도하거나, 채팅 입력창의 모델 설정을 확인해 주십시오."
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
  /** boolean for legacy callers; tri-state for explicit auto-classifier opt-in. */
  agentMode: boolean | "off" | "auto" | "on";
  /** "instant" = skip every classifier/retrieval/memory step, just stream
   *  the direct provider answer. "standard" = full pipeline. */
  mode: "standard" | "instant";
  /** Used for locale + saved profile context. */
  accountLocale: string | undefined;
  accountContext: string | undefined;
  /** Account the usage is billed to (for per-account token limits). */
  accountId: string | null;
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
  /** Resolves to the auto-generated title (or "" if disabled / failed).
   *  Returned UNRESOLVED so the caller can emit `done` immediately and
   *  apply the title asynchronously — previously this was awaited
   *  inline and the spinner persisted for the title-call duration. */
  titlePromise: Promise<string> | null;
  /** Provider/model that produced this response. Null if the answer came
   *  from the no-key notice path (no provider was actually called). */
  provider: string | null;
  model: string | null;
}

/**
 * Run the answer pass (no-key notice / agent / streaming chat) plus the
 * conditional first-message title call. Returns what the caller needs to
 * insert the assistant message and update the chat row.
 */
async function streamAssistantReply(opts: StreamReplyOptions): Promise<StreamReplyResult> {
  const {
    chat, history, userContent, attachmentRefs, webSearchMode, agentMode: rawAgentMode,
    mode, accountLocale, accountContext, accountId, emit, controller, assistantMsgId,
    shouldGenerateTitle,
  } = opts;

  const settings = getActiveSettings();
  const hasContent = userContent.trim().length > 0;

  let assistantContent = "";
  let agentTrace: import("@ariadne/shared").AgentTrace | null = null;
  let agentSearchResults: SearchResult[] | null = null;
  let contextSearchResults: SearchResult[] | null = null;

  if (!isProviderConfigured(settings.provider)) {
    assistantContent = noProviderKeyMessage(settings.provider, accountLocale);
    emit({ type: "delta", text: assistantContent });
    return {
      assistantContent,
      agentTrace,
      searchResults: null,
      titlePromise: null,
      provider: null,
      model: null,
    };
  }

  const model =
    settings.provider === "ollama"
      ? await resolveOllamaModel(settings.model)
      : settings.model;
  const rawProvider = await getProvider({ provider: settings.provider, model });
  const provider = meteringProvider(rawProvider, assistantMsgId, model, accountId);

  // Instant mode short-circuit. Skip every upstream classifier
  // (agent, web-search, action-intent), skip workspace retrieval +
  // memory injection, send the user message straight to the provider.
  // Title generation still runs in parallel (cheap, valuable). What
  // mom needs: "ask question, get answer fast" — no warm-up status
  // lines, no multi-stage spinner.
  if (mode === "instant" && hasContent) {
    const chatTitlePromise: Promise<string> | null = shouldGenerateTitle
      ? generateChatTitle(provider, userContent, controller.signal).catch(() => "")
      : null;
    const historyText = history
      .slice(-10)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 600)}`)
      .join("\n");
    const system =
      "You are Ariadne's assistant in Instant mode — answer concisely and " +
      "directly. No preamble. Always reply in the user's language.";
    const prompt = historyText
      ? `${historyText}\nUser: ${userContent}`
      : `User: ${userContent}`;
    // Instant mode intentionally emits zero status pre-roll — that's
    // the whole point. But on a cold local model the user sees nothing
    // for 10+ seconds. If no delta has arrived in 3s, emit ONE
    // "warming up" status so the user knows the request is alive.
    let firstDeltaSeen = false;
    const warmupTimer = setTimeout(() => {
      if (!firstDeltaSeen && !controller.signal.aborted) {
        emit({ type: "status", text: "Warming up the model…" });
      }
    }, 3_000);
    try {
      await provider.completeStream(
        { system, prompt, signal: controller.signal },
        (delta) => {
          if (!firstDeltaSeen) {
            firstDeltaSeen = true;
            clearTimeout(warmupTimer);
          }
          assistantContent += delta;
          emit({ type: "delta", text: delta });
        },
        (status) => { emit({ type: "status", text: status }); },
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        logger.warn({ chatId: chat.id, err }, "Instant-mode provider error");
        assistantContent = friendlyProviderError(err, settings.provider, accountLocale);
        emit({ type: "delta", text: assistantContent });
      }
    } finally {
      clearTimeout(warmupTimer);
    }
    return {
      assistantContent,
      agentTrace: null,
      searchResults: null,
      titlePromise: chatTitlePromise,
      provider: settings.provider,
      model,
    };
  }

  // Resolve agent mode: explicit on/off keeps its value; "auto" runs a
  // cheap classifier and only enters the loop for multi-step prompts.
  // Legacy boolean callers (true/false) map to on/off.
  let agentMode: boolean;
  if (typeof rawAgentMode === "boolean") {
    agentMode = rawAgentMode;
  } else if (rawAgentMode === "on") {
    agentMode = true;
  } else if (rawAgentMode === "auto" && hasContent) {
    emit({ type: "status", text: "Deciding whether to use the agent…" });
    agentMode = await decideAgentMode(provider, userContent, controller.signal);
  } else {
    agentMode = false;
  }

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

  // R2 — compact a long history so older turns are summarized into a digest
  // instead of being silently dropped by the recent-window cap. No-op (no LLM
  // call) for short chats. Both the agent and the direct-chat path use the
  // compacted history.
  let convoHistory = history;
  if (hasContent && shouldCompactHistory(history)) {
    emit({ type: "status", text: "Compacting earlier conversation…" });
    convoHistory = await buildSummarizedHistory(history, provider, controller.signal);
  }

  if (agentMode) {
    try {
      const agentResult = await runAgent({
        chat,
        history: convoHistory,
        userMessage: userContent,
        provider,
        emit,
        signal: controller.signal,
        accountContext,
        webSearchMode,
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
      contextResult = await buildChatContext(chat, convoHistory, {
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

  // Title generation runs in parallel with the answer (kicked off above).
  // We DON'T await it here — see StreamReplyResult.titlePromise for the
  // contract. The caller emits `done` immediately on stream end and
  // applies the title to the DB asynchronously, eliminating the
  // post-stream spinner lag.

  return {
    assistantContent,
    agentTrace,
    searchResults: agentSearchResults ?? contextSearchResults,
    titlePromise: chatTitlePromise,
    provider: settings.provider,
    model,
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
  // AT/AU — DELETE /api/chats/empty — bulk-delete chats with zero messages.
  //         Scoped to the requesting account. Optional ?olderHours= filter
  //         restricts deletion to chats older than N hours (default 0 = all).
  // -------------------------------------------------------------------------
  app.delete<{ Querystring: { olderHours?: string } }>("/chats/empty", async (req, reply) => {
    const ownerId = req.account?.id ?? null;
    const olderHours = Number(req.query.olderHours) || 0;
    const deleted = dbDeleteEmptyChats(ownerId, olderHours);
    return reply.send({ ok: true, deleted });
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

      const { content, attachments: rawAttachments, webSearch, agentMode, mode: rawMode } = parsed.data;
      const mode: "standard" | "instant" = rawMode === "instant" ? "instant" : "standard";

      // Reject if both content is empty and no attachments
      const hasContent = content.trim().length > 0;
      const hasAttachments = rawAttachments && rawAttachments.length > 0;
      if (!hasContent && !hasAttachments) {
        return reply.status(400).send({ error: "Message must have content or at least one attachment" });
      }

      // Per-account token limit — block a new message once over the cap (the
      // test account + the shared guest have one; everyone else is unlimited).
      if (req.account && accountOverLimit(req.account.id)) {
        return reply.status(429).send({
          error: "You've reached your token limit. New messages are paused until your usage window resets.",
        });
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
            attachmentRefs.push({ uploadId, useMarkdown: att.useMarkdown });
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
        // (or a stop request) finds it by chat id. For "auto" we don't yet
        // know whether the agent will actually run — default to false; the
        // client learns by watching for agent_plan events on the SSE stream.
        const willDefinitelyAgent = agentMode === true || agentMode === "on";
        const controller = new AbortController();
        const gen = beginGeneration({
          chatId: chat.id,
          messageId: assistantMsgId,
          agentMode: willDefinitelyAgent,
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
          mode,
          accountId: req.account?.id ?? null,
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
        const titlePromise = replyResult.titlePromise;
        const replyProvider = replyResult.provider;
        const replyModel = replyResult.model;

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
          provider: replyProvider,
          model: replyModel,
          createdAt: now(),
        };
        dbInsertMessage(assistantMsg);

        // Agent runs can take a while and the user may navigate away — leave a
        // bell notification when one finishes. Plain instant/standard replies
        // aren't alerted (they're watched live as they stream).
        if (agentTrace && agentTrace.steps.length > 0) {
          createAlert(req.account.id, "chat_completed", "Agent task complete", null, `/chat/${chat.id}`);
        }

        // Fold any durable facts from this conversation into the user's saved
        // profile — background, throttled, best-effort (never blocks the chat).
        setImmediate(() => void extractAccountContextInBackground(req.account.id, chat.id));

        // Bump chat updated_at NOW (before done) so the sidebar reorders
        // the chat to the top immediately. Title is applied separately
        // — see below — so we don't block done on title generation.
        dbUpdateChat(chat.id, { updatedAt: now() });

        sseEmit({ type: "done", message: assistantMsg });

        // Resolve the auto-title AFTER `done` — the spinner has already
        // cleared on the client. We hold the SSE stream open up to 2s
        // longer to deliver the title via chat_updated; if the title
        // model is slower than that we fall through to a background DB
        // write and the title shows up on the sidebar's next refetch.
        if (titlePromise) {
          const racedTitle = await Promise.race([
            titlePromise,
            new Promise<string>((resolve) => setTimeout(() => resolve(""), 2_000)),
          ]).catch(() => "");
          if (racedTitle) {
            dbUpdateChat(chat.id, { title: racedTitle, updatedAt: now() });
            sseEmit({ type: "chat_updated", chatId: chat.id, title: racedTitle });
          } else {
            // Title still pending past the SSE-keepalive budget. Let it
            // resolve in the background; the next sidebar refetch picks
            // it up.
            void titlePromise
              .then((t) => { if (t) dbUpdateChat(chat.id, { title: t, updatedAt: now() }); })
              .catch((err: unknown) => {
                logger.warn({ err, chatId: chat.id }, "Async title generation failed");
              });
          }
        }
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
      const agentMode: boolean | "off" | "auto" | "on" =
        body.agentMode === "on" || body.agentMode === "off" || body.agentMode === "auto"
          ? body.agentMode
          : Boolean(body.agentMode);
      const willDefinitelyAgent = agentMode === true || agentMode === "on";

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
          agentMode: willDefinitelyAgent,
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
          // Regenerate doesn't surface a mode picker — re-run with the
          // standard pipeline. (If we later thread the mode through
          // regenerate too, change here.)
          mode: "standard",
          accountId: req.account?.id ?? null,
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
          provider: result.provider,
          model: result.model,
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
