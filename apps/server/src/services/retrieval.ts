/**
 * Workspace retrieval — query-relevant context for chat.
 *
 * Today: a lightweight keyword ranker. We chunk every readable workspace
 * file at paragraph/heading boundaries, score each chunk against the
 * user's message, and return the top-k. No embeddings, no external API,
 * no new persistent state — runs against the same snapshot the rest of
 * the workspace already uses.
 *
 * The previous strategy in chatContext.ts ("inline the smallest 8 text
 * files, sorted by size") was query-agnostic — small unrelated files
 * crowded out the actually relevant chunks of bigger files. Even a
 * keyword ranker beats that on every query that names a real term.
 *
 * Designed so a future embedding-based retriever can drop in behind the
 * same `retrieveRelevantChunks` signature without callers changing.
 */
import fs from "node:fs";
import path from "node:path";
import type { FileMeta } from "@ariadne/shared";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Maximum characters per chunk before we split. ~200 tokens at English prose. */
const CHUNK_CHARS = 800;
/** Carry the tail of each chunk into the next so a sentence isn't cleaved. */
const CHUNK_OVERLAP = 80;
/** How many files we attempt to read for ranking. Capped to keep I/O bounded. */
const MAX_FILES_READ = 40;
/** How much of any one file we read before truncating (~25 KB ≈ ~6k tokens). */
const FILE_READ_BUDGET = 25_000;
/** Default top-k chunks returned. */
const DEFAULT_TOP_K = 6;

// Stop-words pulled out before scoring — tiny, language-agnostic list. Keeps
// CJK terms intact (Korean particles like 은/는 aren't tokens here anyway —
// we tokenise on whitespace and Latin word breaks).
const STOP_WORDS = new Set<string>([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at",
  "for", "with", "by", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "i", "you", "he", "she", "it",
  "we", "they", "this", "that", "these", "those", "as", "from", "what",
  "which", "who", "whom", "whose", "how", "why", "when", "where", "can",
  "could", "would", "should", "will", "shall", "may", "might", "not", "no",
  "yes", "so", "than", "then", "too", "very", "just", "about",
]);

// File extensions worth reading verbatim. Mirrors EMBEDDABLE_EXT in
// chatContext.ts intentionally — keep these in sync.
const READABLE_EXT = new Set<string>([
  "md", "markdown", "txt", "text", "csv", "tsv", "json", "yaml", "yml",
  "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "sh", "bash",
  "html", "css", "scss", "xml", "sql", "toml", "ini", "env", "log", "conf",
]);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RetrievedChunk {
  path: string;
  chunk: string;
  score: number;
}

export interface RetrieveOptions {
  topK?: number;
  chunkChars?: number;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Return up to `topK` workspace chunks that look most relevant to `query`.
 *
 * Empty array if the query has no extractable keywords, the workspace has
 * no readable files, or every chunk scores zero.
 */
export async function retrieveRelevantChunks(
  rootPath: string,
  files: FileMeta[],
  query: string,
  options: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const topK = options.topK ?? DEFAULT_TOP_K;
  const chunkChars = options.chunkChars ?? CHUNK_CHARS;

  // Pick candidate files. We don't read everything — sort by size so the
  // small content-dense files (READMEs, configs) lead, while still letting
  // mid-size files be considered.
  const root = path.resolve(rootPath);
  const candidates = files
    .filter((f) => {
      if (f.sensitive) return false;
      const ext = (f.extension || path.extname(f.path)).replace(/^\./, "").toLowerCase();
      return READABLE_EXT.has(ext);
    })
    .sort((a, b) => a.size - b.size)
    .slice(0, MAX_FILES_READ);

  // Read concurrently — file system is the bottleneck, not CPU.
  const fileContents = await Promise.all(
    candidates.map(async (f) => {
      const abs = path.resolve(root, f.path);
      // Path-traversal guard: stay within the workspace root.
      if (abs !== root && !abs.startsWith(root + path.sep)) return null;
      try {
        const buf = await fs.promises.readFile(abs, "utf-8");
        const text = buf.length > FILE_READ_BUDGET ? buf.slice(0, FILE_READ_BUDGET) : buf;
        return { path: f.path, content: text };
      } catch {
        return null;
      }
    }),
  );

  const allChunks: RetrievedChunk[] = [];
  for (const fc of fileContents) {
    if (!fc) continue;
    const chunks = chunkText(fc.content, chunkChars);
    for (const chunk of chunks) {
      const score = scoreChunk(chunk, fc.path, tokens);
      if (score > 0) {
        allChunks.push({ path: fc.path, chunk, score });
      }
    }
  }

  // Sort by descending score, then prefer earlier (likely more focused)
  // chunks as a deterministic tiebreaker.
  allChunks.sort((a, b) => b.score - a.score);
  return allChunks.slice(0, topK);
}

/** Render a ranked chunk list as one labelled block for the LLM prompt. */
export function formatChunksForPrompt(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";
  // Trim the chunk to remove trailing context after the last keyword hit
  // would be ideal, but the scoring already preferred short matches.
  return chunks
    .map((c) => `--- ${c.path} ---\n${c.chunk.trim()}`)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Tokenise on word boundaries (Latin + digits). Drops stop-words and
 * one-character tokens. Hangul/CJK tokens fall through as whole strings
 * because their codepoints don't match `\w` — which is fine for our use:
 * Korean queries match Korean chunks via substring containment in the
 * scorer below.
 */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];

  // Pull every Latin/digit "word" out.
  for (const match of lower.matchAll(/[a-z0-9_]+/g)) {
    const tok = match[0];
    if (tok.length > 1 && !STOP_WORDS.has(tok)) {
      out.push(tok);
    }
  }
  // Pull Hangul / CJK runs — keep them as compound tokens; substring match
  // in the scorer is the right behaviour for these scripts.
  for (const match of lower.matchAll(/[぀-ヿ㐀-鿿가-힯]+/g)) {
    const tok = match[0];
    if (tok.length >= 1) out.push(tok);
  }
  // De-dupe — same token twice in a query doesn't double its weight.
  return Array.from(new Set(out));
}

/**
 * Chunk text on natural breaks: blank lines first (paragraphs), then any
 * sentence-ish boundary if a paragraph is still too long. Overlap a tail
 * of the previous chunk into the next so a search term split across the
 * boundary still matches.
 */
function chunkText(content: string, maxChars: number): string[] {
  const out: string[] = [];
  if (!content.trim()) return out;

  const paragraphs = content.split(/\n{2,}/);
  let current = "";
  for (const p of paragraphs) {
    if (current.length + p.length + 2 <= maxChars) {
      current += (current ? "\n\n" : "") + p;
      continue;
    }
    if (current) {
      out.push(current);
      // Carry the tail forward so context isn't lost at the seam.
      const tail = current.slice(-CHUNK_OVERLAP);
      current = tail.trim() ? tail + "\n\n" + p : p;
    } else {
      current = p;
    }
    // A single paragraph longer than maxChars — split it down.
    while (current.length > maxChars) {
      // Prefer breaking at the last newline/period in the first maxChars.
      const cut = findSoftBreak(current, maxChars);
      out.push(current.slice(0, cut));
      const tail = current.slice(cut - CHUNK_OVERLAP, cut);
      current = (tail.trim() ? tail : "") + current.slice(cut);
    }
  }
  if (current.trim()) out.push(current);
  return out;
}

function findSoftBreak(text: string, near: number): number {
  // Search backward from `near` for a newline or sentence end.
  for (let i = near; i > near - 200 && i > 0; i--) {
    const ch = text[i];
    if (ch === "\n" || ch === "." || ch === "!" || ch === "?" || ch === "。") {
      return i + 1;
    }
  }
  return near;
}

/**
 * Score = sum over query tokens of (sublinear term-frequency in chunk)
 * + (path-match bonus). Sublinear TF (`1 + log(freq)`) keeps a token
 * spammed in one chunk from dominating real relevance.
 */
function scoreChunk(chunk: string, filePath: string, tokens: string[]): number {
  const chunkLower = chunk.toLowerCase();
  const pathLower = filePath.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    const freq = countOccurrences(chunkLower, t);
    if (freq > 0) {
      score += 1 + Math.log(freq);
    }
    // Path hit is a strong signal — "holdings.csv" matching the user
    // asking about "holdings" should win against an incidental occurrence
    // in some unrelated README.
    if (pathLower.includes(t)) score += 1.5;
  }
  return score;
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return count;
    count++;
    from = idx + needle.length;
  }
}
