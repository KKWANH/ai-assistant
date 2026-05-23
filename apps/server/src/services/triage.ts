/**
 * Triage — lightweight pre-flight classifiers for chat messages.
 *
 * These run a single, very short provider call to decide how to handle a
 * message before the main answer. They all fail open (return the cheaper
 * path) so a triage hiccup never blocks or breaks a reply.
 */

import type { AiProvider } from "../providers/index.js";
import { extractJson } from "../providers/index.js";
import type { ReportTriage, ReportType, ActionDef } from "@ariadne/shared";

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
 * Decide whether a chat message warrants the agent plan-and-execute loop.
 * Used when the composer's agent mode is "auto".
 *
 * Fails open to `false` — agent mode is slower than a plain stream, so we'd
 * rather miss a hard prompt than burn 10–30 s on a casual one. The bar is
 * deliberately high: only multi-step research / tool-chaining prompts pass.
 */
export async function decideAgentMode(
  provider: AiProvider,
  content: string,
  signal: AbortSignal,
): Promise<boolean> {
  const trimmed = content.trim();
  // Single words, greetings, "ok" — never worth the agent's planning round.
  if (trimmed.length < 20) return false;
  try {
    const { text } = await provider.complete({
      system:
        "You decide whether a user's message is worth running through a plan-and-execute " +
        "agent loop (which decomposes the task into 2–5 steps, calls tools like web search " +
        "or file read, and re-plans on failures). " +
        "Answer YES only when the task plainly requires multi-step work or external lookups " +
        "to do well — e.g. \"compare X and Y across these files\", \"research recent news on Z " +
        "and summarise\", \"go through the holdings.csv and flag anomalies\". " +
        "Answer NO for any task a single direct response handles well: questions, opinions, " +
        "small talk, coding requests, writing requests, translation, general-knowledge " +
        "lookups, anything where one well-chosen prompt is enough. Reply with exactly one " +
        "word: YES or NO.",
      prompt: trimmed.slice(0, 600),
      signal,
    });
    return /\byes\b/i.test(text);
  } catch {
    return false;
  }
}

/**
 * Detect whether the user's chat message expresses the intent of running one
 * of the workspace's actions. Returns the matched action (id, name, a short
 * reason) or null. Fails open — a hiccup never surfaces a wrong suggestion.
 */
export async function detectActionIntent(
  provider: AiProvider,
  content: string,
  actions: ActionDef[],
  signal: AbortSignal,
): Promise<{ actionId: string; actionName: string; reason: string } | null> {
  const trimmed = content.trim();
  if (trimmed.length < 8 || actions.length === 0) return null;
  try {
    const list = actions
      .slice(0, 12)
      .map((a) => `- ${a.id}: ${a.name}${a.description ? " — " + a.description : ""}`)
      .join("\n");
    const { text } = await provider.complete({
      system:
        "You decide whether a user's chat message clearly expresses the intent of running ONE of " +
        "the workspace's actions. If a single action is a good match, return its id and a one-line " +
        "reason in the same language as the message. Otherwise return null. Be conservative — only " +
        "match a strong, specific intent (e.g. \"summarise X\" → a summarise action). " +
        'Reply with ONLY a JSON object: {"actionId":"...","reason":"..."} OR {"actionId":null}.',
      prompt: "Actions:\n" + list + "\n\nMessage:\n" + trimmed.slice(0, 600),
      json: true,
      signal,
    });
    const parsed = JSON.parse(extractJson(text)) as { actionId?: string | null; reason?: string };
    if (!parsed.actionId || typeof parsed.actionId !== "string") return null;
    const action = actions.find((a) => a.id === parsed.actionId);
    if (!action) return null;
    return {
      actionId: action.id,
      actionName: action.name,
      reason: typeof parsed.reason === "string" ? parsed.reason.trim().slice(0, 200) : "",
    };
  } catch {
    return null;
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
