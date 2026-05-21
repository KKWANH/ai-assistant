/**
 * Triage — lightweight pre-flight classifiers for chat messages.
 *
 * These run a single, very short provider call to decide how to handle a
 * message before the main answer. They all fail open (return the cheaper
 * path) so a triage hiccup never blocks or breaks a reply.
 */

import type { AiProvider } from "../providers/index.js";

/**
 * Decide whether a chat message needs a live web search to answer well.
 * Used when the composer's web-search mode is "auto".
 *
 * Fails open to `false` — when in doubt, answer from the model directly
 * rather than producing an odd, citation-heavy reply to a simple message.
 */
export async function decideWebSearch(
  provider: AiProvider,
  content: string,
  signal: AbortSignal,
): Promise<boolean> {
  const trimmed = content.trim();
  // Too short to be a real research question (greetings, "test", "ok").
  if (trimmed.length < 8) return false;
  try {
    const { text } = await provider.complete({
      system:
        "You decide whether a user's message needs a live internet search to be answered well. " +
        "Answer YES if it asks about current events, recent or time-sensitive data, prices, news, " +
        "released-after-training facts, or specific real-world details that should be verified against " +
        "up-to-date sources. Answer NO for greetings, tests, small talk, opinions, or any " +
        "coding / writing / reasoning / general-knowledge task. Reply with exactly one word: YES or NO.",
      prompt: trimmed.slice(0, 600),
      signal,
    });
    return /\byes\b/i.test(text);
  } catch {
    return false;
  }
}
