/**
 * groundCheckText — the text analogue of groundCheck (images). When an answer
 * rests on source materials fed into the prompt (web-search results and/or
 * excerpts from the user's files), re-read those sources alongside the draft and
 * rewrite any factual claim they don't actually support. This catches the
 * "confidently wrong date / attribution / number" failure a system prompt only
 * nudges — the structural lever the user asked for on the text path.
 *
 * Used ONLY for academic workspaces (lecture/thesis) that have sources this turn
 * — so the cost (one buffered draft + one verify call, losing token streaming
 * for that answer) is paid only where scholarly accuracy is worth it. Everywhere
 * else the answer streams as before. Modelled on the reranker / image
 * ground-check: bounded, hard timeout, FAILS SAFE (returns null → keep draft).
 */
import type { AiProvider } from "../providers/index.js";
import logger from "../logger.js";

const GROUND_CHECK_TIMEOUT_MS = 40_000;

const GROUND_CHECK_SYSTEM =
  "You verify an answer against the source materials it was given and return a corrected version. The " +
  "context below holds the user's request plus the SOURCE MATERIALS the answer must rest on (web-search " +
  "results and/or excerpts from the user's files). Rewrite the DRAFT so it asserts only what those " +
  "sources actually support. Rules:\n" +
  "- Keep every claim the sources support, in the draft's original language, structure, and level of detail.\n" +
  "- For a specific factual claim the sources do NOT support — a date, name, number, attribution, " +
  "quotation, or statistic — correct it if a source gives the right value; otherwise remove it or mark it " +
  "uncertain (e.g. \"출처에서 확인되지 않음\" / \"not stated in the sources\"). Never invent a replacement.\n" +
  "- Add no new facts beyond the sources, and do not fabricate citations.\n" +
  "- If the draft is already fully supported, return it essentially unchanged.\n" +
  "Output only the corrected answer — no preamble, no notes about what you changed.";

/**
 * Re-ground a draft text answer against the sources embedded in `contextPrompt`.
 * Returns the corrected answer, or null when it can't run / fails / times out
 * (caller keeps the original draft).
 */
export async function groundCheckText(
  provider: AiProvider,
  draft: string,
  contextPrompt: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!draft.trim()) return null;

  const prompt =
    `--- Context (the user's request + the source materials) ---\n${contextPrompt}\n\n` +
    `--- DRAFT ANSWER (verify against the sources above and correct) ---\n${draft}\n--- END DRAFT ---\n\n` +
    "Return the corrected, source-grounded answer.";

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      provider.complete({ system: GROUND_CHECK_SYSTEM, prompt, signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("text ground-check timeout")), GROUND_CHECK_TIMEOUT_MS);
      }),
    ]);
    const text = result.text.trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    logger.warn({ err: String(err) }, "text ground-check failed — keeping original draft");
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
