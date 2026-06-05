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
import type { AiProvider, ProviderImage } from "../providers/index.js";
import { safeResolveUnderRoot } from "../security/pathGuard.js";
import { tryParseDocument } from "./safeParse.js";
import { dbGetLatestSnapshot, dbGetWorkspace, dbListMcpServers } from "../db/repo.js";
import { performSearch } from "./search.js";
import { readUpload } from "./uploads.js";
import { retrieveRelevantChunks, formatChunksForPrompt, isRetrievalEligible } from "./retrieval.js";
import { listMemories, renderMemoryForPrompt } from "./workspaceMemory.js";
import { loadWorkspaceActions } from "./actions.js";
import { loadHooks } from "./hooks.js";

// ---------------------------------------------------------------------------
// Public return type
// ---------------------------------------------------------------------------

export interface ChatContextResult {
  system: string;
  prompt: string;
  images: ProviderImage[];
  searchResults: SearchResult[] | null;
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
  accountContext?: string
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
  let workspaceMetaBlock: string | undefined;
  let workspaceBlock: string | undefined;
  let historyBlock: string | undefined;
  let searchResults: SearchResult[] | null = null;

  // 1. Attached files / images
  if (userMessage.attachments && userMessage.attachments.length > 0) {
    const fileParts: string[] = [];
    for (const att of userMessage.attachments) {
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
        const capped = text.length > 4000 ? text.slice(0, 4000) + "\n[...truncated...]" : text;
        fileParts.push(`--- Attached file: ${upload.meta.name} ---\n${capped}`);
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
        const ranked = await retrieveRelevantChunks(
          ws.rootPath,
          snapshot.files,
          userMessage.content,
          // Letting the retriever know the workspaceId unlocks the
          // embedding path — it'll cosine-score against the stored
          // index when one exists, fall back to keyword otherwise.
          { workspaceId: ws.id },
        );
        const rendered = formatChunksForPrompt(ranked);
        if (rendered) {
          contentPart = `--- Workspace excerpts (most relevant to the question) ---\n${rendered}`;
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
    const resultText = searchResp.results
      .map((r, i) => `[${(i + 1).toString()}] ${r.title}\n${r.url}\n${r.snippet}`)
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
  const baseSystem =
    "You are Ariadne's assistant — a calm, precise, local-first AI workspace assistant. " +
    "Help the user with their questions, files, and research tasks. " +
    "When a workspace is attached you receive its file index plus the contents of its " +
    "key files — read them directly to answer; for a full structured deliverable, " +
    "suggest running the appropriate Template. " +
    "Always reply in the same language the user writes in. " +
    "Be concise and direct. Write your answer as normal Markdown prose — never wrap the whole reply in a code block, " +
    "and do not add bracketed citation markers like [1].";

  const stableBlocks = [workspaceMetaBlock, memoryBlock].filter(
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

  return { system, prompt, images, searchResults };
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
