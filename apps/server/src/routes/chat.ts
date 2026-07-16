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
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Chat, ChatMessage, ChatAttachment, ChatStreamEvent, SearchResult, ImageResult } from "@ariadne/shared";
import { searchImages } from "../services/imageSearch.js";
import { CreateChatSchema, UpdateChatSchema, PostMessageSchema, PROVIDER_LABELS, PROVIDER_REGISTRY } from "@ariadne/shared";
import type { PostAttachmentInput, ProviderId, ActionDef } from "@ariadne/shared";
import {
  dbCreateChat,
  dbListChats,
  dbGetChat,
  dbGetChatMeta,
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
import { getActiveSettings, getTriageSettings, isProviderConfigured, resolveEscalation } from "../config.js";
import { saveUpload, readUpload } from "../services/uploads.js";
import { buildChatContext, buildSummarizedHistory, shouldCompactHistory } from "../services/chatContext.js";
import { groundCheckVision } from "../services/groundCheck.js";
import { groundCheckNote, selfCheckNote } from "../services/groundCheckText.js";
import type { AttachmentRef } from "../services/chatContext.js";
import { makeReranker } from "../services/reranker.js";
import { runAgent } from "../services/agent.js";
import { runDeepAgent } from "../services/orchestrator.js";
import { cleanChatStagedTrees } from "../services/attempts.js";
import { extractAccountContextInBackground } from "../services/accountContext.js";
import { generateChatTitle, triage, type TriageResult } from "../services/triage.js";
import { resolveOllamaModel, listOllamaModels } from "../services/ollamaModels.js";
import { isOwnerOrAdmin, canViewWorkspaceId } from "./workspaceGuard.js";
import {
  beginGeneration,
  endGeneration,
  getGenerationStatus,
  abortGeneration,
  isGenerating,
  applyEventToGeneration,
  type LiveGeneration,
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

/** Appended to the system prompt for the revision pass of "rigorous" mode. The
 *  draft is anchored in the SAME context the answer saw, so this is GROUNDED
 *  review, not blind self-correction (which can degrade quality — 2310.01798). */
const RIGOROUS_REVISE_GUIDANCE =
  " You are now revising YOUR OWN draft answer, shown at the end of the prompt. First, silently " +
  "critique it: factual errors, claims not supported by the context above, missing steps or gaps, " +
  "weak reasoning, vagueness. Then output ONLY the improved final answer that fixes those issues — " +
  "do not show the critique, do not say it is a revision, do not apologise. Keep what was already " +
  "correct, ground every claim in the provided context, and reply in the user's language.";

/** Can the requester see/reach this chat? Owner-or-admin AND — because guests
 *  share ONE account — additionally scoped to the session that created it, so
 *  one guest can't see or reach another guest's chats. Non-guests are unaffected. */
function canAccessChat(
  chat: { createdBy: string | null; sessionId?: string | null },
  req: FastifyRequest,
): boolean {
  if (!isOwnerOrAdmin(chat.createdBy, req.account)) return false;
  if (req.account?.role === "guest") return !!chat.sessionId && chat.sessionId === req.sessionId;
  return true;
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
  agentMode: boolean | "off" | "auto" | "on" | "deep";
  /** "instant" = skip every classifier/retrieval/memory step, just stream
   *  the direct provider answer. "standard" = full pipeline. "rigorous" =
   *  full pipeline + a draft→grounded-critique→revise pass. */
  mode: "standard" | "instant" | "rigorous";
  /** Used for locale + saved profile context. */
  accountLocale: string | undefined;
  accountContext: string | undefined;
  /** Account the usage is billed to (for per-account token limits). */
  accountId: string | null;
  /** Local (loopback) session? Gates the agent's shell-spawning tools. */
  allowLocalExec: boolean;
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
  /** Image-search results when the message asked to find images. */
  images?: ImageResult[] | null;
}

/**
 * Run the answer pass (no-key notice / agent / streaming chat) plus the
 * conditional first-message title call. Returns what the caller needs to
 * insert the assistant message and update the chat row.
 */
async function streamAssistantReply(opts: StreamReplyOptions): Promise<StreamReplyResult> {
  const {
    chat, history, userContent, attachmentRefs, webSearchMode, agentMode: rawAgentMode,
    mode, accountLocale, accountContext, accountId, allowLocalExec, emit, controller, assistantMsgId,
    shouldGenerateTitle,
  } = opts;

  // Per-workspace model override (P2 configurability): a workspace can pin its
  // own provider + model for its chats. Both unset → inherit the account-global
  // default. `providers` is provider-independent, so a shallow override is safe.
  const baseSettings = getActiveSettings();
  const wsOverride = chat.workspaceId ? dbGetWorkspace(chat.workspaceId) : null;
  const settings =
    wsOverride?.defaultProvider && wsOverride.defaultModel
      ? { ...baseSettings, provider: wsOverride.defaultProvider, model: wsOverride.defaultModel }
      : baseSettings;
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
  const provider = meteringProvider(rawProvider, assistantMsgId, model, accountId, chat.workspaceId ?? null);
  // Model actually used to produce the answer — updated if difficulty-aware
  // escalation (D) bumps a hard question to a stronger model on the direct path.
  // Returned as response metadata so the UI/metering reflect what really ran.
  let producedProvider = settings.provider;
  let producedModel = model;

  // Instant mode short-circuit. Skip every upstream classifier
  // (agent, web-search, action-intent), skip workspace retrieval +
  // memory injection, send the user message straight to the provider.
  // Title generation still runs in parallel (cheap, valuable). What
  // mom needs: "ask question, get answer fast" — no warm-up status
  // lines, no multi-stage spinner.
  // Attachments are the one thing instant can't shortcut: this path never
  // reads the uploaded files (no buildChatContext) and streams without vision,
  // so an instant message with a file would silently answer "I can't see it".
  // A new no-workspace chat defaults to instant, and pasted long text becomes a
  // file — so this is easy to hit. Fall through to the standard path, which
  // parses text attachments and routes images through the vision call.
  if (mode === "instant" && hasContent && attachmentRefs.length === 0) {
    const chatTitlePromise: Promise<string> | null = shouldGenerateTitle
      ? generateChatTitle(provider, userContent, controller.signal).catch(() => "")
      : null;
    const historyText = history
      .slice(-10)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 600)}`)
      .join("\n");
    const system =
      "You are Ariadne's assistant in Instant mode — answer concisely and " +
      "directly. No preamble. Always reply in the user's language. " +
      "Don't invent specifics: if you're not sure of a name, date, or fact, say so rather than guessing.";
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
        { system, prompt, signal: controller.signal, noThink: true },
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

  // --- Tier-1 fused triage (fast tier) -------------------------------------
  // ONE provider call on the fast/cheap triage model (e.g. Gemini Flash — see
  // getTriageSettings) answers every pre-flight question the standard path
  // needs (agent loop? web search? a title? a matching workspace action?)
  // instead of 2–4 serial round-trips on the slow reasoning model. Web-search
  // triage is only consumed on the direct-answer path, so we skip asking for it
  // when the agent loop is already forced on (it runs its own searches).
  const mayAnswerDirectly =
    rawAgentMode !== "on" && rawAgentMode !== "deep" && rawAgentMode !== true;
  let triageActions: ActionDef[] = [];
  if (chat.workspaceId) {
    const ws = dbGetWorkspace(chat.workspaceId);
    if (ws) triageActions = loadActionDefs(ws.rootPath).actions;
  }
  const triageNeeds = {
    agent: rawAgentMode === "auto" && hasContent,
    webSearch: webSearchMode === "auto" && hasContent && mayAnswerDirectly,
    title: shouldGenerateTitle && hasContent,
    images: hasContent && mayAnswerDirectly,
    actions: triageActions,
    // Difficulty for escalation — only meaningful on the direct-answer path.
    hard: hasContent && mayAnswerDirectly,
  };
  let triagePromise: Promise<TriageResult | null> | null = null;
  if (triageNeeds.agent || triageNeeds.webSearch || triageNeeds.title || triageNeeds.images || triageNeeds.actions.length > 0 || triageNeeds.hard) {
    const triageSettings = getTriageSettings();
    const triageModelName =
      triageSettings.provider === "ollama"
        ? await resolveOllamaModel(triageSettings.model)
        : triageSettings.model;
    const triageProvider = meteringProvider(
      await getProvider({ provider: triageSettings.provider, model: triageModelName }),
      assistantMsgId,
      triageModelName,
      accountId,
      chat.workspaceId ?? null,
    );
    triagePromise = triage(triageProvider, userContent, triageNeeds, controller.signal).catch(() => null);
  }

  // R2 — kick off history compaction concurrently with triage. Both are
  // independent LLM calls; running them in parallel (instead of awaiting triage,
  // then compacting) keeps a long chat from paying them serially before the first
  // token. Awaited below, right before the answer needs the compacted history.
  // The digest itself must be trustworthy — a weak LOCAL chat model can blur the
  // very facts compaction exists to preserve — so when the chat runs on a local
  // provider, summarize on the (cloud) triage tier instead when one is configured.
  const compactionPromise: Promise<typeof history> | null =
    hasContent && shouldCompactHistory(history)
      ? (async () => {
          let compactor = provider;
          if (PROVIDER_REGISTRY[settings.provider]?.local) {
            const ts = getTriageSettings();
            if (ts.provider !== settings.provider && !PROVIDER_REGISTRY[ts.provider]?.local) {
              const tm = ts.provider === "ollama" ? await resolveOllamaModel(ts.model) : ts.model;
              compactor = meteringProvider(
                await getProvider({ provider: ts.provider, model: tm }),
                assistantMsgId,
                tm,
                accountId,
                chat.workspaceId ?? null,
              );
            }
          }
          return buildSummarizedHistory(history, compactor, controller.signal);
        })().catch(() => history)
      : null;

  // Web-search decision, computed once. On "auto" it rides the triage verdict (a
  // promise); buildChatContext awaits it internally, so it never blocks the
  // concurrent retrieval below.
  const webMode = webSearchMode ?? "off";
  const webSearchInput: boolean | Promise<boolean> =
    webMode === "auto" && hasContent
      ? (triagePromise ?? Promise.resolve(null)).then((t) => t?.webSearch ?? false)
      : webMode === "on";

  // TTFT — buildChatContext's retrieval (embed + rerank) depends only on the
  // query, not on triage, so start it CONCURRENTLY with triage on the direct
  // answer path instead of serially after the image-intent gate + escalation.
  // Uses the base provider's reranker (a hard verdict escalates only the ANSWER
  // model, never retrieval) and the uncompacted history (so it's reused only when
  // no compaction runs). Discarded below if the turn becomes an agent run, an
  // image search, or gets difficulty-escalated — wasted work in those minority
  // cases, a whole serial triage round-trip saved on the common one.
  const contextPrefetch =
    mayAnswerDirectly && !compactionPromise && hasContent && mode !== "instant"
      ? buildChatContext(
          chat,
          history,
          { content: userContent, attachments: attachmentRefs, webSearch: webSearchInput },
          accountContext,
          provider.id,
          model,
          makeReranker(provider),
        ).catch(() => null)
      : null;

  // Resolve agent mode: explicit on/off keeps its value; "auto" reads the triage
  // verdict and only enters the loop for multi-step prompts. Legacy boolean
  // callers (true/false) map to on/off.
  let agentMode: boolean;
  let deepMode = false;
  if (typeof rawAgentMode === "boolean") {
    agentMode = rawAgentMode;
  } else if (rawAgentMode === "deep") {
    // R4 — explicit deep mode: decompose + fan out parallel sub-agents. Implies
    // agent. Cost-aware, never auto-selected.
    deepMode = true;
    agentMode = true;
  } else if (rawAgentMode === "on") {
    agentMode = true;
  } else if (rawAgentMode === "auto" && hasContent) {
    emit({ type: "status", text: "Deciding whether to use the agent…" });
    agentMode = (await triagePromise)?.agentMode ?? false;
  } else {
    agentMode = false;
  }

  // First-turn title rides along on the same triage call; the caller applies it
  // to the chat row after the answer streams (see StreamReplyResult.titlePromise).
  const chatTitlePromise: Promise<string> | null =
    triageNeeds.title && triagePromise ? triagePromise.then((t) => t?.title ?? "") : null;

  // Image-search short-circuit — the message asked to FIND images. Return a
  // thumbnail grid (each with source/creator/license) instead of a prose
  // answer; the web UI renders it as a picker to drop into a slide. Direct-
  // answer path only (agent mode runs its own flow).
  if (!agentMode && triagePromise) {
    const t = await triagePromise;
    if (t?.images && t.imageQuery) {
      emit({ type: "status", text: "Finding images…" });
      const found = await searchImages(t.imageQuery, controller.signal).catch(() => null);
      if (found && found.results.length > 0) {
        const intro = accountLocale?.startsWith("ko")
          ? `“${t.imageQuery}” 이미지 ${found.results.length.toString()}장을 ${found.sources.join(", ")}에서 찾았어요. 슬라이드에 쓸 이미지를 고르세요 — 각 이미지에 출처·작가·라이선스가 있습니다.`
          : `Found ${found.results.length.toString()} images for “${t.imageQuery}” across ${found.sources.join(", ")}. Pick the ones for your slide — each carries its source, creator, and license.`;
        assistantContent = intro;
        emit({ type: "delta", text: intro });
        emit({ type: "images", images: found.results });
        return {
          assistantContent,
          agentTrace: null,
          searchResults: null,
          images: found.results,
          titlePromise: chatTitlePromise,
          provider: settings.provider,
          model,
        };
      }
    }
  }

  // Best-effort: surface a relevant workspace action as a chat suggestion.
  if (triageNeeds.actions.length > 0 && triagePromise) {
    void triagePromise
      .then((t) => {
        if (t?.actionIntent)
          emit({
            type: "intent_suggestion",
            actionId: t.actionIntent.actionId,
            actionName: t.actionIntent.actionName,
            reason: t.actionIntent.reason,
          });
      })
      .catch(() => { /* fail-open */ });
  }

  // R2 — compact a long history so older turns are summarized into a digest
  // instead of being silently dropped by the recent-window cap. No-op (no LLM
  // call) for short chats. Both the agent and the direct-chat path use the
  // compacted history.
  let convoHistory = history;
  if (compactionPromise) {
    emit({ type: "status", text: "Compacting earlier conversation…" });
    convoHistory = await compactionPromise;
  }

  if (agentMode) {
    try {
      const agentResult = await (deepMode ? runDeepAgent : runAgent)({
        chat,
        history: convoHistory,
        userMessage: userContent,
        provider,
        emit,
        signal: controller.signal,
        accountContext,
        webSearchMode,
        allowLocalExec,
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
    // D — difficulty-aware escalation: a hard question (per triage) on a cheap
    // or local tier is answered by a STRONGER model. Local users bump to a bigger
    // LOCAL model (free/private); cheaper-cloud users to the strong cloud rung;
    // premium models are left alone. Falls back to the user's model when nothing
    // stronger is available. Answer path only (agent path unchanged); the extra
    // model listing only runs on a hard verdict, so normal chat pays nothing.
    let answerProvider = provider;
    const triageHard = triagePromise ? (await triagePromise)?.hard ?? false : false;
    if (triageHard) {
      const esc = resolveEscalation(settings, true, await listOllamaModels().catch(() => []));
      if (esc) {
        const escModel =
          esc.provider === "ollama" ? await resolveOllamaModel(esc.model) : esc.model;
        answerProvider = meteringProvider(
          await getProvider({ provider: esc.provider, model: escModel }),
          assistantMsgId,
          escModel,
          accountId,
          chat.workspaceId ?? null,
        );
        producedProvider = esc.provider;
        producedModel = escModel;
        emit({
          type: "status",
          text: accountLocale?.startsWith("ko")
            ? "어려운 질문이라 더 강한 모델로 답변합니다…"
            : "Escalating to a stronger model for this one…",
        });
      }
    }

    // Hard questions auto-engage the two-pass draft→revise path (the manual
    // "Rigorous" pick) — so the strong model AND the self-critique compose
    // automatically on exactly the questions that need them, instead of the
    // best-quality combination existing only behind a toggle. Explicit
    // rigorous is unchanged; instant never reaches this branch.
    const effectiveMode: typeof mode = triageHard && mode === "standard" ? "rigorous" : mode;
    if (effectiveMode !== mode) {
      emit({
        type: "status",
        text: accountLocale?.startsWith("ko")
          ? "어려운 질문이라 초안을 만든 뒤 검토해 답합니다…"
          : "Hard question — drafting, then self-reviewing…",
      });
    }

    emit({ type: "status", text: "Building context…" });
    let contextResult;
    try {
      // Reuse the retrieval we kicked off alongside triage when the final params
      // still match it — i.e. no difficulty escalation (which wants the stronger
      // model's reranker/budget). Compaction was already excluded at prefetch, so
      // whenever contextPrefetch is set, convoHistory === history here.
      const prefetched =
        contextPrefetch && answerProvider === provider ? await contextPrefetch : null;
      contextResult =
        prefetched ??
        (await buildChatContext(chat, convoHistory, {
          content: userContent,
          attachments: attachmentRefs,
          webSearch: webSearchInput,
          // Reranker + attachment budget keyed to the ANSWER provider (which may be
          // the escalated one) so a stronger model gets its larger context budget.
        }, accountContext, answerProvider.id, producedModel, makeReranker(answerProvider)));
    } catch (err) {
      logger.warn({ chatId: chat.id, err }, "Failed to build chat context");
      contextResult = {
        system:
          "You are Ariadne's assistant — a calm, precise, local-first AI workspace assistant. " +
          "Always reply in the same language the user writes in.",
        prompt: `User: ${userContent}`,
        images: [],
        searchResults: null,
        contextSources: [],
        hasSources: false,
      };
    }
    contextSearchResults = contextResult.searchResults;

    // Post-answer verification note — shared by the vision / rigorous / standard
    // branches (H2, optimistic grounding). The answer already streamed (fast);
    // this appends a SHORT note only when something needs saying:
    //  • sources present → cross-check the claims against them and append a
    //    "🔎 정정" correction when a specific claim isn't supported.
    //  • no sources at all (a memory-only answer — web off/declined, no
    //    workspace/attachment material) → flag the consequential specifics worth
    //    double-checking ("확인 권장"). This was the one answer shape with ZERO
    //    verification. Annotation-only: ungrounded self-CORRECTION degrades
    //    answers (arXiv 2310.01798), so it flags, never rewrites.
    // Runs on the fast triage tier; fails safe (no note on error/abort).
    const appendVerifyNote = async (): Promise<void> => {
      if (!assistantContent.trim() || controller.signal.aborted) return;
      // Micro-answers ("네, 맞아요") aren't worth a verification round-trip.
      if (!contextResult.hasSources && assistantContent.trim().length < 60) return;
      const ko = accountLocale?.startsWith("ko");
      emit({
        type: "status",
        text: contextResult.hasSources
          ? (ko ? "출처와 대조 중…" : "Cross-checking the sources…")
          : (ko ? "핵심 사실 점검 중…" : "Double-checking key facts…"),
      });
      const vs = getTriageSettings();
      const vModel = vs.provider === "ollama" ? await resolveOllamaModel(vs.model) : vs.model;
      const verifyProvider = meteringProvider(
        await getProvider({ provider: vs.provider, model: vModel }),
        assistantMsgId,
        vModel,
        accountId,
        chat.workspaceId ?? null,
      );
      const note = contextResult.hasSources
        ? await groundCheckNote(verifyProvider, assistantContent, contextResult.prompt, controller.signal)
        : await selfCheckNote(verifyProvider, assistantContent, userContent, controller.signal);
      if (note && !controller.signal.aborted) {
        const label = contextResult.hasSources
          ? (ko ? "정정(출처 대조)" : "Correction (checked against sources)")
          : (ko ? "확인 권장 — 출처 없이 답한 부분" : "Worth verifying — answered without sources");
        const corr = `\n\n---\n🔎 **${label}:** ${note}`;
        assistantContent += corr;
        emit({ type: "delta", text: corr });
      }
    };

    emit({
      type: "status",
      text: effectiveMode === "rigorous" ? (accountLocale?.startsWith("ko") ? "초안 작성 중…" : "Drafting…") : "Generating…",
    });
    try {
      const hasImages = contextResult.images.length > 0;
      if (hasImages && answerProvider.completeWithImages) {
        const result = await answerProvider.completeWithImages({
          system: contextResult.system,
          prompt: contextResult.prompt,
          images: contextResult.images,
          signal: controller.signal,
        });
        // Structural grounding: re-read the SAME source images alongside the
        // draft and correct any claim that isn't actually visible — the
        // "invented what's in the file" failure a system prompt only nudges.
        // Best-effort + bounded; keeps the draft if the check can't run.
        emit({
          type: "status",
          text: accountLocale?.startsWith("ko") ? "이미지와 대조해 검증하는 중…" : "Verifying against the source images…",
        });
        const grounded = await groundCheckVision(
          answerProvider,
          result.text,
          contextResult.prompt,
          contextResult.images,
          controller.signal,
        );
        assistantContent = grounded ?? result.text;
        emit({ type: "delta", text: assistantContent });
        // A vision answer can also lean on TEXT sources (web results, workspace
        // excerpts) — cross-check those too; the images themselves were already
        // ground-checked above, so the no-source flag doesn't apply here.
        if (contextResult.hasSources) await appendVerifyNote();
      } else if (effectiveMode === "rigorous") {
        // Two-pass: a draft, then a grounded self-critique + single revision.
        // Bounded to one revision; the user opted into the extra latency for a
        // higher-quality answer on analysis / writing / review tasks.
        const draft = await answerProvider.complete({
          system: contextResult.system,
          prompt: contextResult.prompt,
          signal: controller.signal,
        });
        emit({
          type: "status",
          text: accountLocale?.startsWith("ko") ? "초안을 검토·수정하는 중…" : "Critiquing and revising…",
        });
        try {
          await answerProvider.completeStream(
            {
              system: contextResult.system + RIGOROUS_REVISE_GUIDANCE,
              prompt: contextResult.prompt + `\n\n--- Draft answer to critique and improve ---\n${draft.text}`,
              signal: controller.signal,
            },
            (delta) => { assistantContent += delta; emit({ type: "delta", text: delta }); },
            (status) => { emit({ type: "status", text: status }); },
          );
        } catch (err) {
          // Abort propagates to the outer handler. For any OTHER revise failure,
          // fall back to the already-produced (and already-billed) draft rather
          // than discarding it for a generic error message.
          if (controller.signal.aborted) throw err;
          if (!assistantContent.trim()) {
            assistantContent = draft.text;
            emit({ type: "delta", text: assistantContent });
          }
        }
        // Rigorous answers get the same post-answer verification the standard
        // path has — the revise pass critiques reasoning, not source fidelity.
        await appendVerifyNote();
      } else {
        await answerProvider.completeStream(
          { system: contextResult.system, prompt: contextResult.prompt, signal: controller.signal },
          (delta) => { assistantContent += delta; emit({ type: "delta", text: delta }); },
          (status) => { emit({ type: "status", text: status }); },
        );
        // Cross-check against sources, or flag memory-only specifics — see
        // appendVerifyNote above.
        await appendVerifyNote();
      }
      // Surface the workspace files behind the answer — symmetric with the web
      // search sources the UI already shows. Only when retrieval actually fed
      // excerpts and a real answer streamed (abort/error throw past this point).
      if (contextResult.contextSources.length > 0 && assistantContent.trim()) {
        const label = accountLocale?.startsWith("ko") ? "참고한 파일" : "Sources";
        const footer = `\n\n*${label}: ${contextResult.contextSources.join(", ")}*`;
        assistantContent += footer;
        emit({ type: "delta", text: footer });
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
    provider: producedProvider,
    model: producedModel,
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
    return reply.send(dbListChats().filter((c) => canAccessChat(c, req)));
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
    // Don't let a chat be created against a workspace the account can't view
    // (or one that doesn't exist) — that reference is what the answer path
    // trusts when it loads workspace files.
    if (!canViewWorkspaceId(workspaceId, req.account)) {
      return reply.status(403).send({ error: "Forbidden", detail: "That workspace doesn't exist or isn't yours." });
    }
    const ts = now();
    const chat: Chat = {
      id: newId(),
      title: title?.trim() || "New chat",
      workspaceId: workspaceId ?? null,
      createdBy: req.account?.id ?? null,
      createdByName: req.account?.displayName ?? null,
      sessionId: req.sessionId ?? null,
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
    if (!canAccessChat(chat, req)) {
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
    if (!canAccessChat(existing, req)) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const parsed = UpdateChatSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", detail: parsed.error.message });
    }
    // Re-point only to a workspace the account can view (undefined = no change).
    if (!canViewWorkspaceId(parsed.data.workspaceId, req.account)) {
      return reply.status(403).send({ error: "Forbidden", detail: "That workspace doesn't exist or isn't yours." });
    }

    const updated = dbUpdateChat(req.params.id, {
      title: parsed.data.title,
      workspaceId: parsed.data.workspaceId,
      sortOrder: parsed.data.sortOrder,
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
    if (!canAccessChat(existing, req)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    // Wipe the attempts' on-disk staged trees BEFORE the rows are gone.
    cleanChatStagedTrees(req.params.id);
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
      if (!canAccessChat(chat, req)) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      // A chat may only carry a workspace its owner can view. The context
      // builder and triage load the workspace by id (dbGetWorkspace) with no
      // gate of their own, so without this check anyone who can set a chat's
      // workspaceId (POST/PATCH below) could point their own chat at someone
      // else's private workspace and read its files through the answer.
      // Re-checked every message so a workspace flipped public→private after
      // the chat was created stops leaking on the next turn.
      if (!canViewWorkspaceId(chat.workspaceId, req.account)) {
        return reply.status(403).send({ error: "Forbidden", detail: "This chat's workspace isn't accessible to you." });
      }

      const parsed = PostMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid request body",
          detail: parsed.error.message,
        });
      }

      const { content, attachments: rawAttachments, webSearch, agentMode, mode: rawMode } = parsed.data;
      const mode: "standard" | "instant" | "rigorous" =
        rawMode === "instant" ? "instant" : rawMode === "rigorous" ? "rigorous" : "standard";

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

      // One generation per chat. Without this, a second concurrent message would
      // overwrite the first's registry entry — orphaning its abort controller
      // (Stop can no longer reach it) and corrupting /active status.
      if (isGenerating(chat.id)) {
        return reply.status(409).send({ error: "This chat is already generating a reply." });
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

      // Hoisted so the finally can identity-guard the registry cleanup.
      let genRef: LiveGeneration | undefined;

      try {
        // --- Save attachments to disk and build ChatAttachment[] ---
        const chatAttachments: ChatAttachment[] = [];
        const attachmentRefs: AttachmentRef[] = [];

        if (rawAttachments) {
          for (const att of rawAttachments as PostAttachmentInput[]) {
            const uploadId = newId();
            const meta = saveUpload(uploadId, att.name, att.mediaType, att.dataBase64, req.account?.id);
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
          images: null,
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
        const willDefinitelyAgent = agentMode === true || agentMode === "on" || agentMode === "deep";
        const controller = new AbortController();
        const gen = beginGeneration({
          chatId: chat.id,
          messageId: assistantMsgId,
          agentMode: willDefinitelyAgent,
          controller,
        });
        genRef = gen;
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
          // Guests are read + chat only — never the plan-execute agent (which
          // can run shell/tests/edits). Downgrade to a plain chat answer.
          agentMode: req.account?.role === "guest" ? "off" : (agentMode ?? false),
          mode,
          accountId: req.account?.id ?? null,
          accountLocale: req.account?.locale,
          accountContext: req.account?.context,
          allowLocalExec: req.accessContext === "local",
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
          images: replyResult.images ?? null,
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
          createAlert(req.account.id, "chat_completed", chat.title?.trim() || "New chat", "Agent task complete", `/chat/${chat.id}`);
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
        if (genRef) endGeneration(chat.id, genRef);
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
      if (!canAccessChat(chat, req)) {
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
      const agentMode: boolean | "off" | "auto" | "on" | "deep" =
        body.agentMode === "on" || body.agentMode === "off" || body.agentMode === "auto" || body.agentMode === "deep"
          ? body.agentMode
          : Boolean(body.agentMode);
      const willDefinitelyAgent = agentMode === true || agentMode === "on" || agentMode === "deep";

      // 1. Save the prior content (if changed) and update in place.
      let userMsg = existing;
      if (nextContent !== existing.content) {
        const edited = dbEditMessageContent(existing.id, nextContent, now());
        if (edited) userMsg = edited;
      }
      // One generation per chat (see POST /messages) — guard before touching
      // the registry so a concurrent regenerate can't orphan a live controller.
      if (isGenerating(chat.id)) {
        return reply.status(409).send({ error: "This chat is already generating a reply." });
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

      // Hoisted so the finally can identity-guard the registry cleanup.
      let genRef: LiveGeneration | undefined;

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
        genRef = gen;
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
          // Guests are read + chat only — never the plan-execute agent.
          agentMode: req.account?.role === "guest" ? "off" : agentMode,
          // Regenerate doesn't surface a mode picker — re-run with the
          // standard pipeline. (If we later thread the mode through
          // regenerate too, change here.)
          mode: "standard",
          accountId: req.account?.id ?? null,
          accountLocale: req.account?.locale,
          accountContext: req.account?.context,
          allowLocalExec: req.accessContext === "local",
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
          images: result.images ?? null,
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
        if (genRef) endGeneration(chat.id, genRef);
        sseEnd();
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/chats/:id/stop — abort an in-progress generation
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>("/chats/:id/stop", async (req, reply) => {
    const chat = dbGetChat(req.params.id);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    if (!canAccessChat(chat, req)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    abortGeneration(req.params.id);
    return reply.send({ ok: true });
  });

  // -------------------------------------------------------------------------
  // GET /api/chats/:id/active — status of an in-progress generation, if any
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/chats/:id/active", async (req, reply) => {
    // Polled every 2s — only the in-memory generation status is needed, so guard
    // with metadata only instead of dbGetChat (which would re-load + JSON-parse
    // the whole message list on every poll, competing with the streaming worker).
    const meta = dbGetChatMeta(req.params.id);
    if (!meta) return reply.status(404).send({ error: "Chat not found" });
    if (!canAccessChat(meta, req)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    return reply.send({ active: getGenerationStatus(req.params.id) });
  });

  // -------------------------------------------------------------------------
  // GET /api/uploads/:id
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/uploads/:id", async (req, reply) => {
    const upload = readUpload(req.params.id);
    if (!upload) return reply.status(404).send({ error: "Upload not found" });
    // Ownership: only the uploader (or an admin) may fetch it. Uploads saved
    // before this field existed have no accountId and stay readable (they're
    // UUID-keyed, not enumerable) — but new ones are owner-scoped.
    if (
      upload.meta.accountId &&
      upload.meta.accountId !== req.account?.id &&
      req.account?.role !== "admin"
    ) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    // Never let an uploader-chosen Content-Type render as active same-origin
    // content. Inline only inert raster images + PDF; force everything else
    // (text/html, image/svg+xml, …) to download as an opaque blob. nosniff
    // stops the browser re-interpreting the bytes as HTML.
    reply.header("X-Content-Type-Options", "nosniff");
    const SAFE_INLINE = new Set([
      "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf",
    ]);
    if (SAFE_INLINE.has(upload.meta.mediaType)) {
      return reply.type(upload.meta.mediaType).send(upload.data);
    }
    return reply
      .type("application/octet-stream")
      .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(upload.meta.name)}`)
      .send(upload.data);
  });
}
