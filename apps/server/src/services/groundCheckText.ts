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
