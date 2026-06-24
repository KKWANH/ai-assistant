/**
 * Chat context builder.
 *
 * Assembles the system prompt + user turn that the AI provider receives for a
 * chat completion.  Logic:
 *
 *   1. Parse every file attachment to text (reuse focusedReadFileAsync).
 *      Collect image attachments as ProviderImage[] for vision calls.
 *   2. If webSearch is requested, run performSearch and embed results in the
 *      context text.
 *   3. If the chat has a workspaceId, load the latest snapshot and embed a
 *      compact manifest summary (path + headings/keys + token estimate).
 *   4. Render the last ≤20 messages (~8 k chars) as conversation history.
 *   5. Return { system, prompt, images, searchResults }.
 */

import fs from "node:fs";
import path from "node:path";
import type { Chat, ChatMessage, SearchResult, FileMeta } from "@ariadne/shared";
import { modelHasVision } from "@ariadne/shared";
import { PATHS } from "../config.js";
import type { AiProvider, ProviderImage } from "../providers/index.js";
import { safeResolveUnderRoot } from "../security/pathGuard.js";
import { tryParseDocument } from "./safeParse.js";
import { dbGetLatestSnapshot, dbGetWorkspace, dbListMcpServers } from "../db/repo.js";
import { performSearch, fetchUrlText } from "./search.js";
import { readUpload, resolveUploadPath } from "./uploads.js";
import { renderPdfPages } from "./pdfScreenshot.js";
import { LO_FORMATS, convertToPdfCached, getLibreofficeStatus } from "./libreoffice.js";
import logger from "../logger.js";
import { retrieveRelevantChunks, formatChunksForPrompt, isRetrievalEligible, extractRelevantWithinBudget, extractRelevantWithinBudgetSemantic, type RerankFn } from "./retrieval.js";
import { listMemories, renderMemoryForPrompt } from "./workspaceMemory.js";
import { getWorkspaceContext, renderContextForPrompt } from "./workspaceContext.js";
import { loadWorkspaceActions } from "./actions.js";
import { loadHooks } from "./hooks.js";

// Per-provider budget (chars) for attached-document text — ~4 chars ≈ 1 token.
// The old flat 4 000-char cap truncated a real document (a paper, a thesis) to
// its first page, so the model only ever received the title + table of contents
// and could never review the body. Hosted models hold a whole document; local
// models have smaller context windows, so they get a conservative budget. The
// budget is shared across all attachments in one message.
const ATTACHMENT_BUDGET_BY_PROVIDER: Record<string, number> = {
  gemini: 600_000, // ~1M-token context
  anthropic: 180_000, // ~200k
  moonshot: 200_000, // ~256k
  minimax: 200_000,
  openai: 120_000, // ~128k
  ollama: 24_000, // local — modest default context window
  vllm: 24_000,
  mock: 4_000,
};
const DEFAULT_ATTACHMENT_BUDGET = 24_000;

// Vision: how many pages of a page-based attachment (PDF, or Office file
// converted to PDF) to render as images for a vision-capable model, and the
// hard cap across ALL attachments in one message — bounds render time and
// request size. A typical lecture deck (~25 slides) fits under the cap; larger
// files are truncated and the model is told so in the attachment note.
const VISION_PAGE_CAP = 30;
const VISION_MAX_TOTAL_IMAGES = 40;

// ---------------------------------------------------------------------------
// Public return type
// ---------------------------------------------------------------------------

export interface ChatContextResult {
  system: string;
  prompt: string;
  images: ProviderImage[];
  searchResults: SearchResult[] | null;
  /** Distinct workspace files whose excerpts were fed to the model this turn —
   *  surfaced to the user as a "referenced files" footer so a chat answer over
   *  a folder shows what it drew on (the web-search path already exposes its
   *  sources via searchResults; this is the symmetric workspace-file signal). */
  contextSources: string[];
}

/** Append the user's saved profile to a system prompt (no-op when empty). */
export function appendUserProfile(system: string, accountContext: string | undefined): string {
  const c = accountContext?.trim();
  if (!c) return system;
  return (
    system +
    "\n\nAbout the user (their saved profile — use it to personalise your replies; " +
    "do not quote it back verbatim):\n" +
    c
  );
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export async function buildChatContext(
  chat: Chat,
  history: ChatMessage[],
  userMessage: {
    content: string;
    attachments?: AttachmentRef[];
    /**
     * Whether to include a live web search in the context. Can be a Promise
     * so the caller can fire a parallel "should I search?" classifier and let
     * the slow I/O (attachment parsing, workspace files) overlap with it —
     * the original sequential `await decide → await build` cost 300–600ms.
     */
    webSearch?: boolean | Promise<boolean>;
  },
  accountContext?: string,
  /** Active provider id — picks the attachment text budget (a 1M-context model
   *  can hold a whole document; a local model can't). */
  providerId?: string,
  /** Active model id. When it's vision-capable, page-based attachments (PDF, or
   *  Office files convertible to PDF) are ALSO rendered to images so the model
   *  sees the actual slides/figures/artwork — text extraction alone drops every
   *  embedded image (why "describe the artworks in this PDF" used to fail). */
  model?: string,
  /** Optional second-pass reranker (built from the active provider). Applied
   *  to workspace retrieval only for substantive queries — see the gate at the
   *  retrieval call below. Unset → retrieval is unchanged. */
  rerank?: RerankFn,
): Promise<ChatContextResult> {
  // Resolve the web-search promise (or boolean) at the latest possible
  // moment, so attachment parsing and workspace-snapshot I/O run in parallel
  // with it. The actual search call still happens later, inline at its slot.
  const webSearchPromise: Promise<boolean> =
    userMessage.webSearch instanceof Promise
      ? userMessage.webSearch
      : Promise.resolve(Boolean(userMessage.webSearch));

  const images: ProviderImage[] = [];
  let attachmentBlock: string | undefined;
  let webBlock: string | undefined;
  let memoryBlock: string | undefined;
  let projectContextBlock: string | undefined;
  let workspaceMetaBlock: string | undefined;
  let workspaceBlock: string | undefined;
  let historyBlock: string | undefined;
  let searchResults: SearchResult[] | null = null;
  let contextSources: string[] = [];

  // 1. Attached files / images. Carry the most recent attachment forward when
  //    THIS turn has none — so a multi-turn "analyse this document" conversation
  //    keeps the document instead of losing it after the first question (the
  //    user shouldn't have to re-attach the file on every follow-up).
  let effectiveAttachments = userMessage.attachments;
  if (!effectiveAttachments || effectiveAttachments.length === 0) {
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (h?.role === "user" && h.attachments && h.attachments.length > 0) {
        effectiveAttachments = h.attachments.map((a) => ({ uploadId: a.id, useMarkdown: false }));
        break;
      }
    }
  }
  if (effectiveAttachments && effectiveAttachments.length > 0) {
    const fileParts: string[] = [];
    // Shared budget across all attachments in this message (see the per-provider
    // table). The first file may use the whole budget; later files get the rest.
    let budget = ATTACHMENT_BUDGET_BY_PROVIDER[providerId ?? ""] ?? DEFAULT_ATTACHMENT_BUDGET;
    for (const att of effectiveAttachments) {
      const upload = readUpload(att.uploadId);
      if (!upload) continue;

      if (upload.meta.kind === "image") {
        images.push({
          mediaType: upload.meta.mediaType,
          dataBase64: upload.data.toString("base64"),
        });
      } else {
        // Parse the file to text. AY — when the user toggled "send as
        // markdown" and markitdown is installed, route through it for
        // structure-preserving extraction.
        const text = await parseUploadedFile(upload.data, upload.meta.name, att.uploadId, !!att.useMarkdown);
        const overBudget = text.length > budget;
        // Over budget: don't head-truncate (that keeps the title/TOC and drops
        // the body). Keep the excerpts most relevant to THIS question, in
        // document order — semantic (embedding) ranking when an embedder is
        // available (catches conceptual matches), else keyword. Within budget:
        // send the whole file unchanged.
        let capped = text;
        if (overBudget) {
          const extracted =
            (await extractRelevantWithinBudgetSemantic(text, userMessage.content, budget)) ??
            extractRelevantWithinBudget(text, userMessage.content, budget);
          capped =
            extracted +
            "\n[...trimmed to the most relevant excerpts — file exceeds the model's context budget...]";
        }
        // An over-budget file consumes the remaining budget; a fitting one
        // leaves the rest for any later attachments in the same message.
        budget = overBudget ? 0 : Math.max(0, budget - text.length);
        fileParts.push(`--- Attached file: ${upload.meta.name} ---\n${capped}`);

        // Vision: text extraction drops every embedded image, so for page-based
        // documents ALSO render the pages and hand them to a vision model — it
        // can then analyse the actual slides / figures / artwork (e.g. "identify
        // each painting in this exam") instead of replying "there are no images."
        // Best-effort: any failure leaves the extracted text we just pushed.
        if (model && modelHasVision(model) && images.length < VISION_MAX_TOTAL_IMAGES) {
          const ext = (upload.meta.name.split(".").pop() ?? "").toLowerCase();
          try {
            let pdfPath: string | null = null;
            if (ext === "pdf") {
              pdfPath = resolveUploadPath(att.uploadId);
            } else if (LO_FORMATS.has(`.${ext}`) && getLibreofficeStatus().available) {
              const src = resolveUploadPath(att.uploadId);
              if (src) pdfPath = await convertToPdfCached(PATHS.home, src);
            }
            if (pdfPath) {
              const cap = Math.min(VISION_PAGE_CAP, VISION_MAX_TOTAL_IMAGES - images.length);
              const { pages, totalPages } = await renderPdfPages(pdfPath, { maxPages: cap });
              for (const pg of pages) {
                images.push({ mediaType: "image/png", dataBase64: pg.buffer.toString("base64") });
              }
              if (pages.length > 0) {
                fileParts.push(
                  totalPages > pages.length
                    ? `[Rendered the first ${pages.length} of ${totalPages} pages of "${upload.meta.name}" as images for visual analysis — pages ${pages.length + 1}–${totalPages} were omitted to fit limits.]`
                    : `[Rendered all ${pages.length} page(s) of "${upload.meta.name}" as images for visual analysis.]`,
                );
              }
            }
          } catch (err) {
            logger.warn({ name: upload.meta.name, err: String(err) }, "attachment page-render for vision failed — using extracted text only");
          }
        }
      }
    }
    if (fileParts.length > 0) {
      attachmentBlock = fileParts.join("\n\n");
    }
  }

  // 2. Web search — kick off as soon as the decision resolves, but DO
  //    NOT await it here. The actual HTTP round-trip runs in parallel
  //    with the workspace I/O below; we await the result at the end,
  //    just before assembling the final context block. This saves the
  //    full search latency (typically 200–600ms with Tavily/Brave) when
  //    a workspace chat also needs to read files.
  const wantsWebSearch = await webSearchPromise;
  type SearchOk = Awaited<ReturnType<typeof performSearch>>;
  const searchPromise: Promise<SearchOk | null> =
    wantsWebSearch && userMessage.content.trim()
      ? performSearch(userMessage.content.trim()).catch(() => null)
      : Promise.resolve(null);

  // 3. Workspace context — file index + inline content of key files
  if (chat.workspaceId) {
    // Memory comes BEFORE retrieval chunks so the model sees the user's
    // confirmed facts and preferences first. Empty workspace → null →
    // no block, no padding.
    const ws = dbGetWorkspace(chat.workspaceId);
    if (ws) {
      // Read memories once; used twice (full text for the block, count
      // for the workspace-meta preamble). Each call scans the memories
      // dir, so the prior double-call burned a directory walk per
      // message.
      const wsMemories = listMemories(ws.rootPath);
      memoryBlock = renderMemoryForPrompt(wsMemories) ?? undefined;
      // User-authored project context — their standing brief for this
      // workspace. Sits above memory: instructions first, then facts.
      projectContextBlock = renderContextForPrompt(getWorkspaceContext(ws.rootPath)) ?? undefined;
      // Workspace meta — answers "이 프로젝트 설정 알려줘" / "이 폴더에
      // 메모리 몇 개 있어?" type questions without needing a tool call.
      // Cheap to compute (all local DB / .ariadne reads) so always
      // included when a workspace is attached. Counts only — full
      // memory text already in memoryBlock, full hooks YAML is too
      // long for this preamble.
      const memCount = wsMemories.length;
      const { actions } = loadWorkspaceActions(ws.rootPath);
      const hooks = loadHooks(ws.rootPath);
      const mcpServers = chat.createdBy
        ? dbListMcpServers(chat.createdBy).filter((s) => s.enabled)
        : [];
      const scanLine = ws.lastScanAt
        ? `last scanned ${ws.lastScanAt}`
        : "never scanned";
      workspaceMetaBlock =
        `--- Workspace settings ("${ws.name}") ---\n` +
        `Root: ${ws.rootPath}\n` +
        `Files indexed: ${ws.fileCount.toString()} (${scanLine})\n` +
        `Memories: ${memCount.toString()}\n` +
        `Custom actions: ${actions.length.toString()}` +
        (actions.length > 0 ? ` (${actions.slice(0, 5).map((a) => a.id).join(", ")}${actions.length > 5 ? ", …" : ""})` : "") +
        `\n` +
        `Hooks: ${hooks.length.toString()}` +
        (hooks.length > 0 ? ` (${hooks.slice(0, 5).map((h) => `${h.id}/${h.event}`).join(", ")}${hooks.length > 5 ? ", …" : ""})` : "") +
        `\n` +
        `MCP servers: ${mcpServers.length.toString()}` +
        (mcpServers.length > 0 ? ` (${mcpServers.map((s) => s.name).join(", ")})` : "");
    }
    const snapshot = dbGetLatestSnapshot(chat.workspaceId);
    if (snapshot && snapshot.files.length > 0) {
      const manifestLines = snapshot.files.slice(0, 60).map((f: FileMeta) => {
        const headings = f.headings?.slice(0, 3).join(", ");
        const keys = f.jsonKeys?.slice(0, 3).join(", ");
        const hint = headings ? ` [${headings}]` : keys ? ` {${keys}}` : "";
        return `  ${f.path}${hint} (~${f.estimatedTokens.toString()} tokens)`;
      });
      const more = snapshot.files.length > 60 ? `\n  … and ${(snapshot.files.length - 60).toString()} more files` : "";
      const indexPart =
        `--- Workspace file index (${snapshot.fileCount.toString()} files, last scanned ${snapshot.createdAt}) ---\n` +
        manifestLines.join("\n") +
        more;

      // Retrieve the chunks most relevant to *this* user message rather
      // than just inlining the smallest files (which crowded out larger
      // files that actually contained the answer). The keyword ranker
      // here works locally with no external API; an embedding-based
      // retriever can be substituted behind the same call later.
      let contentPart: string | undefined;
      if (ws && userMessage.content.trim()) {
        // Rerank only substantive queries (≳ a sentence). A long, specific
        // question earns one extra fast (noThink) model call to reorder the
        // retrieved set for precision; a short "what's this?" doesn't — so
        // quick chat stays quick. Unset reranker → unchanged retrieval.
        const useRerank =
          rerank && userMessage.content.trim().length >= 80 ? rerank : undefined;
        const ranked = await retrieveRelevantChunks(
          ws.rootPath,
          snapshot.files,
          userMessage.content,
          // Letting the retriever know the workspaceId unlocks the
          // embedding path — it'll cosine-score against the stored
          // index when one exists, fall back to keyword otherwise.
          { workspaceId: ws.id, rerank: useRerank },
        );
        const rendered = formatChunksForPrompt(ranked);
        if (rendered) {
          contentPart = `--- Workspace excerpts (most relevant to the question) ---\n${rendered}`;
          // Distinct files behind those excerpts — the answer's evidence trail.
          contextSources = [...new Set(ranked.map((c) => c.path))];
        }
      }
      // Fall back to the legacy "smallest files inline" pass when the
      // query has no extractable keywords (e.g. a one-word greeting in a
      // workspace chat) — we still want SOMETHING from the workspace in
      // context so the model can reference it.
      if (!contentPart && ws) {
        const fallback = await readWorkspaceFiles(ws.rootPath, snapshot.files);
        if (fallback) {
          contentPart = `--- Workspace file contents ---\n${fallback}`;
        }
      }
      workspaceBlock = contentPart ? `${indexPart}\n\n${contentPart}` : indexPart;
    }
  }

  // 4. Conversation history (cap to ~20 messages / 8k chars)
  const historyTurns = buildHistoryText(history);
  if (historyTurns) {
    historyBlock = `--- Conversation history ---\n${historyTurns}`;
  }

  // Now resolve the parallel web-search promise — by this point the
  // workspace I/O above has already happened, so we only pay the
  // remaining search latency. If search hasn't finished yet, we wait
  // here; if it errored or returned no results, webBlock stays
  // undefined and the section drops out of `parts`.
  const searchResp = await searchPromise;
  if (searchResp && searchResp.results.length > 0) {
    searchResults = searchResp.results;
    const top = searchResp.results.slice(0, 6);
    // Read the top pages, not just snippets — a 150-char snippet can't hold the
    // table/detail the question often needs. The agent web_search path already
    // does this; chat web search was still snippet-only. Concurrent + best-
    // effort; a failed/blocked fetch falls back to that result's snippet.
    const pages = await Promise.all(top.slice(0, 3).map((r) => fetchUrlText(r.url).catch(() => "")));
    const resultText = top
      .map((r, i) => {
        const body = (pages[i] ?? "").trim();
        const content = body.length > r.snippet.length ? body.slice(0, 2500) : r.snippet;
        return `[${(i + 1).toString()}] ${r.title}\n${r.url}\n${content}`;
      })
      .join("\n\n");
    webBlock = `--- Web search results (${searchResp.provider}) ---\n${resultText}`;
  }

  // 5. Current user message — assemble in the canonical section order.
  //    Memory comes BEFORE web/workspace excerpts because confirmed
  //    facts should anchor everything else; the model should read
  //    them first and treat them as authoritative.
  // Section order: workspace settings (what is this project) → memory
  // (confirmed facts) → attachments → web → workspace file excerpts →
  // history. Settings goes first so questions like "이 프로젝트 설정
  // 알려줘" can be answered from the system prompt alone.
  // R1 — split into a stable, cacheable prefix and a dynamic tail. The model
  // sees the SAME section order as before (settings → memory → attachments →
  // web → excerpts → history → user message), but across two channels:
  //   • system: base instructions + profile + workspace settings + memory.
  //     These don't change turn-to-turn, so providers cache them (Anthropic
  //     cache_control; OpenAI/vLLM/Ollama auto prefix-cache) and turn 2+ skips
  //     re-billing them.
  //   • prompt: attachments + web + workspace excerpts + the GROWING history +
  //     the user message — kept out of the cached prefix because they change
  //     every turn.
  // `system` directly precedes `prompt`, so the concatenated text the model
  // receives is byte-identical to the previous single-prompt layout.
  // Rubric-grounded review guidance. A review/critique is an open-ended writing
  // task with no automatic checker — the area where a model most easily invents
  // plausible-but-unsupported criticism. The fix is an EXTERNAL anchor: a fixed
  // rubric for structure plus a hard requirement to ground every point in a
  // quoted passage. (Grounded single-pass review beats ungrounded self-critique,
  // which can DEGRADE quality — arXiv:2310.01798.) The instruction is conditional
  // ("when the user asks you to review…"), so it's inert for ordinary chat — the
  // model only applies it when the task is actually a review.
  const reviewGuidance =
    " When the user asks you to review, critique, assess, or evaluate a document, paper, or piece of work: " +
    "organise the assessment by clear dimensions (for academic work — contribution & originality, method & " +
    "rigour, argumentation & evidence, engagement with prior work, structure & clarity, limitations). Ground " +
    "EVERY point in a specific quoted passage or named section of the source — quote it. Never raise an issue " +
    "the text does not actually contain; if you cannot locate support for a point, say so rather than inventing " +
    "it. Separate major issues from minor ones, give strengths alongside weaknesses, and make each criticism " +
    "actionable (what concretely would fix it). Be calibrated and specific, not generic.";
  // Anti-hallucination directive. Targeted at the failure mode the user hit —
  // the model inventing artworks / attributions / facts it could not actually
  // see or verify. Phrased to bite only on FACTUAL claims and on describing
  // attached visuals, so ordinary casual chat isn't pushed to hedge needlessly
  // (over-broad "be careful" instructions can degrade quality — see the note
  // on reviewGuidance above).
  const accuracyGuidance =
    " Factual accuracy outranks completeness: the user does scholarly work (art history, theses) where a wrong " +
    "name, date, attribution, quotation, or citation is worse than admitting uncertainty. Do not invent specifics — " +
    "if you are not confident about a particular work, artist, date, figure, quotation, or source, say so plainly " +
    "(e.g. \"I'm not certain\") or ask, rather than presenting a guess as fact. Ground factual claims in the materials " +
    "you were actually given (attached files, rendered document pages, workspace files, web results) and point to " +
    "where a claim comes from when that helps the user verify it. When images or rendered document pages are attached, " +
    "describe only what is genuinely visible in them — never infer or fabricate a title, artist, caption, or detail " +
    "you cannot see.";
  const baseSystem =
    "You are Ariadne's assistant — a calm, precise, local-first AI workspace assistant. " +
    "Help the user with their questions, files, and research tasks. " +
    "When a workspace is attached you receive its file index plus the contents of its " +
    "key files — read them directly to answer; for a full structured deliverable, " +
    "suggest running the appropriate Template. " +
    "Always reply in the same language the user writes in. " +
    "Be concise and direct. Write your answer as normal Markdown prose — never wrap the whole reply in a code block, " +
    "and do not add bracketed citation markers like [1]." +
    reviewGuidance +
    accuracyGuidance;

  const stableBlocks = [workspaceMetaBlock, projectContextBlock, memoryBlock].filter(
    (s): s is string => !!s,
  );
  const systemWithProfile = appendUserProfile(baseSystem, accountContext);
  const system =
    stableBlocks.length > 0
      ? `${systemWithProfile}\n\n${stableBlocks.join("\n\n")}`
      : systemWithProfile;

  const dynamicBlocks = [
    attachmentBlock,
    webBlock,
    workspaceBlock,
    historyBlock,
  ].filter((s): s is string => !!s);
  const contextBlock =
    dynamicBlocks.length > 0 ? dynamicBlocks.join("\n\n") + "\n\n" : "";
  const prompt = `${contextBlock}User: ${userMessage.content}`;

  return { system, prompt, images, searchResults, contextSources };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface AttachmentRef {
  uploadId: string;
  /** AY — chat composer toggle: when true, convert this attachment via
   *  markitdown before extracting text. Drops binary footprint for
   *  PPT/PDF/DOCX by ~10x while preserving structure. */
  useMarkdown?: boolean;
}

/**
 * Read the smallest non-sensitive text files of a workspace and return them
 * as one labelled block, under a fixed character budget. Eligibility is
 * delegated to retrieval.isRetrievalEligible so the file allowlist
 * (extensions + extensionless basenames like Makefile/Dockerfile)
 * lives in exactly one place.
 */
async function readWorkspaceFiles(rootPath: string, files: FileMeta[]): Promise<string> {
  const candidates = files
    .filter(isRetrievalEligible)
    .sort((a, b) => a.size - b.size)
    .slice(0, 8);

  // Read the candidates concurrently and off the event loop, then apply the
  // character budget in size order. No size budget on the read itself —
  // the caller applies one across the aggregate, so a full read is correct.
  const reads = await Promise.all(
    candidates.map(async (f): Promise<{ path: string; text: string } | null> => {
      const abs = safeResolveUnderRoot(rootPath, f.path);
      if (!abs) return null;
      try {
        return { path: f.path, text: await fs.promises.readFile(abs, "utf-8") };
      } catch {
        return null;
      }
    }),
  );

  const blocks: string[] = [];
  let budget = 14_000;
  for (const r of reads) {
    if (!r) continue;
    if (budget <= 200) break;
    let text = r.text;
    const cap = Math.min(3_000, budget);
    if (text.length > cap) text = text.slice(0, cap) + "\n[...truncated...]";
    budget -= text.length;
    blocks.push(`### ${r.path}\n${text}`);
  }
  return blocks.join("\n\n");
}

function buildHistoryText(history: ChatMessage[]): string {
  // Keep last 20 messages; cap total chars at 8k
  const recent = history.slice(-20);
  const lines: string[] = [];
  let totalChars = 0;

  for (const msg of recent) {
    const role = msg.role === "user" ? "User" : "Assistant";
    const content = msg.content.slice(0, 800); // per-message cap
    const line = `${role}: ${content}`;
    totalChars += line.length;
    if (totalChars > 8000) break;
    lines.push(line);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// History compaction (R2)
// ---------------------------------------------------------------------------

// Keep the most recent turns verbatim; summarize everything older into one
// digest message once the conversation gets long. Without this, the
// recent-window cap in buildHistoryText silently *drops* older turns and the
// model loses early context. Compaction recovers it for the cost of one cheap
// summary call, and only triggers for genuinely long chats.
const KEEP_RECENT_MESSAGES = 12;
const COMPACT_TRIGGER_CHARS = 12_000;

/** Cheap predicate: does this history warrant a (latency-incurring)
 *  summarization pass? Lets the caller show a status line before the work. */
export function shouldCompactHistory(history: ChatMessage[]): boolean {
  if (history.length <= KEEP_RECENT_MESSAGES + 4) return false;
  const totalChars = history.reduce((n, m) => n + m.content.length, 0);
  return totalChars > COMPACT_TRIGGER_CHARS;
}

/**
 * Summarize the older portion of a long history into a single digest message,
 * keeping the most recent turns verbatim. Returns the history unchanged when
 * it's short enough (no LLM call) or if summarization fails (falls back to the
 * full history — the recent-window cap downstream still bounds it).
 */
export async function buildSummarizedHistory(
  history: ChatMessage[],
  provider: AiProvider,
  signal?: AbortSignal,
): Promise<ChatMessage[]> {
  if (!shouldCompactHistory(history)) return history;

  const recent = history.slice(-KEEP_RECENT_MESSAGES);
  const older = history.slice(0, -KEEP_RECENT_MESSAGES);
  const olderText = older
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n")
    .slice(0, 24_000);

  let digest: string;
  try {
    const res = await provider.complete({
      system:
        "You compress earlier chat history into a structured digest that a later AI turn can " +
        "rely on without seeing the original messages. Preserve meaning over brevity for " +
        "decisions and open threads — those are the first context lost in compression. Output " +
        "these labelled sections as terse bullets, omitting a section only when it is genuinely " +
        "empty:\n" +
        "## Context — what the conversation is about (1–2 bullets).\n" +
        "## Decisions — every choice, conclusion, or answer already settled.\n" +
        "## Open threads — unresolved questions, pending tasks, known bugs, next steps.\n" +
        "## Facts — names, numbers, dates, file paths, IDs, stated preferences.\n" +
        "Reply in the conversation's language. No preamble, no closing remarks.",
      prompt: olderText,
      signal,
    });
    digest = res.text.trim();
  } catch {
    return history;
  }
  if (!digest) return history;

  const anchor = older[0] ?? recent[0];
  if (!anchor) return history;
  const summary: ChatMessage = {
    ...anchor,
    id: `summary-${anchor.id}`,
    role: "assistant",
    content: `[Summary of ${older.length.toString()} earlier messages]\n${digest}`,
  };
  return [summary, ...recent];
}

async function parseUploadedFile(data: Buffer, name: string, _uploadId: string, useMarkdown = false): Promise<string> {
  // AY — markitdown path: structure-preserving extraction. Writes the
  // upload to a tmp file (markitdown reads from disk), runs the CLI,
  // returns the markdown. Falls through to the legacy per-extension
  // pipeline on any failure (CLI missing, conversion error, etc.).
  if (useMarkdown) {
    try {
      const { getMarkitdownStatus, convertToMarkdown } = await import("./markitdown.js");
      if (getMarkitdownStatus().available) {
        const ext = (name.split(".").pop() ?? "").toLowerCase();
        const tmp = path.join("/tmp", `ariadne-md-${Date.now().toString(36)}.${ext || "bin"}`);
        await fs.promises.writeFile(tmp, data);
        try {
          const md = await convertToMarkdown(tmp);
          return md.length > 8000 ? md.slice(0, 6000) + "\n[...truncated...]" : md;
        } finally {
          try { await fs.promises.unlink(tmp); } catch { /* */ }
        }
      }
    } catch (err) {
      // Logged once; we still try the legacy path below.
      const logger = (await import("../logger.js")).default;
      logger.debug({ name, err: String(err) }, "markitdown attachment extract failed — falling back");
    }
  }
  const ext = (name.split(".").pop() ?? "").toLowerCase();

  // PDF
  if (ext === "pdf") {
    return tryParseDocument(name, async () => {
      const { extractPdfText } = await import("./pdfExtract.js");
      const text = await extractPdfText(data);
      return text.length > 8000 ? text.slice(0, 6000) + "\n[...truncated...]" : text;
    });
  }

  // DOCX
  if (ext === "docx") {
    return tryParseDocument(name, async () => {
      const mammoth = await import("mammoth");
      const tmp = path.join("/tmp", `ariadne-upload-${Date.now().toString()}.docx`);
      // Async writeFile — sync version blocks the event loop for the
      // entire write, freezing the chat stream that's running on the
      // same Fastify worker for the duration of the disk write.
      await fs.promises.writeFile(tmp, data);
      const result = await mammoth.extractRawText({ path: tmp });
      try { await fs.promises.unlink(tmp); } catch { /* ignore */ }
      const text = result.value ?? "";
      return text.length > 8000 ? text.slice(0, 6000) + "\n[...truncated...]" : text;
    });
  }

  // XLSX
  if (ext === "xlsx" || ext === "xls") {
    return tryParseDocument(name, async () => {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(data);
      const parts: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const csv = XLSX.utils.sheet_to_csv(sheet, { RS: "\n" });
        const rows = csv.split("\n").slice(0, 30).join("\n");
        parts.push(`## Sheet: ${sheetName}\n${rows}`);
      }
      return parts.join("\n\n") || `[Empty workbook: ${name}]`;
    });
  }

  // Text-based
  try {
    const text = data.toString("utf-8");
    return text.length > 8000 ? text.slice(0, 4000) + "\n[...truncated...]" + text.slice(-1000) : text;
  } catch {
    return `[Binary file: ${name}]`;
  }
}
