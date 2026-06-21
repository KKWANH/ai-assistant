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
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FileMeta } from "@ariadne/shared";
import { safeResolveUnderRoot } from "../security/pathGuard.js";
import {
  normalizedExtension,
  readTextUnderRoot,
} from "../workspace/readWithinRoot.js";
import { getEmbeddingProvider } from "../providers/embedding.js";
import {
  dbBm25Search,
  dbClearWorkspaceEmbeddings,
  dbDeleteChunksByPath,
  dbInsertChunkEmbeddings,
  dbListChunkPathDigests,
  dbListWorkspaceChunks,
  dbLookupSymbolMatches,
  type ChunkEmbeddingRow,
  type StoredChunk,
} from "../db/repo.js";
import logger from "../logger.js";

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
/** When a reranker is supplied, how many fused candidates to hand it before
 *  the final top-k slice. Wide enough to give the rerank something to reorder,
 *  bounded so the rerank prompt stays cheap. */
const RERANK_POOL = 20;
/** Cap the semantic attachment extractor's embedding work on the chat hot path
 *  — above this chunk count it returns null and the caller falls back to the
 *  INSTANT keyword extractor instead of hundreds of sequential local embeds. */
const SEMANTIC_MAX_CHUNKS = 80;
/** RRF weight for per-file summary rows (chunk_index = -1). < 1 so a summary
 *  doesn't crowd out precise leaf chunks on a specific question, while still
 *  ranking for holistic queries where it matches across many terms. */
const SUMMARY_RRF_WEIGHT = 0.6;

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
  // Text + structured
  "md", "markdown", "mdx", "txt", "text", "csv", "tsv", "json", "jsonl",
  "ndjson", "yaml", "yml", "toml", "ini", "env", "log", "conf", "properties",
  "xml", "sql",
  // Web / scripting
  "js", "jsx", "ts", "tsx", "vue", "svelte", "astro", "py", "rb", "php",
  "lua", "dart", "sh", "bash", "zsh", "fish",
  // Compiled-language source the agent should be able to read
  "c", "h", "cc", "cpp", "cxx", "hpp", "hxx", "hh", "m", "mm",
  "go", "rs", "java", "kt", "kts", "scala", "swift", "ex", "exs",
  "clj", "cljs", "ml", "fs", "fsx", "hs",
  // Markup + style
  "html", "htm", "css", "scss", "sass", "less",
  // Misc dev
  "proto", "graphql", "gql", "pl", "pm", "gradle", "groovy", "tex", "rmd",
]);

// Files with NO extension that are still worth reading. Matched by
// lowercased basename when normalizedExtension() returns "". Covers
// the C/Make project that surfaced the bug (Makefile + Dockerfile),
// plus the usual top-level metadata files most repos have.
const READABLE_BASENAME = new Set<string>([
  "makefile", "dockerfile", "containerfile", "vagrantfile", "procfile",
  "rakefile", "gemfile", "guardfile", "license", "license.txt",
  "readme", "readme.txt", "changelog", "changelog.txt", "authors",
  "contributors", "contributing", "notice", "copying", "version",
  ".gitignore", ".gitattributes", ".dockerignore", ".npmrc", ".nvmrc",
  ".tool-versions", ".editorconfig", ".env.example", ".prettierrc",
  ".eslintrc",
]);

function basenameLower(p: string): string {
  const idx = p.lastIndexOf("/");
  const base = idx >= 0 ? p.slice(idx + 1) : p;
  return base.toLowerCase();
}

/**
 * Same eligibility check the retriever uses for candidate selection.
 * Exported so the eval harness (or anything else that wants to compute
 * "indexed coverage") doesn't have to duplicate the rule. Keep this
 * function authoritative — if the retriever's filter changes, update
 * here.
 */
export function isRetrievalEligible(f: FileMeta): boolean {
  if (f.sensitive) return false;
  const ext = normalizedExtension(f);
  if (ext) return READABLE_EXT.has(ext);
  return READABLE_BASENAME.has(basenameLower(f.path));
}

/** MAX_FILES_READ exposed so the harness can compute the upper bound
 *  on indexed coverage. Stays in lockstep with the module-private
 *  MAX_FILES_READ constant below. */
export const RETRIEVAL_MAX_FILES = 40;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RetrievedChunk {
  path: string;
  chunk: string;
  score: number;
}

/**
 * Second-pass reranker. Given the query and the fused candidate set, returns
 * a reordered top-k. Supplied by the caller (see services/reranker.ts) so
 * retrieval stays decoupled from the chat provider. Must never throw and must
 * never drop a candidate it wasn't asked to — it only re-prioritises.
 */
export type RerankFn = (
  query: string,
  candidates: RetrievedChunk[],
  topK: number,
) => Promise<RetrievedChunk[]>;

export interface RetrieveOptions {
  topK?: number;
  chunkChars?: number;
  /** When set, the retriever first checks for a stored embedding index
   *  and uses it before falling back to keyword search. */
  workspaceId?: string;
  /**
   * Optional second-pass reranker applied to the hybrid candidate set before
   * the final top-k slice. When present, hybrid widens its candidate pool and
   * lets the model reorder by relevance to *this* query (precision lift, fights
   * lost-in-the-middle). Off by default — the chat path enables it only for
   * substantive queries; eval/agent/action paths leave it unset (unchanged
   * behaviour). Applies to the hybrid strategy only.
   */
  rerank?: RerankFn;
  /**
   * Pin the retrieval strategy instead of using the default `auto`
   * waterfall (semantic → keyword+symbol). Used by the eval harness to
   * compare strategies head-to-head; chat / actions stay on `auto`.
   *
   *   "auto"            current behaviour
   *   "semantic-only"   semantic; empty result if no index / no provider
   *                     (caller gets the warning, no fallback)
   *   "keyword-only"    keyword ranker only, no symbol nudge
   *   "keyword+symbol"  keyword ranker + symbol-boost
   *   "hybrid"          BM25 (FTS5) + semantic + symbol via reciprocal
   *                     rank fusion. Requires workspaceId + an embedding
   *                     index (falls back honestly otherwise).
   */
  forceStrategy?: "auto" | "semantic-only" | "keyword-only" | "keyword+symbol" | "hybrid";
}

/**
 * Full retrieval result: chunks **plus** the metadata describing how
 * they were produced. The metadata is what `/api/workspaces/:id/search`
 * and the eval harness need to know — which path actually ran,
 * whether the semantic index was usable, how many candidates we
 * considered, anything that went wrong.
 *
 * The earlier `retrieveRelevantChunks` (chunks-only) form is kept as a
 * thin wrapper for the chat path which doesn't care about the meta.
 */
export type RetrievalStrategy =
  | "semantic"
  | "keyword"
  | "keyword+symbol"
  | "hybrid"
  | "none";

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  /** Which path actually produced the chunks. */
  strategy: RetrievalStrategy;
  /** True only if at least one stored chunk exists for the workspace AND
   *  the active embedding provider matches it. False means the keyword
   *  fallback ran even if `chunk_embeddings` had rows. */
  hasEmbeddingIndex: boolean;
  /** Provider id of the stored chunks (e.g. "openai", "ollama") — null
   *  when there is no semantic index or it is unusable. */
  embeddingProvider: string | null;
  /** How many chunks the scorer actually evaluated before slicing topK. */
  candidateCount: number;
  /** Free-form notes — index out of date, no extractable tokens, … */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Chunks-only wrapper kept for the chat / action paths that don't
 * inspect retrieval metadata. New callers should prefer `retrieveWithMeta`.
 */
export async function retrieveRelevantChunks(
  rootPath: string,
  files: FileMeta[],
  query: string,
  options: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const result = await retrieveWithMeta(rootPath, files, query, options);
  return result.chunks;
}

/**
 * Return up to `topK` workspace chunks plus the metadata describing
 * what actually happened.
 *
 * Strategy:
 *   1. If a workspaceId is set AND an embedding index exists for that
 *      workspace AND the active embedding provider matches the stored
 *      one, score by cosine similarity. → strategy = "semantic".
 *   2. Otherwise fall back to the local keyword ranker. When the
 *      symbol_index has matches for the query tokens, the per-file
 *      symbol-hit set adds a +2.0 nudge on every chunk inside those
 *      files. → strategy = "keyword+symbol" (or just "keyword" when
 *      no symbol matches were found).
 *   3. When the query has no extractable tokens AND there's no semantic
 *      index, chunks is empty. → strategy = "none".
 *
 * The metadata fields let `/api/workspaces/:id/search` and the eval
 * harness say true things — "indexed" was previously equivalent to
 * "any result exists", which is wrong.
 */
export async function retrieveWithMeta(
  rootPath: string,
  files: FileMeta[],
  query: string,
  options: RetrieveOptions = {},
): Promise<RetrievalResult> {
  const topK = options.topK ?? DEFAULT_TOP_K;
  const warnings: string[] = [];
  const force = options.forceStrategy ?? "auto";

  // ── semantic-only honesty: when the caller pinned this strategy and
  //    can't run it (no workspaceId), return empty + warning instead of
  //    silently falling through to keyword. The strategy harness
  //    depends on this — its whole purpose is to compare paths fairly.
  if (force === "semantic-only" && !options.workspaceId) {
    return {
      chunks: [],
      strategy: "none",
      hasEmbeddingIndex: false,
      embeddingProvider: null,
      candidateCount: 0,
      warnings: ["forceStrategy=semantic-only requires workspaceId (none provided)"],
    };
  }

  // ── hybrid: BM25 + semantic + symbol candidates merged via RRF.
  //    Requires workspaceId for all three sub-searches. We deliberately
  //    don't have hybrid fall through to keyword when the index is
  //    missing — same honesty rule as semantic-only.
  if (force === "hybrid") {
    if (!options.workspaceId) {
      return {
        chunks: [],
        strategy: "none",
        hasEmbeddingIndex: false,
        embeddingProvider: null,
        candidateCount: 0,
        warnings: ["forceStrategy=hybrid requires workspaceId (none provided)"],
      };
    }
    return retrieveByHybridMeta(options.workspaceId, query, topK, options.rerank);
  }

  // ── auto → hybrid (cycle-2 P1). The default/chat/action path fuses BM25 +
  //    vector + symbol via RRF whenever an embedding index exists. Hybrid
  //    measured strictly better than dense-only on the eval harness
  //    (Hit@1 76.5% vs 52.9%, MRR 0.877 vs 0.697), but it used to be reachable
  //    only via an explicit forceStrategy — so the live chat path silently ran
  //    dense-only. With no index to fuse over, hybrid yields nothing and we
  //    fall through to keyword+symbol below (unchanged behaviour for un-indexed
  //    or provider-mismatched workspaces).
  if (force === "auto" && options.workspaceId) {
    const hybrid = await retrieveByHybridMeta(options.workspaceId, query, topK, options.rerank);
    if (hybrid.chunks.length > 0) return hybrid;
    if (hybrid.warnings.length > 0) warnings.push(...hybrid.warnings);
  }

  // ── semantic-only → pure vector path (an eval-comparison strategy). Returns
  //    whatever the semantic path produces, including an honest empty result,
  //    WITHOUT falling through to keyword — that's the point of the flag.
  if (force === "semantic-only" && options.workspaceId) {
    const semantic = await retrieveBySimilarityMeta(options.workspaceId, query, topK);
    if (semantic.usable) {
      return {
        chunks: semantic.chunks,
        strategy: "semantic",
        hasEmbeddingIndex: true,
        embeddingProvider: semantic.provider,
        candidateCount: semantic.candidateCount,
        warnings: semantic.warnings,
      };
    }
    return {
      chunks: [],
      strategy: "none",
      hasEmbeddingIndex: false,
      embeddingProvider: semantic.provider,
      candidateCount: 0,
      warnings: ["forceStrategy=semantic-only and no usable index", ...semantic.warnings],
    };
  }

  // ── keyword+symbol honesty: caller asked for the symbol boost but
  //    can't run the symbol lookup (no workspaceId → no symbol_index
  //    table to query). Emit a warning so the harness comparison row
  //    isn't misread as "keyword+symbol passed, same as keyword".
  if (force === "keyword+symbol" && !options.workspaceId) {
    warnings.push("forceStrategy=keyword+symbol requires workspaceId for symbol lookup — degenerates to keyword");
  }

  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return {
      chunks: [],
      strategy: "none",
      hasEmbeddingIndex: false,
      embeddingProvider: null,
      candidateCount: 0,
      warnings: [...warnings, "no extractable tokens in query"],
    };
  }

  // Symbol-boosted set — paths whose code symbols match a query token
  // get a fixed bonus on every chunk they own. Skipped when the caller
  // pinned "keyword-only" (the harness uses that to isolate the
  // boost's effect from the raw keyword baseline).
  const useSymbolBoost = force === "auto" || force === "keyword+symbol";
  const symbolHitPaths = useSymbolBoost && options.workspaceId
    ? new Set(
        dbLookupSymbolMatches(options.workspaceId, tokens).map((s) => s.path),
      )
    : new Set<string>();

  const chunkChars = options.chunkChars ?? CHUNK_CHARS;

  // Pick candidate files. We don't read everything — sort by size so the
  // small content-dense files (READMEs, configs) lead, while still letting
  // mid-size files be considered. Eligibility goes through the shared
  // helper so the basename allowlist (Makefile, Dockerfile, ...) and
  // the extension allowlist stay in one place.
  const candidates = files
    .filter(isRetrievalEligible)
    .sort((a, b) => a.size - b.size)
    .slice(0, MAX_FILES_READ);
  // Coverage warning: if the workspace has files but most aren't
  // readable, the user will get sparse answers and no idea why.
  // Surface it as a structured warning so the UI / chat / search
  // route can show it. Threshold 0.5 catches the C-project case
  // (1/7 = 14%) without firing on a workspace that's mostly
  // images/binaries by intent.
  if (files.length >= 3) {
    const ratio = candidates.length / files.length;
    if (ratio < 0.5) {
      warnings.push(
        `Only ${candidates.length.toString()} of ${files.length.toString()} files are readable by the retriever (${(ratio * 100).toFixed(0)}% coverage). Files with unsupported extensions or no extension are skipped — add them to READABLE_EXT/READABLE_BASENAME in services/retrieval.ts if they should be searchable.`,
      );
    }
  }

  // Read concurrently — file system is the bottleneck, not CPU.
  const fileContents = await Promise.all(
    candidates.map(async (f) => {
      const text = await readTextUnderRoot(rootPath, f.path, FILE_READ_BUDGET);
      return text == null ? null : { path: f.path, content: text };
    }),
  );

  const allChunks: RetrievedChunk[] = [];
  for (const fc of fileContents) {
    if (!fc) continue;
    const chunks = chunkText(fc.content, chunkChars);
    for (const chunk of chunks) {
      let score = scoreChunk(chunk, fc.path, tokens);
      // Symbol-match nudge: + 2.0 for every chunk inside a file whose
      // code symbols matched a query term. Strong but not dominating —
      // a chunk with no other relevance still ranks below one with
      // both symbol match and term hits.
      if (symbolHitPaths.has(fc.path)) score += 2.0;
      if (score > 0) {
        allChunks.push({ path: fc.path, chunk, score });
      }
    }
  }

  // Sort by descending score, then prefer earlier (likely more focused)
  // chunks as a deterministic tiebreaker.
  allChunks.sort((a, b) => b.score - a.score);
  // Strategy label: when the harness pinned "keyword-only" we report
  // exactly that even when no symbol matches existed (so the column
  // in the comparison table reflects the *requested* strategy, not an
  // accidental degenerate case). Otherwise the label reflects what
  // actually happened.
  const finalStrategy: RetrievalStrategy =
    force === "keyword-only"
      ? "keyword"
      : symbolHitPaths.size > 0
        ? "keyword+symbol"
        : "keyword";
  return {
    chunks: allChunks.slice(0, topK),
    strategy: finalStrategy,
    hasEmbeddingIndex: false,
    embeddingProvider: null,
    candidateCount: allChunks.length,
    warnings,
  };
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

/**
 * Query-relevant extraction for an over-budget attachment.
 *
 * When an attached document is larger than the model's text budget, naive
 * head-truncation (`text.slice(0, budget)`) keeps the front matter — title,
 * abstract, table of contents — and drops the body, so the model "analyses"
 * only the first few pages. (This is the exact failure that made a 143-page
 * thesis review critique only the table of contents.) Instead, chunk the
 * document, keep the chunks most relevant to the query up to the budget, and
 * return them IN ORIGINAL DOCUMENT ORDER.
 *
 * Order-preserving on purpose: OP-RAG (arXiv:2409.01666) shows that for
 * long-document QA, selecting the relevant chunks but keeping them in their
 * original order beats both full-context ingestion and relevance-ordered
 * concatenation — relevance picks WHAT to keep, position decides the ORDER.
 *
 * Reuses the same keyword chunker/scorer as workspace retrieval: no embeddings,
 * no async, and Korean/CJK queries work (whole-run tokens). Falls back to
 * head-truncation only when the query has no usable tokens (an attachment sent
 * with no question — nothing to rank against).
 */
export function extractRelevantWithinBudget(text: string, query: string, budget: number): string {
  if (text.length <= budget) return text;
  const tokens = tokenize(query);
  if (tokens.length === 0) return text.slice(0, budget);

  const chunks = chunkText(text, CHUNK_CHARS);
  const scored = chunks.map((chunk, index) => ({
    chunk,
    index,
    score: scoreChunk(chunk, "", tokens),
  }));
  return packByScore(scored, budget) ?? text.slice(0, budget);
}

/**
 * Semantic sibling of extractRelevantWithinBudget: rank the over-budget
 * document's chunks by EMBEDDING similarity to the query rather than keyword
 * overlap, then keep the most relevant within budget, in original order. This
 * catches conceptual matches the keyword version misses — the query's words
 * needn't literally appear in the relevant passage ("methodological weakness"
 * surfaces the methods section even if it never uses those words).
 *
 * Returns null — so the caller falls back to the keyword extractor — when the
 * document fits, there's no embedding provider, the embed call fails, or nothing
 * scored. Reuses the same chunker + cosine as workspace retrieval; embeds the
 * chunks on the fly (no persistence in v1), so it only runs on the over-budget
 * path, which is already the heavy/local case.
 */
export async function extractRelevantWithinBudgetSemantic(
  text: string,
  query: string,
  budget: number,
): Promise<string | null> {
  if (text.length <= budget) return null;
  // No usable query terms → nothing to rank semantically; fall back to the
  // keyword/head-truncation path (mirrors the keyword extractor's guard).
  if (tokenize(query).length === 0) return null;

  const chunks = chunkText(text, CHUNK_CHARS);
  // Bound the embedding work on the chat hot path: a very large document would
  // mean hundreds of sequential local embeds before the answer can stream. Above
  // the cap (or with nothing to chunk), fall back to the instant keyword extractor.
  if (chunks.length === 0 || chunks.length > SEMANTIC_MAX_CHUNKS) return null;

  const provider = await getEmbeddingProvider();
  if (!provider) return null;

  let queryVec: Float32Array;
  let vectors: number[][];
  try {
    queryVec = new Float32Array(await provider.embed(query));
    vectors = await provider.embedMany(chunks);
  } catch {
    return null;
  }
  const qNorm = vectorNorm(queryVec);
  if (qNorm === 0) return null;

  const scored = chunks.map((chunk, index) => {
    const v = vectors[index];
    const score = v && v.length > 0 ? cosineSimilarity(queryVec, qNorm, new Float32Array(v)) : 0;
    return { chunk, index, score };
  });
  return packByScore(scored, budget);
}

/**
 * Greedily keep the highest-scoring chunks within `budget`, then emit them in
 * ORIGINAL document order (order-preserving — relevance picks what to keep,
 * position decides the order; OP-RAG arXiv:2409.01666). Stops at the first
 * non-positive score: a chunk with no relevance signal adds only
 * lost-in-the-middle distraction, so we'd rather leave the budget unspent.
 * Returns null when nothing positive scored, so the caller can fall back.
 */
function packByScore(
  scored: { chunk: string; index: number; score: number }[],
  budget: number,
): string | null {
  const kept: { chunk: string; index: number; score: number }[] = [];
  let used = 0;
  for (const c of [...scored].sort((a, b) => b.score - a.score)) {
    if (c.score <= 0) break;
    const cost = c.chunk.length + 2; // +2 for the "\n\n" join
    if (used + cost > budget) continue; // a smaller, lower-ranked chunk may still fit
    kept.push(c);
    used += cost;
  }
  if (kept.length === 0) return null;
  kept.sort((a, b) => a.index - b.index);
  return kept.map((c) => c.chunk).join("\n\n");
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
function chunkText(content: string, maxChars: number, label?: string): string[] {
  const out: string[] = [];
  if (!content.trim()) return out;

  // Cycle-2 P2 — structural contextual chunking. When `label` (the file path)
  // is supplied, prepend a short "path › nearest-heading" header to each chunk
  // BEFORE it is embedded / BM25-indexed, so the chunk's document identity and
  // section survive into the index. A no-LLM approximation of Contextual
  // Retrieval (Anthropic) — the document context is the single biggest thing a
  // bare chunk loses. No-op when label is absent (the keyword fallback already
  // carries a path-match bonus, so it doesn't need this).
  let heading = "";
  const withContext = (body: string): string => {
    if (!label) return body;
    const ctx = heading ? `${label} › ${heading}` : label;
    return `${ctx}\n\n${body}`;
  };

  const paragraphs = content.split(/\n{2,}/);
  let current = "";
  for (const p of paragraphs) {
    const h = headingOf(p);
    if (h) heading = h;
    if (current.length + p.length + 2 <= maxChars) {
      current += (current ? "\n\n" : "") + p;
      continue;
    }
    if (current) {
      out.push(withContext(current));
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
      out.push(withContext(current.slice(0, cut)));
      const tail = current.slice(cut - CHUNK_OVERLAP, cut);
      current = (tail.trim() ? tail : "") + current.slice(cut);
    }
  }
  if (current.trim()) out.push(withContext(current));
  return out;
}

/** The section a chunk sits under: a Markdown ATX heading's text, or "" when
 *  the paragraph isn't a heading (code files rarely have one → path-only). */
function headingOf(paragraph: string): string {
  const first = (paragraph.split("\n", 1)[0] ?? "").trim();
  const md = first.match(/^#{1,6}\s+(.{1,80}?)\s*#*$/);
  return md ? md[1]!.trim() : "";
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

// ---------------------------------------------------------------------------
// Embedding-based retrieval — opt-in semantic search via stored vectors
// ---------------------------------------------------------------------------

/**
 * Incrementally re-build the embedding index for a workspace. Called
 * after a workspace scan completes. No-op when no embedding provider
 * is reachable — the caller's chat / retrieval paths fall back to
 * keyword retrieval automatically.
 *
 * Incremental shape:
 *   - Per-file content hash (SHA-256 of the read-budget-truncated
 *     bytes) is stored alongside each chunk row.
 *   - On the next scan we pull the stored (mtime, hash) per path,
 *     then:
 *       - unchanged hash → skip (keep existing rows)
 *       - changed hash → delete the file's rows, re-embed
 *       - file gone from disk → delete its rows
 *   - mtime is the cheap pre-check: same mtime + stored hash → no
 *     need to hash the file again.
 *
 * The result reports a richer shape than before so the caller can
 * surface "we re-embedded 3 files, kept 17, dropped 1" — useful
 * debugging info for the indexer.
 */
export async function indexWorkspaceEmbeddings(
  workspaceId: string,
  rootPath: string,
  files: FileMeta[],
  /** Optional per-file summarizer (built from a cheap/local model by the caller).
   *  When present, large changed files also get a file-level summary indexed as a
   *  retrievable unit (RAPTOR-lite) so holistic cross-file questions have
   *  something to match. Absent → leaf-chunk indexing only, unchanged. */
  summarize?: (path: string, text: string) => Promise<string | null>,
): Promise<{
  indexed: number;
  provider: string | null;
  reembedded: number;
  unchanged: number;
  removed: number;
}> {
  const provider = await getEmbeddingProvider();
  if (!provider) return { indexed: 0, provider: null, reembedded: 0, unchanged: 0, removed: 0 };

  // Same eligibility rules as the keyword path — routed through the
  // shared helper so the C-family + Makefile/Dockerfile basename
  // allowlist applies to indexing too.
  const candidates = files
    .filter(isRetrievalEligible)
    .sort((a, b) => a.size - b.size)
    .slice(0, MAX_FILES_READ);

  // What's currently stored: path → {mtime, hash}. We'll compare each
  // candidate against this to decide skip vs re-embed.
  const stored = dbListChunkPathDigests(workspaceId);

  interface PendingFile {
    path: string;
    mtime: number;
    hash: string;
    text: string;
  }
  const pendingForEmbed: PendingFile[] = [];
  let unchanged = 0;

  for (const f of candidates) {
    const abs = safeResolveUnderRoot(rootPath, f.path);
    if (!abs) continue;
    let text: string;
    let mtime: number;
    try {
      const stat = await fs.promises.stat(abs);
      mtime = Math.floor(stat.mtimeMs);
      const buf = await fs.promises.readFile(abs, "utf-8");
      text = buf.length > FILE_READ_BUDGET ? buf.slice(0, FILE_READ_BUDGET) : buf;
    } catch {
      continue;
    }
    const prev = stored.get(f.path);
    // Fast-path skip: stored row exists, mtime matches, AND stored
    // hash matches what we just hashed. The mtime check is the cheap
    // gate; the hash check catches mtime-touched-but-content-same
    // edits (e.g. `touch` without modifying).
    const hash = crypto.createHash("sha256").update(text).digest("hex");
    if (prev && prev.hash === hash) {
      unchanged++;
      // Mark as "seen" so we don't accidentally delete it below.
      stored.delete(f.path);
      continue;
    }
    pendingForEmbed.push({ path: f.path, mtime, hash, text });
    // Mark as "seen" — anything still in `stored` after this loop is
    // no longer on disk (or no longer a candidate) and gets removed.
    stored.delete(f.path);
  }

  // Files that were stored but no longer eligible / on disk: drop them.
  const removedPaths = Array.from(stored.keys());
  if (removedPaths.length > 0) {
    dbDeleteChunksByPath(workspaceId, removedPaths);
  }

  if (pendingForEmbed.length === 0) {
    // No changed / new files. Still report counts so the caller knows
    // the indexer ran. Don't touch unchanged rows.
    return {
      indexed: 0,
      provider: provider.id,
      reembedded: 0,
      unchanged,
      removed: removedPaths.length,
    };
  }

  // Drop the changed files' old rows BEFORE inserting new ones (so a
  // mid-flight crash doesn't leave doubled chunks).
  dbDeleteChunksByPath(workspaceId, pendingForEmbed.map((p) => p.path));

  // Chunk the changed files + flatten so we can embed in one batch.
  const allChunks: { path: string; chunk: string; index: number; mtime: number; hash: string }[] = [];
  for (const p of pendingForEmbed) {
    const chunks = chunkText(p.text, CHUNK_CHARS, p.path);
    chunks.forEach((chunk, idx) => {
      allChunks.push({ path: p.path, chunk, index: idx, mtime: p.mtime, hash: p.hash });
    });
  }

  // RAPTOR-lite: a per-file summary as an extra retrievable unit (chunk_index
  // -1). Leaf chunks answer specific questions well, but a holistic "what is
  // this codebase / these notes about?" has no single chunk to match — the
  // summary gives it one. Bounded + best-effort: only files big enough that a
  // leaf chunk can't represent them, only the largest few per pass (so a huge
  // workspace's first index stays cheap), and a failed/slow summary just means
  // no summary row — leaf chunks are unchanged. Embedded + stored alongside the
  // real chunks below, so it rides the same incremental + hybrid-retrieval path.
  if (summarize) {
    const SUMMARY_MIN_CHARS = 2_000;
    const SUMMARY_MAX_FILES = 15;
    const bigFiles = pendingForEmbed
      .filter((p) => p.text.length >= SUMMARY_MIN_CHARS)
      .sort((a, b) => b.text.length - a.text.length)
      .slice(0, SUMMARY_MAX_FILES);
    for (const p of bigFiles) {
      const summary = await summarize(p.path, p.text).catch(() => null);
      if (summary && summary.trim()) {
        allChunks.push({
          path: p.path,
          chunk: `[File summary] ${p.path}\n${summary.trim()}`,
          index: -1,
          mtime: p.mtime,
          hash: p.hash,
        });
      }
    }
  }

  if (allChunks.length === 0) {
    return {
      indexed: 0,
      provider: provider.id,
      reembedded: pendingForEmbed.length,
      unchanged,
      removed: removedPaths.length,
    };
  }

  let vectors: number[][];
  try {
    vectors = await provider.embedMany(allChunks.map((c) => c.chunk));
  } catch (err) {
    logger.warn({ workspaceId, err }, "embedding indexer failed");
    return {
      indexed: 0,
      provider: provider.id,
      reembedded: pendingForEmbed.length,
      unchanged,
      removed: removedPaths.length,
    };
  }

  const now = new Date().toISOString();
  const rows: ChunkEmbeddingRow[] = [];
  for (let i = 0; i < allChunks.length; i++) {
    const c = allChunks[i];
    const v = vectors[i];
    if (!c || !v || v.length === 0) continue;
    rows.push({
      id: crypto.randomUUID(),
      workspaceId,
      provider: provider.id,
      dimensions: v.length,
      path: c.path,
      chunk: c.chunk,
      chunkIndex: c.index,
      fileMtime: c.mtime,
      fileHash: c.hash,
      embedding: new Float32Array(v),
      indexedAt: now,
    });
  }

  dbInsertChunkEmbeddings(rows);
  return {
    indexed: rows.length,
    provider: provider.id,
    reembedded: pendingForEmbed.length,
    unchanged,
    removed: removedPaths.length,
  };
}

/**
 * Drop-everything reset — used by tooling that wants a forced full
 * re-index (e.g. after the chunk size or read budget changed). Not
 * called by the regular scan path.
 */
export function resetWorkspaceEmbeddings(workspaceId: string): void {
  dbClearWorkspaceEmbeddings(workspaceId);
}

/**
 * Metadata-returning semantic retrieval. The caller decides what to
 * report based on `usable`:
 *  - `usable: false` → fall through to keyword. `warnings` says why
 *    (no stored chunks, no provider, provider/index mismatch, embed
 *    call failed, zero-norm query embedding).
 *  - `usable: true` → use `chunks` as-is. `provider` + `candidateCount`
 *    feed into the upstream RetrievalResult.
 */
interface SemanticResultMeta {
  usable: boolean;
  chunks: RetrievedChunk[];
  provider: string | null;
  candidateCount: number;
  warnings: string[];
}

async function retrieveBySimilarityMeta(
  workspaceId: string,
  query: string,
  topK: number,
): Promise<SemanticResultMeta> {
  const stored = dbListWorkspaceChunks(workspaceId);
  if (stored.length === 0) {
    return { usable: false, chunks: [], provider: null, candidateCount: 0, warnings: ["no embedding index"] };
  }

  const provider = await getEmbeddingProvider();
  if (!provider) {
    return {
      usable: false,
      chunks: [],
      provider: stored[0]?.provider ?? null,
      candidateCount: 0,
      warnings: ["no embedding provider configured"],
    };
  }

  const indexProvider = stored[0]?.provider ?? null;
  if (!indexProvider || indexProvider !== provider.id) {
    logger.info(
      { workspaceId, indexProvider, activeProvider: provider.id },
      "embedding index out of date — falling back",
    );
    return {
      usable: false,
      chunks: [],
      provider: indexProvider,
      candidateCount: 0,
      warnings: [`index provider "${indexProvider ?? "unknown"}" ≠ active "${provider.id}" — reindex needed`],
    };
  }

  let queryVec: Float32Array;
  try {
    queryVec = new Float32Array(await provider.embed(query));
  } catch (err) {
    logger.warn({ workspaceId, err }, "embedding query failed — falling back");
    return {
      usable: false,
      chunks: [],
      provider: provider.id,
      candidateCount: 0,
      warnings: ["embedding the query failed — falling back to keyword"],
    };
  }

  const qNorm = vectorNorm(queryVec);
  if (qNorm === 0) {
    return {
      usable: true,
      chunks: [],
      provider: provider.id,
      candidateCount: 0,
      warnings: ["zero-norm query vector (empty query?)"],
    };
  }

  const scored: { chunk: StoredChunk; score: number }[] = [];
  for (const s of stored) {
    const sim = cosineSimilarity(queryVec, qNorm, s.embedding);
    if (sim > 0) scored.push({ chunk: s, score: sim });
  }
  scored.sort((a, b) => b.score - a.score);
  return {
    usable: true,
    chunks: scored.slice(0, topK).map((s) => ({
      path: s.chunk.path,
      chunk: s.chunk.chunk,
      score: s.score,
    })),
    provider: provider.id,
    candidateCount: scored.length,
    warnings: [],
  };
}

/**
 * Legacy chunks-or-null helper — kept so the older signature compiles
 * for any caller that still uses it directly. Prefer
 * `retrieveBySimilarityMeta` for new code; this one drops the warnings.
 */
async function retrieveBySimilarity(
  workspaceId: string,
  query: string,
  topK: number,
): Promise<RetrievedChunk[] | null> {
  const stored = dbListWorkspaceChunks(workspaceId);
  if (stored.length === 0) return null;

  const provider = await getEmbeddingProvider();
  if (!provider) return null;

  // The stored index was produced by one specific model — if the
  // active provider doesn't match (model changed, dimensions changed),
  // bail rather than mixing geometries. The caller falls back to
  // keyword and re-indexing will catch this up on the next scan.
  const indexProvider = stored[0]?.provider;
  if (!indexProvider || indexProvider !== provider.id) {
    logger.info(
      { workspaceId, indexProvider, activeProvider: provider.id },
      "embedding index out of date — falling back",
    );
    return null;
  }

  let queryVec: Float32Array;
  try {
    queryVec = new Float32Array(await provider.embed(query));
  } catch (err) {
    logger.warn({ workspaceId, err }, "embedding query failed — falling back");
    return null;
  }

  // Cosine similarity in JS — corpora are O(hundreds) of chunks per
  // workspace, well within in-process scoring budget. Pre-norm the
  // query once.
  const qNorm = vectorNorm(queryVec);
  if (qNorm === 0) return [];

  const scored: { chunk: StoredChunk; score: number }[] = [];
  for (const s of stored) {
    const sim = cosineSimilarity(queryVec, qNorm, s.embedding);
    if (sim > 0) scored.push({ chunk: s, score: sim });
  }
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map((s) => ({
    path: s.chunk.path,
    chunk: s.chunk.chunk,
    score: s.score,
  }));
}

/**
 * Hybrid retrieval — three sub-searches merged via reciprocal rank
 * fusion. Returns `RetrievalResult` directly so the caller doesn't
 * need to know about RRF mechanics.
 *
 * Sources:
 *   - BM25 over `chunk_fts` (FTS5)
 *   - vector cosine over `chunk_embeddings`
 *   - symbol matches: each chunk inside a path with a matching code
 *     symbol gets a synthetic rank in this list (ordered by chunk_index)
 *
 * Fusion: standard RRF with k=60. Each chunk's hybrid score is
 *   sum(1 / (k + rank_i))  for i in {bm25, vector, symbol}
 * where missing-from-list means that term contributes 0.
 *
 * Returns empty + warning when neither BM25 nor vector produced any
 * candidates (symbol-only is rarely strong enough by itself).
 */
async function retrieveByHybridMeta(
  workspaceId: string,
  query: string,
  topK: number,
  rerank?: RerankFn,
): Promise<RetrievalResult> {
  // Pull a larger candidate set per source than the final topK so
  // the fusion has something to merge. 30 each is a reasonable v1.
  const SUB_TOPK = Math.max(topK * 3, 30);
  const RRF_K = 60;
  const warnings: string[] = [];

  // ── BM25 (FTS5) — synchronous in-process SQLite, runs instantly.
  const bm25 = dbBm25Search(workspaceId, query, SUB_TOPK);

  // ── Symbol matches — same prefix-LIKE used by the keyword+symbol
  //    path. Returns paths; we expand to all chunks for those paths
  //    by querying chunk_fts (cheap, already in memory after BM25).
  const tokens = tokenize(query);
  const symbolPaths = tokens.length > 0
    ? new Set(dbLookupSymbolMatches(workspaceId, tokens).map((s) => s.path))
    : new Set<string>();

  // ── Vector cosine — same path the semantic-only strategy uses.
  const semantic = await retrieveBySimilarityMeta(workspaceId, query, SUB_TOPK);
  if (!semantic.usable && semantic.warnings.length > 0) {
    warnings.push(...semantic.warnings);
  }

  // Build a per-chunk RRF score, keyed by `${path}#${chunk_index}`.
  // chunkData maps key → the chunk record itself (for the final result).
  const rrf = new Map<string, number>();
  const chunkData = new Map<string, RetrievedChunk>();

  function addRank(key: string, rank: number, chunk: RetrievedChunk): void {
    const inc = 1 / (RRF_K + rank);
    rrf.set(key, (rrf.get(key) ?? 0) + inc);
    if (!chunkData.has(key)) chunkData.set(key, chunk);
  }

  // BM25 contributes its ranking.
  for (let i = 0; i < bm25.length; i++) {
    const b = bm25[i]!;
    const key = `${b.path}#${b.chunkIndex.toString()}`;
    addRank(key, i + 1, { path: b.path, chunk: b.chunk, score: 0 });
  }

  // Vector contributes its ranking. The vector path doesn't expose
  // chunk_index directly through StoredChunk, so we fall back to the
  // stored chunk text itself as a disambiguator when chunk_index is
  // absent (it's optional on StoredChunk). For most cases the same
  // path+text combo is unique inside a workspace.
  if (semantic.usable) {
    for (let i = 0; i < semantic.chunks.length; i++) {
      const v = semantic.chunks[i]!;
      // Best-effort chunk_index: match against BM25 row with same path
      // + text. Falls back to a stable hash-ish key when not present.
      const known = bm25.find((b) => b.path === v.path && b.chunk === v.chunk);
      const key = `${v.path}#${known ? known.chunkIndex.toString() : "v" + i.toString()}`;
      addRank(key, i + 1, v);
    }
  }

  // Symbol contributes via path membership — every chunk inside a
  // symbol-matched path gets the same synthetic rank (the first
  // available rank in the symbol list). We don't have a natural
  // ordering across paths; rank 1 for every symbol path is reasonable.
  // Limited to chunks we've already seen via BM25 / vector so we
  // don't synthesise chunk records we don't have text for.
  if (symbolPaths.size > 0) {
    for (const [key, chunk] of chunkData.entries()) {
      if (symbolPaths.has(chunk.path)) {
        addRank(key, 1, chunk);
      }
    }
  }

  // Sort by descending RRF score. Score field on the returned chunks carries
  // the RRF score (not BM25 / cosine) so the harness / UI can show a
  // meaningful number.
  const fullRanked = Array.from(rrf.entries())
    .map(([key, score]) => {
      const chunk = chunkData.get(key)!;
      // Demote per-file summary rows (chunk_index = -1) so they don't crowd out
      // precise leaf chunks on a specific question; they still rank for holistic
      // queries where they match across many terms.
      return { ...chunk, score: key.endsWith("#-1") ? score * SUMMARY_RRF_WEIGHT : score };
    })
    .sort((a, b) => b.score - a.score);

  // Optional second-pass rerank: widen to a candidate pool and let the model
  // reorder by relevance to this query before the final slice. The reranker
  // fails safe to the fused order, so this never makes results worse than the
  // plain RRF slice.
  const ranked =
    rerank && fullRanked.length > 1
      ? await rerank(query, fullRanked.slice(0, RERANK_POOL), topK)
      : fullRanked.slice(0, topK);

  // Strategy = "none" only when there were no candidates at all.
  if (ranked.length === 0) {
    return {
      chunks: [],
      strategy: "none",
      hasEmbeddingIndex: semantic.usable,
      embeddingProvider: semantic.provider,
      candidateCount: 0,
      warnings: [
        ...warnings,
        "hybrid: no BM25 + vector + symbol candidates",
      ],
    };
  }

  return {
    chunks: ranked,
    strategy: "hybrid",
    hasEmbeddingIndex: semantic.usable,
    embeddingProvider: semantic.provider,
    candidateCount: rrf.size,
    warnings,
  };
}

function vectorNorm(v: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i] ?? 0;
    sum += x * x;
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(a: Float32Array, aNorm: number, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let bSqr = 0;
  for (let i = 0; i < a.length; i++) {
    const ax = a[i] ?? 0;
    const bx = b[i] ?? 0;
    dot += ax * bx;
    bSqr += bx * bx;
  }
  const bNorm = Math.sqrt(bSqr);
  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (aNorm * bNorm);
}
