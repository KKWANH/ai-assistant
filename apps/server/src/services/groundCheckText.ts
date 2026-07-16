/**
 * groundCheckNote — the "optimistic" text grounding check. The answer is
 * streamed to the user immediately (fast); THEN this re-reads the source
 * materials it rested on (web results / workspace excerpts) and returns a SHORT
 * correction only when a specific claim isn't supported. Most answers are right,
 * so most of the time it returns null and the user just got a fast streamed
 * answer; the occasional fabrication gets a "🔎 correction" note appended.
 *
 * This replaces a full-rewrite pass (which would have to buffer the whole answer
 * and lose streaming). Runs on the fast triage tier; bounded; FAILS SAFE
 * (returns null → no note, the streamed answer stands).
 */
import type { AiProvider } from "../providers/index.js";
import logger from "../logger.js";

const GROUND_CHECK_TIMEOUT_MS = 30_000;

const GROUND_NOTE_SYSTEM =
  "You fact-check an answer against the source materials given in the context (web-search results " +
  "and/or excerpts from the user's files). Check every SPECIFIC claim in the draft — dates, names, " +
  "attributions, numbers, quotations — against those sources.\n" +
  "- If every such claim is supported by the sources, reply with exactly: OK\n" +
  "- If one or more is wrong, contradicted, or unsupported, reply starting with 'FIX:' then a ONE or " +
  "TWO line correction IN THE USER'S LANGUAGE — give the correct fact and name what the draft got " +
  "wrong. Be concise; do NOT restate the whole answer.\n" +
  "Judge only against the provided sources, not your own memory. When in doubt, prefer OK (don't " +
  "manufacture a correction).";

const SELF_CHECK_TIMEOUT_MS = 20_000;

// The NO-SOURCE variant. When an answer was written purely from model memory
// (web search off/declined, no workspace/attachment sources), there is nothing
// to fact-check AGAINST — and ungrounded self-*correction* is known to degrade
// answers (arXiv 2310.01798). So this pass only FLAGS: it names the specific,
// consequential claims (dosages, figures, legal rules, dates, attributions…)
// most worth verifying elsewhere, and never proposes corrections. Biased to
// "OK" so casual answers don't grow a needless warning.
const SELF_CHECK_SYSTEM =
  "You review an answer that was written WITHOUT any source materials — purely from the assistant's own memory. " +
  "Your ONLY job is to flag whether it asserts specific, consequential facts a careful reader should double-check " +
  "elsewhere: medical/health guidance or numbers, drug names or dosages, financial figures, prices, returns, tax or " +
  "legal rules, safety-critical instructions, precise statistics, dates, quotations, or attributions that are " +
  "plausibly misremembered. Everyday common knowledge, opinions, general explanations, and clearly-hedged " +
  "statements do NOT count.\n" +
  "- If nothing needs flagging, reply with exactly: OK\n" +
  "- Otherwise reply starting with 'NOTE:' then ONE line IN THE USER'S LANGUAGE naming the one to three specific " +
  "claims most worth verifying. Do NOT propose corrections — you have no sources either. Do NOT restate the answer.\n" +
  "When in doubt, prefer OK (a needless warning erodes trust).";

/**
 * Returns a one-line "worth double-checking: …" note when a memory-only answer
 * contains consequential specifics, or null when it's fine (or the check can't
 * run / fails / times out). Annotation-only — never modifies the answer.
 */
export async function selfCheckNote(
  provider: AiProvider,
  answer: string,
  userQuestion: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!answer.trim()) return null;

  const prompt =
    `--- User question ---\n${userQuestion}\n\n` +
    `--- ANSWER (written without sources) ---\n${answer}\n--- END ---\n\n` +
    'Reply "OK", or "NOTE: <one line>".';

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      provider.complete({ system: SELF_CHECK_SYSTEM, prompt, signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("self-check timeout")), SELF_CHECK_TIMEOUT_MS);
      }),
    ]);
    const text = result.text.trim();
    const note = /^note:\s*([\s\S]+)/i.exec(text);
    // Only a clear "NOTE: …" produces a flag; "OK" or anything unexpected → no
    // note (fail safe — never append a confusing warning to a good answer).
    return note ? note[1]!.trim() : null;
  } catch (err) {
    logger.warn({ err: String(err) }, "self-check note failed — leaving the answer as-is");
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Returns a concise correction string when the draft contradicts its sources, or
 * null when it's supported (or the check can't run / fails / times out).
 */
export async function groundCheckNote(
  provider: AiProvider,
  draft: string,
  contextPrompt: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!draft.trim()) return null;

  const prompt =
    `--- Context (the user's request + the source materials) ---\n${contextPrompt}\n\n` +
    `--- DRAFT ANSWER (fact-check against the sources above) ---\n${draft}\n--- END DRAFT ---\n\n` +
    'Reply "OK", or "FIX: <one–two line correction>".';

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      provider.complete({ system: GROUND_NOTE_SYSTEM, prompt, signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("ground-note timeout")), GROUND_CHECK_TIMEOUT_MS);
      }),
    ]);
    const text = result.text.trim();
    const fix = /^fix:\s*([\s\S]+)/i.exec(text);
    // Only a clear "FIX: …" produces a note; "OK" or anything unexpected → no
    // note (fail safe — never append a confusing message to a good answer).
    return fix ? fix[1]!.trim() : null;
  } catch (err) {
    logger.warn({ err: String(err) }, "text ground-note failed — leaving the answer as-is");
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
