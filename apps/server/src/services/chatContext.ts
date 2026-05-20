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
import { dbGetLatestSnapshot } from "../db/repo.js";
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

  // 3. Workspace manifest summary
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
        `--- Workspace context (${snapshot.fileCount.toString()} files, last scanned ${snapshot.createdAt}) ---\n` +
          manifestLines.join("\n") +
          more +
          "\n\nNote: deep analysis of these files can be done by running a Template from the Workspaces section."
      );
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
    "If the user has attached a workspace, you have access to a summary of its files; " +
    "for deep analysis, suggest running the appropriate Template from the Workspaces view. " +
    "Be concise and direct. Format your response in clear Markdown when helpful.";

  return { system, prompt, images, searchResults };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface AttachmentRef {
  uploadId: string;
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
