/**
 * groundCheck — a STRUCTURAL anti-hallucination pass for image-grounded answers.
 *
 * When the assistant answers about attached source images (a slide deck, an exam
 * PDF rendered to pages, a figure), the biggest failure mode is inventing content
 * that isn't actually there — a wrong artist/title/date, a caption that doesn't
 * exist, a detail it couldn't see. A persona/system-prompt instruction only nudges
 * this; the reliable fix is a second pass that re-reads the SAME source images
 * alongside the draft and rewrites it to assert only what is genuinely visible.
 *
 * Modelled on the reranker (services/reranker.ts): one bounded extra provider
 * call, hard timeout, and FAILS SAFE — on any error it returns null and the
 * caller keeps the original draft. Only runs when images are present, so it adds
 * nothing to ordinary text chat.
 */
import type { AiProvider, ProviderImage } from "../providers/index.js";
import logger from "../logger.js";

const GROUND_CHECK_TIMEOUT_MS = 45_000; // a vision re-read of many pages is slow

const GROUND_CHECK_SYSTEM =
  "You verify an answer against the source images it was supposed to be based on, and return a " +
  "corrected version. You are given the user's request, a DRAFT answer, and the source images " +
  "(slides / document pages / figures). Rewrite the draft so it asserts ONLY what is actually " +
  "visible in these images. Rules:\n" +
  "- Keep every claim the images DO support, in the draft's original language, structure, and level of detail.\n" +
  "- For any specific claim the images do NOT support — an artist, title, date, attribution, caption, " +
  "quotation, figure, number, or named detail that you cannot actually see — correct it if the image " +
  "shows the right value, otherwise remove it or mark it uncertain (e.g. \"확실하지 않음\" / \"not visible in the source\"). " +
  "Do NOT invent replacements.\n" +
  "- Add NO new facts beyond what the images show.\n" +
  "- If the draft is already fully supported by the images, return it essentially unchanged.\n" +
  "Output only the corrected answer — no preamble, no notes about what you changed.";

/**
 * Re-ground a draft answer against the source images. Returns the corrected
 * answer text, or null when the check can't run / fails / times out (caller
 * keeps the original draft).
 */
export async function groundCheckVision(
  provider: AiProvider,
  draft: string,
  userPrompt: string,
  images: ProviderImage[],
  signal?: AbortSignal,
): Promise<string | null> {
  if (!provider.completeWithImages || images.length === 0 || !draft.trim()) return null;

  const prompt =
    `User request:\n${userPrompt}\n\n` +
    `--- DRAFT ANSWER (verify against the images and correct) ---\n${draft}\n--- END DRAFT ---\n\n` +
    "Return the corrected, image-grounded answer.";

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      provider.completeWithImages({ system: GROUND_CHECK_SYSTEM, prompt, images, signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("ground-check timeout")), GROUND_CHECK_TIMEOUT_MS);
      }),
    ]);
    const text = result.text.trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    logger.warn({ err: String(err) }, "vision ground-check failed — keeping original draft");
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
