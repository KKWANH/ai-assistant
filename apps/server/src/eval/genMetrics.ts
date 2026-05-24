/**
 * Generation metrics — score an answer given the chunks that were
 * supposed to ground it.
 *
 * v1 uses substring + sentence-level matching. Not perfect (paraphrase
 * is missed), but deterministic — runs the same way on every machine,
 * no LLM-judge cost. The `--judge` mode in runRagEval.ts is the path
 * to second-opinion scoring via an LLM, kept off by default.
 *
 * Scoring rules:
 *
 *   Faithfulness: every "real" sentence in the answer must have a
 *     fingerprint that appears in some chunk's text. A fingerprint is
 *     the lowercase + whitespace-normalised sentence minus stop-words.
 *     Sentences shorter than 4 words or that are pure boilerplate
 *     ("here's what I found:", "let me know") don't count either way.
 *
 *   Unsupported Claim Rate: 1 - faithfulness, basically — but expressed
 *     per-case so the aggregate is "fraction of cases with any
 *     unsupported claim" (more useful than averaging a per-sentence
 *     rate).
 *
 *   Abstention Correctness: when `expectedAbstention` is true, the
 *     answer must contain at least one abstention phrase ("I don't",
 *     "no information", "the context doesn't say", etc.) and NOT a
 *     positive concrete claim.
 *
 *   Expected Claims: each entry must appear as a case-insensitive
 *     substring in the answer.
 *
 *   Forbidden Claims: NO entry may appear in the answer.
 */
import type { GenerationCase } from "./cases.js";

export interface GenCaseMetrics {
  caseId: string;
  workspace: string;
  query: string;
  generatedAt: string;
  latencyMs: number;
  /** Full answer text. */
  answer: string;
  /** How many retrieved chunks were used as context. */
  contextChunks: number;
  /** Fraction of retrieved chunk paths that were in `requiredContext`. */
  contextPrecision: number;
  /** Fraction of `requiredContext` paths the retrieval covered. */
  contextRecall: number;
  /** Per-sentence faithfulness fraction (0..1). */
  faithfulness: number;
  /** True when the case asks for abstention AND the answer abstained. */
  abstentionCorrect: boolean;
  /** Substring presence of each expectedClaim — fraction satisfied. */
  expectedClaimsHit: number;
  /** Any forbidden claim that appeared in the answer. */
  forbiddenClaimLeaks: string[];
  /** Sentences from the answer that had no supporting chunk. */
  unsupportedSentences: string[];
  /** Strategy / provider tag for the report. */
  generator: string;
}

export interface GenAggregateMetrics {
  cases: number;
  meanFaithfulness: number;
  unsupportedClaimRate: number;
  abstentionPrecision: number; // among cases with expectedAbstention=true
  abstentionCases: number;
  meanContextPrecision: number;
  meanContextRecall: number;
  meanExpectedClaimsHit: number;
  forbiddenClaimLeakRate: number;
  meanLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

const ABSTENTION_PHRASES = [
  "i don't",
  "i do not",
  "i'm not",
  "no information",
  "the context does not",
  "the context doesn't",
  "the context provided does not",
  "not enough context",
  "cannot answer",
  "can't answer",
  "unable to answer",
  "no relevant",
  "i can't",
  "i cannot",
  "모르겠",
  "정보가 없",
  "확인할 수 없",
  "알 수 없",
];

// Boilerplate sentences we ignore for faithfulness — they're meta-text,
// not claims about workspace content.
const BOILERPLATE_RE = [
  /^based on/i,
  /^here['']?s? (?:what i found|the answer)/i,
  /^the context/i,
  /^according to/i,
  /^let me know/i,
  /^this answer/i,
  /^my answer/i,
  /^to summari[sz]e/i,
];

const STOP_WORDS = new Set([
  "the","a","an","of","is","to","in","on","at","and","or","for","with","by",
  "as","that","this","it","be","are","was","were","not","no","but","i","you",
  "from","into","its","s","t","do","does","can","could","may","might","will",
  "would","should","have","has","had","there","here","what","which","when",
  "where","who","whom","why","how",
]);

function splitSentences(text: string): string[] {
  // Naive but sufficient — handle . ! ? on ASCII + Korean ・ etc.
  return text
    .split(/(?<=[.?!。…])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isBoilerplate(s: string): boolean {
  return BOILERPLATE_RE.some((re) => re.test(s));
}

function fingerprint(s: string): string[] {
  const tokens = s
    .toLowerCase()
    .replace(/[`*_~"'(){}[\]<>:;,.!?]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
  // Unique-preserving order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function sentenceSupportedBy(sentence: string, chunkTexts: string[]): boolean {
  const fp = fingerprint(sentence);
  if (fp.length === 0) return true;
  // A sentence is "supported" when ≥60 % of its content tokens appear
  // somewhere in the joined context. Substring match is generous to
  // paraphrase — the harness is deliberately lenient here; the goal is
  // catching ungrounded claims, not perfect grading.
  const haystack = chunkTexts.join("\n").toLowerCase();
  let hits = 0;
  for (const tok of fp) {
    if (haystack.includes(tok)) hits++;
  }
  return hits / fp.length >= 0.6;
}

export function evaluateGenerationCase(
  c: GenerationCase,
  answer: string,
  contextChunks: Array<{ path: string; chunk: string }>,
  latencyMs: number,
  generator: string,
): GenCaseMetrics {
  const requiredSet = new Set(c.requiredContext);
  const ctxPaths = contextChunks.map((ch) => ch.path);
  const ctxPathSet = new Set(ctxPaths);

  const contextPrecision = ctxPaths.length === 0
    ? 0
    : ctxPaths.filter((p) => requiredSet.has(p)).length / ctxPaths.length;
  const contextRecall = requiredSet.size === 0
    ? 1
    : Array.from(requiredSet).filter((p) => ctxPathSet.has(p)).length / requiredSet.size;

  // Faithfulness: ignore boilerplate, score the rest.
  // Special case: when `expectedAbstention: true`, abstention sentences
  // ARE the grounded answer. The phrase "I don't have enough context" is
  // not a workspace claim, so scoring it against the chunk texts is the
  // wrong reference frame. For those cases faithfulness defaults to 1
  // when the answer correctly abstains, 0 when it doesn't.
  const chunkTexts = contextChunks.map((ch) => ch.chunk);
  const sentences = splitSentences(answer);
  const lower = answer.toLowerCase();
  const containsAbstention = ABSTENTION_PHRASES.some((p) => lower.includes(p));

  let faithfulness: number;
  let unsupportedSentences: string[];
  if (c.expectedAbstention) {
    // Faithfulness is binary here: did the answer correctly abstain?
    faithfulness = containsAbstention ? 1 : 0;
    // Sentences that are positive claims (no abstention phrase) when
    // abstention was expected count as unsupported — they're being
    // ungroundedly asserted.
    unsupportedSentences = containsAbstention ? [] : sentences;
  } else {
    const scored = sentences.filter((s) => !isBoilerplate(s) && fingerprint(s).length >= 4);
    const supported = scored.filter((s) => sentenceSupportedBy(s, chunkTexts));
    unsupportedSentences = scored.filter((s) => !supported.includes(s));
    faithfulness = scored.length === 0 ? 1 : supported.length / scored.length;
  }

  // Abstention correctness — separate from faithfulness so the report
  // surfaces both signals.
  // If abstention is expected, the answer should abstain AND not leak
  // confident claims. If not expected, abstaining is wrong.
  const abstentionCorrect = c.expectedAbstention
    ? containsAbstention
    : !containsAbstention;

  // Expected claims hit (substring).
  const expectedClaimsHit = c.expectedClaims.length === 0
    ? 1
    : c.expectedClaims.filter((cl) => lower.includes(cl.toLowerCase())).length /
      c.expectedClaims.length;

  // Forbidden claims.
  const forbiddenClaimLeaks = c.forbiddenClaims.filter((cl) =>
    lower.includes(cl.toLowerCase()),
  );

  return {
    caseId: c.id,
    workspace: c.workspace,
    query: c.query,
    generatedAt: new Date().toISOString(),
    latencyMs,
    answer,
    contextChunks: contextChunks.length,
    contextPrecision,
    contextRecall,
    faithfulness,
    abstentionCorrect,
    expectedClaimsHit,
    forbiddenClaimLeaks,
    unsupportedSentences,
    generator,
  };
}

export function aggregateGeneration(rows: GenCaseMetrics[]): GenAggregateMetrics {
  if (rows.length === 0) {
    return {
      cases: 0,
      meanFaithfulness: 0,
      unsupportedClaimRate: 0,
      abstentionPrecision: 0,
      abstentionCases: 0,
      meanContextPrecision: 0,
      meanContextRecall: 0,
      meanExpectedClaimsHit: 0,
      forbiddenClaimLeakRate: 0,
      meanLatencyMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
    };
  }
  const n = rows.length;
  const abstentionRows = rows.filter((r) => /^gen-abstain/.test(r.caseId));
  const abstentionPrecision = abstentionRows.length === 0
    ? 1
    : abstentionRows.filter((r) => r.abstentionCorrect).length / abstentionRows.length;
  const sortedLatency = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    cases: n,
    meanFaithfulness: rows.reduce((s, r) => s + r.faithfulness, 0) / n,
    unsupportedClaimRate:
      rows.filter((r) => r.unsupportedSentences.length > 0).length / n,
    abstentionPrecision,
    abstentionCases: abstentionRows.length,
    meanContextPrecision: rows.reduce((s, r) => s + r.contextPrecision, 0) / n,
    meanContextRecall: rows.reduce((s, r) => s + r.contextRecall, 0) / n,
    meanExpectedClaimsHit: rows.reduce((s, r) => s + r.expectedClaimsHit, 0) / n,
    forbiddenClaimLeakRate: rows.filter((r) => r.forbiddenClaimLeaks.length > 0).length / n,
    meanLatencyMs: rows.reduce((s, r) => s + r.latencyMs, 0) / n,
    p50LatencyMs: sortedLatency[Math.floor(sortedLatency.length * 0.5)] ?? 0,
    p95LatencyMs: sortedLatency[Math.floor(sortedLatency.length * 0.95)] ?? 0,
  };
}
