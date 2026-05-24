/**
 * Retrieval metrics — per-case + aggregate.
 *
 * Scoring is path-based (with an optional `contains` substring on the
 * chunk text). The harness doesn't care about chunk ids — workspaces
 * are small enough that "did the right file come back" is the question.
 */
import type { RetrievedChunk } from "../services/retrieval.js";
import type { RetrievalCase, MustHit } from "./cases.js";

export interface CaseMetrics {
  caseId: string;
  workspace: string;
  query: string;
  /** Wall-clock retrieval latency, milliseconds. */
  latencyMs: number;
  /** How many `mustHit` items the result set covered (any-of). */
  hitCount: number;
  totalMustHit: number;
  /** Position (1-based) of the FIRST mustHit in the ranked result, or 0
   *  if none matched. Used for MRR. */
  firstHitRank: number;
  hitAt1: boolean;
  hitAt3: boolean;
  hitAt6: boolean;
  /** Reciprocal of `firstHitRank`. 0 if no hit. */
  reciprocalRank: number;
  /** Of the returned chunks, how many came from mustHit paths. */
  precisionAt6: number;
  /** Of the mustHit paths, how many appear in the top-6. */
  recallAt6: number;
  /** Any `shouldNotHit` entry that appeared in the top-6. */
  distractorLeaks: string[];
  /** Strategy the retriever reported (echoed for the per-case row). */
  strategy: string;
}

export interface AggregateMetrics {
  cases: number;
  hits: {
    at1: number;
    at3: number;
    at6: number;
  };
  mrr: number;
  meanContextPrecisionAt6: number;
  meanContextRecallAt6: number;
  meanLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  distractorLeakRate: number;
  /** Cases broken down by which strategy actually ran (semantic vs
   *  keyword+symbol vs keyword vs none). Helpful when an embedding
   *  index is partial and only some queries take the semantic path. */
  byStrategy: Record<string, number>;
}

/** Build per-case metrics from a ranked chunk list. */
export function evaluateCase(
  c: RetrievalCase,
  chunks: RetrievedChunk[],
  latencyMs: number,
  strategy: string,
): CaseMetrics {
  const must = c.mustHit ?? [];
  const shouldNot = c.shouldNotHit ?? [];

  const topPaths = chunks.map((ch) => ch.path);
  const top6 = chunks.slice(0, 6);
  const top6Paths = top6.map((ch) => ch.path);

  // First-hit rank: index of the earliest chunk whose path satisfies
  // any mustHit (and matches the optional `contains`).
  let firstHitRank = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (matchesAnyMustHit(chunks[i]!, must)) {
      firstHitRank = i + 1;
      break;
    }
  }

  // hitCount: how many DISTINCT mustHit entries we satisfied somewhere
  // in the top-6. (Hit-recall-at-6.)
  let hitCount = 0;
  for (const m of must) {
    const hit = top6.some((ch) => matchesMustHit(ch, m));
    if (hit) hitCount++;
  }

  const hitAt1 = firstHitRank === 1;
  const hitAt3 = firstHitRank > 0 && firstHitRank <= 3;
  const hitAt6 = firstHitRank > 0 && firstHitRank <= 6;

  const mustPathSet = new Set(must.map((m) => m.path));
  const precisionHits = top6Paths.filter((p) => mustPathSet.has(p)).length;
  const precisionAt6 = top6Paths.length === 0 ? 0 : precisionHits / top6Paths.length;

  const recallAt6 = must.length === 0 ? 0 : hitCount / must.length;

  const distractorLeaks = shouldNot.filter((dist) => top6Paths.includes(dist));

  return {
    caseId: c.id,
    workspace: c.workspace,
    query: c.query,
    latencyMs,
    hitCount,
    totalMustHit: must.length,
    firstHitRank,
    hitAt1,
    hitAt3,
    hitAt6,
    reciprocalRank: firstHitRank === 0 ? 0 : 1 / firstHitRank,
    precisionAt6,
    recallAt6,
    distractorLeaks,
    strategy,
  };
  // Note: we intentionally don't surface unused `topPaths` — kept above
  // for clarity, scoring uses top6.
  void topPaths;
}

/** Aggregate over a list of per-case metrics. */
export function aggregate(rows: CaseMetrics[]): AggregateMetrics {
  if (rows.length === 0) {
    return {
      cases: 0,
      hits: { at1: 0, at3: 0, at6: 0 },
      mrr: 0,
      meanContextPrecisionAt6: 0,
      meanContextRecallAt6: 0,
      meanLatencyMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      distractorLeakRate: 0,
      byStrategy: {},
    };
  }
  const n = rows.length;
  const at1 = rows.filter((r) => r.hitAt1).length / n;
  const at3 = rows.filter((r) => r.hitAt3).length / n;
  const at6 = rows.filter((r) => r.hitAt6).length / n;
  const mrr = rows.reduce((s, r) => s + r.reciprocalRank, 0) / n;
  const precision = rows.reduce((s, r) => s + r.precisionAt6, 0) / n;
  const recall = rows.reduce((s, r) => s + r.recallAt6, 0) / n;
  const meanLatency = rows.reduce((s, r) => s + r.latencyMs, 0) / n;
  const distractorRate = rows.filter((r) => r.distractorLeaks.length > 0).length / n;
  const sorted = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);

  const byStrategy: Record<string, number> = {};
  for (const r of rows) {
    byStrategy[r.strategy] = (byStrategy[r.strategy] ?? 0) + 1;
  }

  return {
    cases: n,
    hits: { at1, at3, at6 },
    mrr,
    meanContextPrecisionAt6: precision,
    meanContextRecallAt6: recall,
    meanLatencyMs: meanLatency,
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    distractorLeakRate: distractorRate,
    byStrategy,
  };
}

function matchesMustHit(chunk: RetrievedChunk, m: MustHit): boolean {
  if (chunk.path !== m.path) return false;
  if (!m.contains) return true;
  return chunk.chunk.toLowerCase().includes(m.contains.toLowerCase());
}

function matchesAnyMustHit(chunk: RetrievedChunk, must: MustHit[]): boolean {
  for (const m of must) {
    if (matchesMustHit(chunk, m)) return true;
  }
  return false;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx] ?? 0;
}
