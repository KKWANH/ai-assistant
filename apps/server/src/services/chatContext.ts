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
import type { ProviderImage } from "../providers/index.js";
import { dbGetLatestSnapshot, dbGetWorkspace } from "../db/repo.js";
import { performSearch } from "./search.js";
import { readUpload } from "./uploads.js";

// ---------------------------------------------------------------------------
// Public return type
// ---------------------------------------------------------------------------

export interface ChatContextResult {
  system: string;
  prompt: string;
  images: ProviderImage[];
  searchResults: SearchResult[] | null;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export async function buildChatContext(
  chat: Chat,
  history: ChatMessage[],
  userMessage: { content: string; attachments?: AttachmentRef[]; webSearch?: boolean }
): Promise<ChatContextResult> {
  const parts: string[] = [];
  const images: ProviderImage[] = [];
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
        // Parse the file to text
        const text = await parseUploadedFile(upload.data, upload.meta.name, att.uploadId);
        const capped = text.length > 4000 ? text.slice(0, 4000) + "\n[...truncated...]" : text;
        fileParts.push(`--- Attached file: ${upload.meta.name} ---\n${capped}`);
      }
    }
    if (fileParts.length > 0) {
      parts.push(fileParts.join("\n\n"));
    }
  }

  // 2. Web search
  if (userMessage.webSearch && userMessage.content.trim()) {
    try {
      const searchResp = await performSearch(userMessage.content.trim());
      searchResults = searchResp.results;
      if (searchResults.length > 0) {
        const resultText = searchResults
          .map((r, i) => `[${(i + 1).toString()}] ${r.title}\n${r.url}\n${r.snippet}`)
          .join("\n\n");
        parts.push(`--- Web search results (${searchResp.provider}) ---\n${resultText}`);
      }
    } catch {
      // search failure is non-fatal
    }
  }

  // 3. Workspace context — file index + inline content of key files
  if (chat.workspaceId) {
    const snapshot = dbGetLatestSnapshot(chat.workspaceId);
    if (snapshot && snapshot.files.length > 0) {
      const manifestLines = snapshot.files.slice(0, 60).map((f: FileMeta) => {
        const headings = f.headings?.slice(0, 3).join(", ");
        const keys = f.jsonKeys?.slice(0, 3).join(", ");
        const hint = headings ? ` [${headings}]` : keys ? ` {${keys}}` : "";
        return `  ${f.path}${hint} (~${f.estimatedTokens.toString()} tokens)`;
      });
      const more = snapshot.files.length > 60 ? `\n  … and ${(snapshot.files.length - 60).toString()} more files` : "";
      parts.push(
        `--- Workspace file index (${snapshot.fileCount.toString()} files, last scanned ${snapshot.createdAt}) ---\n` +
          manifestLines.join("\n") +
          more
      );

      // Inline the content of the smallest text files so the model can
      // reason over the workspace itself, not just its file list.
      const ws = dbGetWorkspace(chat.workspaceId);
      if (ws) {
        const fileContent = await readWorkspaceFiles(ws.rootPath, snapshot.files);
        if (fileContent) {
          parts.push(`--- Workspace file contents ---\n${fileContent}`);
        }
      }
    }
  }

  // 4. Conversation history (cap to ~20 messages / 8k chars)
  const historyTurns = buildHistoryText(history);
  if (historyTurns) {
    parts.push(`--- Conversation history ---\n${historyTurns}`);
  }

  // 5. Current user message
  const contextBlock = parts.length > 0 ? parts.join("\n\n") + "\n\n" : "";
  const prompt = `${contextBlock}User: ${userMessage.content}`;

  const system =
    "You are Ariadne's assistant — a calm, precise, local-first AI workspace assistant. " +
    "Help the user with their questions, files, and research tasks. " +
    "When a workspace is attached you receive its file index plus the contents of its " +
    "key files — read them directly to answer; for a full structured deliverable, " +
    "suggest running the appropriate Template. " +
    "Always reply in the same language the user writes in. " +
    "Be concise and direct. Write your answer as normal Markdown prose — never wrap the whole reply in a code block, " +
    "and do not add bracketed citation markers like [1].";

  return { system, prompt, images, searchResults };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface AttachmentRef {
  uploadId: string;
}

// Extensions whose content is worth embedding verbatim into chat context.
const EMBEDDABLE_EXT = new Set([
  "md", "markdown", "txt", "text", "csv", "tsv", "json", "yaml", "yml",
  "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "sh", "bash",
  "html", "css", "scss", "xml", "sql", "toml", "ini", "env", "log", "conf",
]);

/**
 * Read the smallest non-sensitive text files of a workspace and return them
 * as one labelled block, under a fixed character budget.
 */
async function readWorkspaceFiles(rootPath: string, files: FileMeta[]): Promise<string> {
  const root = path.resolve(rootPath);
  const candidates = files
    .filter((f) => {
      if (f.sensitive) return false;
      const ext = (f.extension || path.extname(f.path)).replace(/^\./, "").toLowerCase();
      return EMBEDDABLE_EXT.has(ext);
    })
    .sort((a, b) => a.size - b.size)
    .slice(0, 8);

  // Read the candidates concurrently and off the event loop, then apply the
  // character budget in size order.
  const reads = await Promise.all(
    candidates.map(async (f): Promise<{ path: string; text: string } | null> => {
      const abs = path.resolve(root, f.path);
      // Stay within the workspace root — never follow a traversal.
      if (abs !== root && !abs.startsWith(root + path.sep)) return null;
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

async function parseUploadedFile(data: Buffer, name: string, _uploadId: string): Promise<string> {
  const ext = (name.split(".").pop() ?? "").toLowerCase();

  // PDF
  if (ext === "pdf") {
    try {
      const { extractPdfText } = await import("./pdfExtract.js");
      const text = await extractPdfText(data);
      return text.length > 8000 ? text.slice(0, 6000) + "\n[...truncated...]" : text;
    } catch {
      return `[Could not parse ${name}]`;
    }
  }

  // DOCX
  if (ext === "docx") {
    try {
      const mammoth = await import("mammoth");
      const tmp = path.join("/tmp", `ariadne-upload-${Date.now().toString()}.docx`);
      fs.writeFileSync(tmp, data);
      const result = await mammoth.extractRawText({ path: tmp });
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      const text = result.value ?? "";
      return text.length > 8000 ? text.slice(0, 6000) + "\n[...truncated...]" : text;
    } catch {
      return `[Could not parse ${name}]`;
    }
  }

  // XLSX
  if (ext === "xlsx" || ext === "xls") {
    try {
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
    } catch {
      return `[Could not parse ${name}]`;
    }
  }

  // Text-based
  try {
    const text = data.toString("utf-8");
    return text.length > 8000 ? text.slice(0, 4000) + "\n[...truncated...]" + text.slice(-1000) : text;
  } catch {
    return `[Binary file: ${name}]`;
  }
}
