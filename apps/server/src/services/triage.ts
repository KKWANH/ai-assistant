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

/**
 * Write a short title for a new chat from its opening message. Returns "" on
 * any failure — the caller keeps the plain truncated fallback title.
 */
export async function generateChatTitle(
  provider: AiProvider,
  userMessage: string,
  signal: AbortSignal,
): Promise<string> {
  const trimmed = userMessage.trim();
  if (trimmed.length < 2) return "";
  try {
    const { text } = await provider.complete({
      system:
        "Write a very short title (3 to 6 words) for a conversation that opens with the " +
        "message below. Use the same language as the message. Reply with ONLY the title — " +
        "no quotes, no surrounding punctuation, no explanation.",
      prompt: trimmed.slice(0, 800),
      signal,
    });
    const firstLine =
      text
        .replace(/<think>[\s\S]*?<\/think>/gi, "") // drop reasoning blocks (qwen etc.)
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0) ?? "";
    const title = firstLine.replace(/^["'`*#\s]+|["'`*\s.]+$/g, "").trim();
    return title.length > 64 ? title.slice(0, 64).trim() : title;
  } catch {
    return "";
  }
}
