import fs from "node:fs";
import path from "node:path";
import type { FileMeta, Snapshot, Template } from "@ariadne/shared";
import type { AiProvider } from "../providers/index.js";
import { extractJson } from "../providers/index.js";

const OVERSIZED_TOKENS = 8000;

/** Extensions treated as images for vision calls. */
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

/** Media type map for image extensions. */
const IMAGE_MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export interface ManifestEntry {
  path: string;
  extension: string;
  size: number;
  headings?: string[];
  csvHeaders?: string[];
  jsonKeys?: string[];
  firstLines: string[];
  estimatedTokens: number;
  sensitive: boolean;
}

export interface Manifest {
  workspaceId: string;
  snapshotId: string;
  files: ManifestEntry[];
}

export interface CandidateResult {
  path: string;
  reason: string;
}

/** Build a lean manifest from a snapshot (metadata only, no file content). */
export function buildManifest(snapshot: Snapshot): Manifest {
  return {
    workspaceId: snapshot.workspaceId,
    snapshotId: snapshot.id,
    files: snapshot.files.map((f) => ({
      path: f.path,
      extension: f.extension,
      size: f.size,
      headings: f.headings,
      csvHeaders: f.csvHeaders,
      jsonKeys: f.jsonKeys,
      firstLines: f.firstLines,
      estimatedTokens: f.estimatedTokens,
      sensitive: f.sensitive,
    })),
  };
}

/** Determine file count bucket for the workspace. */
function workspaceBucket(fileCount: number): "small" | "medium" | "large" {
  if (fileCount <= 20) return "small";
  if (fileCount <= 60) return "medium";
  return "large";
}

function maxCandidates(fileCount: number): number {
  const bucket = workspaceBucket(fileCount);
  if (bucket === "small") return 8;
  if (bucket === "medium") return 5;
  return 3;
}

/**
 * Send only the manifest to the AI provider and ask it to pick candidate files.
 * Returns an array of { path, reason } objects.
 */
export async function selectCandidates(
  manifest: Manifest,
  template: Template,
  input: Record<string, string>,
  provider: AiProvider
): Promise<CandidateResult[]> {
  const limit = maxCandidates(manifest.files.length);

  const system = `You are a context-selection assistant for the Ariadne workspace tool.
Your task: given a file manifest (metadata only, no content), select the most relevant files for a "${template.name}" task.
Return ONLY a JSON object: { "candidates": [ { "path": string, "reason": string } ] }
Select at most ${limit} files. Skip sensitive files unless they are the only source. Prefer files whose headings, keys, or names directly match the user's query.`;

  const prompt = `Template: ${template.name}
Description: ${template.description}
User input: ${JSON.stringify(input, null, 2)}

Manifest:
${JSON.stringify(manifest.files, null, 2)}`;

  const { text } = await provider.complete({ system, prompt, json: true });

  try {
    const raw = extractJson(text);
    const parsed = JSON.parse(raw) as { candidates?: unknown[] };
    const candidates = parsed.candidates;
    if (!Array.isArray(candidates)) return [];
    return candidates
      .filter((c): c is CandidateResult => typeof (c as CandidateResult).path === "string")
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** PDF extraction via pdfjs-dist with OCR fallback for scanned PDFs. */
async function extractPdf(absPath: string, provider?: AiProvider): Promise<string> {
  try {
    const buf = fs.readFileSync(absPath);
    const { extractPdfText } = await import("../services/pdfExtract.js");
    return await extractPdfText(buf, provider);
  } catch {
    return `[Could not parse ${path.basename(absPath)}]`;
  }
}

/** DOCX extraction via mammoth. */
async function extractDocx(absPath: string): Promise<string> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ path: absPath });
    const text = result.value ?? "";
    if (text.length <= 12000) return text;
    return text.slice(0, 6000) + "\n\n[...truncated...]\n\n" + text.slice(-2000);
  } catch {
    return `[Could not parse ${path.basename(absPath)}]`;
  }
}

/** XLSX extraction via SheetJS — per sheet, name + CSV of first ~30 rows. */
async function extractXlsx(absPath: string): Promise<string> {
  try {
    const XLSX = await import("xlsx");
    const workbook = XLSX.readFile(absPath);
    const parts: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet, { RS: "\n" });
      const rows = csv.split("\n").slice(0, 30).join("\n");
      parts.push(`## Sheet: ${sheetName}\n${rows}`);
    }
    return parts.join("\n\n") || `[Empty workbook: ${path.basename(absPath)}]`;
  } catch {
    return `[Could not parse ${path.basename(absPath)}]`;
  }
}

/** Image interpretation via the active provider. Falls back to a description placeholder. */
async function extractImage(
  absPath: string,
  ext: string,
  provider: AiProvider
): Promise<string> {
  const mediaType = IMAGE_MEDIA_TYPES[ext] ?? "image/jpeg";
  try {
    const buf = fs.readFileSync(absPath);
    const dataBase64 = buf.toString("base64");

    if (!provider.completeWithImages) {
      return `[image: ${path.basename(absPath)}, vision not available]`;
    }

    const { text } = await provider.completeWithImages({
      system: "You are an evidence analyst. Describe the content of the provided image for research and evidence documentation purposes. Be concise and factual.",
      prompt: "Describe this image in detail, noting any text, data, charts, diagrams, or other relevant content visible.",
      images: [{ mediaType, dataBase64 }],
    });
    return text;
  } catch {
    return `[image: ${path.basename(absPath)}, could not process]`;
  }
}

/** Format-aware focused read of a single file. */
async function focusedReadFileAsync(
  absPath: string,
  meta: FileMeta,
  provider?: AiProvider
): Promise<string> {
  const ext = meta.extension;

  // Binary document formats
  if (ext === "pdf") {
    return extractPdf(absPath, provider);
  }

  if (ext === "docx") {
    return extractDocx(absPath);
  }

  if (ext === "xlsx" || ext === "xls") {
    return extractXlsx(absPath);
  }

  // .pptx — skip gracefully
  if (ext === "pptx" || ext === "ppt" || ext === "doc") {
    return `[Binary document: ${path.basename(absPath)} — parsing not supported for .${ext}]`;
  }

  // Images
  if (IMAGE_EXTS.has(ext)) {
    if (provider) {
      return extractImage(absPath, ext, provider);
    }
    return `[image: ${path.basename(absPath)}, vision not available]`;
  }

  // Text-based types
  let text: string;
  try {
    text = fs.readFileSync(absPath, "utf-8");
  } catch {
    return `[Could not read file: ${meta.path}]`;
  }

  if (ext === "md" || ext === "markdown") {
    if (text.length > 12000) {
      return text.slice(0, 6000) + "\n\n[...truncated...]\n\n" + text.slice(-2000);
    }
    return text;
  }

  if (ext === "txt") {
    const lines = text.split("\n");
    const head = lines.slice(0, 60).join("\n");
    const tail = lines.slice(-20).join("\n");
    return head + (lines.length > 80 ? `\n\n[...${lines.length - 80} lines omitted...]\n\n` + tail : "");
  }

  if (ext === "csv") {
    const lines = text.split("\n");
    const header = lines[0] ?? "";
    const sample = lines.slice(1, 11).join("\n");
    return `Headers: ${header}\nSample rows:\n${sample}\nTotal rows: ${(meta.csvRowCount ?? 0).toString()}`;
  }

  if (ext === "json") {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        const preview = parsed.slice(0, 5);
        return `Array (${parsed.length.toString()} items). First 5:\n${JSON.stringify(preview, null, 2)}`;
      }
      const short = JSON.stringify(parsed, null, 2);
      return short.length > 8000 ? short.slice(0, 8000) + "\n..." : short;
    } catch {
      return text.slice(0, 4000);
    }
  }

  if (ext === "yaml" || ext === "yml") {
    return text.length > 8000 ? text.slice(0, 8000) + "\n..." : text;
  }

  // Default: head+tail
  return text.length > 8000 ? text.slice(0, 4000) + "\n\n[truncated]\n\n" + text.slice(-1000) : text;
}

export interface FocusedFile {
  path: string;
  content: string;
  estimatedTokens: number;
  oversized: boolean;
}

/** Read the approved files using format-specific strategies. */
export async function focusedRead(
  workspaceRoot: string,
  filePaths: string[],
  snapshot: Snapshot,
  provider?: AiProvider
): Promise<FocusedFile[]> {
  const metaMap = new Map<string, FileMeta>(snapshot.files.map((f) => [f.path, f]));

  const results: FocusedFile[] = [];
  for (const relPath of filePaths) {
    const meta = metaMap.get(relPath) ?? {
      path: relPath,
      extension: relPath.split(".").pop() ?? "",
      size: 0,
      modifiedTime: "",
      hash: "",
      firstLines: [],
      estimatedTokens: 0,
      sensitive: false,
    };
    const absPath = path.join(workspaceRoot, relPath);
    const content = await focusedReadFileAsync(absPath, meta, provider);
    const est = Math.ceil(content.length / 4);
    results.push({
      path: relPath,
      content,
      estimatedTokens: est,
      oversized: est > OVERSIZED_TOKENS,
    });
  }
  return results;
}
