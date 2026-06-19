/**
 * LLM reranker — a second-pass relevance ordering over retrieved candidates.
 *
 * Hybrid retrieval (BM25 + vector + symbol via RRF) is strong at *recall* —
 * pulling the right chunks into a candidate set — but its fused score is
 * positional, not a judgement about *this* question. A cross-encoder-style
 * rerank, where the model sees the query and each candidate together, lifts
 * precision@k and fights "lost in the middle" (arXiv:2307.03172): the chunk
 * that actually answers the question is moved to the top, distractors drop
 * out of the top-k. The long-document RAG literature (RAPTOR arXiv:2401.18059,
 * OP-RAG arXiv:2409.01666) is consistent on this — *selecting and ordering*
 * the retrieved set, not retrieving more, is where a cheaper model gains the
 * most on long-doc QA.
 *
 * We have no local cross-encoder, so the chat model itself reranks, listwise:
 * one call — "here are N passages, return the K best by relevance, best
 * first". Bounded (noThink + a small passage budget) and **fails safe** — any
 * parse error, empty answer, or thrown error returns the original retrieval
 * order untouched, so a flaky rerank never makes retrieval worse than not
 * reranking at all.
 */
import type { AiProvider } from "../providers/index.js";
import { extractJson } from "../providers/index.js";
import type { RerankFn, RetrievedChunk } from "./retrieval.js";

/** Cap how many candidates we send to the model — keeps the prompt bounded
 *  and the call cheap. Beyond this, the tail keeps its retrieval order. */
const RERANK_MAX_CANDIDATES = 20;
/** Truncate each passage in the prompt — the model needs enough to judge
 *  relevance, not the whole chunk. ~150 tokens is plenty for a verdict. */
const RERANK_PASSAGE_CHARS = 600;

/**
 * Build a reranker bound to one provider. The returned function matches the
 * `RerankFn` contract retrieval expects: (query, candidates, topK) → reordered
 * top-k. Never throws; never drops a retrieved chunk (it only re-prioritises).
 */
export function makeReranker(provider: AiProvider): RerankFn {
  return async (query, candidates, topK) => {
    // Nothing to reorder — one (or zero) candidate is already its own ranking.
    if (candidates.length <= 1) return candidates.slice(0, topK);

    const pool = candidates.slice(0, RERANK_MAX_CANDIDATES);
    const list = pool
      .map((c, i) => `[${i.toString()}] (${c.path})\n${c.chunk.slice(0, RERANK_PASSAGE_CHARS).trim()}`)
      .join("\n\n");
    const want = Math.min(topK, pool.length);

    let text: string;
    try {
      const res = await provider.complete({
        system:
          "You are a search reranker. You are given a user query and a numbered list of " +
          "passages. Pick the passages that best help answer the query, most relevant first. " +
          "Judge by how directly a passage answers the query — not by length or keyword overlap. " +
          "Return ONLY indices, as JSON.",
        prompt:
          `Query:\n${query}\n\nPassages:\n${list}\n\n` +
          `Return the indices of the ${want.toString()} most relevant passages, most relevant ` +
          `first, as {"ranking": [int, ...]}. Use only indices that appear above.`,
        json: true,
        jsonSchema: {
          name: "rerank",
          schema: {
            type: "object",
            properties: { ranking: { type: "array", items: { type: "integer" } } },
            required: ["ranking"],
            additionalProperties: false,
          },
        },
        // Reranking is a judgement, not a reasoning task — skip qwen3's <think>
        // block so this stays a fast single call rather than 15–60s.
        noThink: true,
      });
      text = res.text;
    } catch {
      // Provider error / abort — fall back to the retrieval order untouched.
      return candidates.slice(0, topK);
    }

    const order = parseRanking(text, pool.length);
    if (order.length === 0) return candidates.slice(0, topK);

    // Reorder by the model's ranking, then append any pool candidate it
    // omitted (we never DROP a retrieved chunk — the rerank only changes
    // priority), then any tail beyond the reranked pool, and finally slice.
    const pickedSet = new Set(order);
    const picked = order.map((i) => pool[i]!);
    const rest = pool.filter((_, i) => !pickedSet.has(i));
    const tail = candidates.slice(RERANK_MAX_CANDIDATES);
    return [...picked, ...rest, ...tail].slice(0, topK);
  };
}

/**
 * Parse the model's `{ "ranking": [...] }` into a clean, de-duplicated list
 * of in-range indices. Returns [] on any malformed output so the caller can
 * fall back to the original order.
 */
function parseRanking(raw: string, n: number): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    return [];
  }
  const arr = (parsed as { ranking?: unknown } | null)?.ranking;
  if (!Array.isArray(arr)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const x of arr) {
    const i = typeof x === "number" ? Math.trunc(x) : Number.NaN;
    if (Number.isInteger(i) && i >= 0 && i < n && !seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  }
  return out;
}
