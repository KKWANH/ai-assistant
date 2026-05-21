/**
 * Triage — lightweight pre-flight classifiers for chat messages.
 *
 * These run a single, very short provider call to decide how to handle a
 * message before the main answer. They all fail open (return the cheaper
 * path) so a triage hiccup never blocks or breaks a reply.
 */

import type { AiProvider } from "../providers/index.js";
import { extractJson } from "../providers/index.js";
import type { ReportTriage, ReportType } from "@ariadne/shared";

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

/**
 * Auto-triage a user-submitted report before it reaches the admin review
 * queue. Produces a verdict plus a cleaned-up issue title/body an admin can
 * file as a GitHub issue as-is.
 *
 * Fails open to a neutral "review" verdict so a triage hiccup never stops a
 * report from being reviewed manually.
 */
export async function triageReport(
  provider: AiProvider,
  type: ReportType,
  title: string,
  description: string,
  signal: AbortSignal,
): Promise<ReportTriage> {
  const fallback: ReportTriage = {
    verdict: "review",
    category: type,
    suggestedTitle: title.slice(0, 120),
    suggestedBody: description.slice(0, 2000),
    reason: "Automatic triage was unavailable — review manually.",
  };
  try {
    const { text } = await provider.complete({
      system:
        "You triage user-submitted product feedback before it may become a GitHub issue. " +
        "Reply with ONLY a JSON object: " +
        '{"verdict":"file|review|discard","category":"short label","suggestedTitle":"concise issue title",' +
        '"suggestedBody":"a clear issue body in Markdown, in the same language as the report",' +
        '"reason":"one short sentence"}. ' +
        "verdict=file for a clear, actionable bug or a concrete feature request; " +
        "verdict=review when it is plausible but vague or needs a human look; " +
        "verdict=discard for spam, noise, or anything not actionable. " +
        "Give suggestedBody a Steps / Expected / Actual shape when the report is a bug.",
      prompt: "Type: " + type + "\nTitle: " + title + "\n\nDescription:\n" + description.slice(0, 2000),
      json: true,
      signal,
    });
    const parsed = JSON.parse(extractJson(text)) as Partial<ReportTriage>;
    const verdict =
      parsed.verdict === "file" || parsed.verdict === "discard" ? parsed.verdict : "review";
    const str = (v: unknown, max: number, fb: string): string =>
      typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : fb;
    return {
      verdict,
      category: str(parsed.category, 40, type),
      suggestedTitle: str(parsed.suggestedTitle, 120, title.slice(0, 120)),
      suggestedBody: str(parsed.suggestedBody, 4000, description.slice(0, 2000)),
      reason: str(parsed.reason, 200, ""),
    };
  } catch {
    return fallback;
  }
}
