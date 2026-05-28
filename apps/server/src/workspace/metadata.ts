import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parse as csvParse } from "csv-parse/sync";
import matter from "gray-matter";
import yaml from "yaml";
import type { FileMeta } from "@ariadne/shared";
import { checkSensitive } from "../security/sensitive.js";
import { isMarkdownCachedByHashSync } from "../services/markdownCache.js";

const HEADING_RE = /^#{1,6}\s+(.+)/gm;

/** Binary document extensions — do not attempt UTF-8 decode for content. */
const BINARY_EXTS = new Set(["pdf", "docx", "xlsx", "xls", "pptx", "ppt", "doc"]);

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/** Extract markdown headings from raw text. */
function extractHeadings(text: string): string[] {
  const headings: string[] = [];
  let m: RegExpExecArray | null;
  HEADING_RE.lastIndex = 0;
  while ((m = HEADING_RE.exec(text)) !== null) {
    const h = m[1];
    if (h) headings.push(h.trim());
  }
  return headings;
}

/** Extract xlsx sheet names cheaply without parsing cell data. */
function xlsxSheetNames(buf: Buffer): string[] {
  try {
    // xlsx stores sheet names in [Content_Types].xml and xl/workbook.xml
    // We do a simple regex scan on the buffer to find sheet names.
    // This avoids a heavy full parse at scan time.
    const str = buf.toString("latin1");
    const re = /sheetId="\d+" name="([^"]+)"/g;
    const names: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(str)) !== null) {
      if (m[1]) names.push(m[1]);
    }
    return names;
  } catch {
    return [];
  }
}

/** Build a FileMeta for a single file. `relPath` is relative to workspace root. */
export async function buildFileMeta(absPath: string, relPath: string, workspaceRoot?: string): Promise<FileMeta> {
  const stat = fs.statSync(absPath);
  const buf = fs.readFileSync(absPath);
  const hash = sha256(buf);
  const ext = path.extname(relPath).replace(".", "").toLowerCase();

  const sensitiveReason = checkSensitive(relPath);

  // Binary document types — skip UTF-8 firstLines, handle specially
  if (BINARY_EXTS.has(ext)) {
    let jsonKeys: string[] | undefined;

    // For xlsx, cheaply record sheet names as jsonKeys (reuses existing field)
    if (ext === "xlsx" || ext === "xls") {
      const names = xlsxSheetNames(buf);
      if (names.length > 0) {
        jsonKeys = names;
      }
    }

    // AX — fast sync existence check by hash. workspaceRoot is the
    // scanner's known-good absolute root; required for the cache path
    // join.
    const hasMarkdown = workspaceRoot
      ? (isMarkdownCachedByHashSync(workspaceRoot, hash) || undefined)
      : undefined;

    return {
      path: relPath,
      extension: ext,
      size: stat.size,
      modifiedTime: stat.mtime.toISOString(),
      hash,
      firstLines: [],
      headings: undefined,
      csvHeaders: undefined,
      csvRowCount: undefined,
      jsonKeys,
      estimatedTokens: estimateTokens(stat.size / 2), // rough estimate for binary
      sensitive: sensitiveReason !== null,
      sensitiveReason: sensitiveReason ?? undefined,
      hasMarkdown,
    };
  }

  // Text-based types
  const text = buf.toString("utf-8");
  const lines = text.split("\n");
  const firstLines = lines.slice(0, 3).map((l) => l.trimEnd());

  let headings: string[] | undefined;
  let csvHeaders: string[] | undefined;
  let csvRowCount: number | undefined;
  let jsonKeys: string[] | undefined;

  if (ext === "md" || ext === "markdown") {
    const parsed = matter(text);
    headings = extractHeadings(parsed.content);
  } else if (ext === "txt") {
    // no structured metadata
  } else if (ext === "csv") {
    try {
      // Single parse: collect headers from first record and count all rows.
      const records = csvParse(text, { columns: true, skip_empty_lines: true }) as Record<string, unknown>[];
      if (records.length > 0 && records[0]) {
        csvHeaders = Object.keys(records[0]);
      }
      csvRowCount = records.length;
    } catch {
      // non-fatal — leave undefined
    }
  } else if (ext === "json") {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        jsonKeys = Object.keys(parsed as Record<string, unknown>).slice(0, 20);
      }
    } catch {
      // non-fatal
    }
  } else if (ext === "yaml" || ext === "yml") {
    try {
      const parsed = yaml.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        jsonKeys = Object.keys(parsed as Record<string, unknown>).slice(0, 20);
      }
    } catch {
      // non-fatal
    }
  }

  return {
    path: relPath,
    extension: ext,
    size: stat.size,
    modifiedTime: stat.mtime.toISOString(),
    hash,
    firstLines,
    headings,
    csvHeaders,
    csvRowCount,
    jsonKeys,
    estimatedTokens: estimateTokens(text.length),
    sensitive: sensitiveReason !== null,
    sensitiveReason: sensitiveReason ?? undefined,
  };
}
