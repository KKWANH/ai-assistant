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

// ---------------------------------------------------------------------------
// Fused pre-flight triage
// ---------------------------------------------------------------------------

/** Which pre-flight decisions the caller needs from a single triage call. */
export interface TriageNeeds {
  /** Decide whether the plan-execute agent loop is warranted (agent mode "auto"). */
  agent: boolean;
  /** Decide whether a live web search helps (web mode "auto", direct-answer path). */
  webSearch: boolean;
  /** Write a short title for a new chat (first message only). */
  title: boolean;
  /** Workspace actions to match the message against (empty = skip). */
  actions: ActionDef[];
}

export interface TriageResult {
  agentMode: boolean;
  webSearch: boolean;
  title: string;
  actionIntent: { actionId: string; actionName: string; reason: string } | null;
}

const TRIAGE_DEFAULTS: TriageResult = {
  agentMode: false,
  webSearch: false,
  title: "",
  actionIntent: null,
};

/** Tidy a title returned as a JSON string field (strip wrapping punctuation, cap length). */
function cleanJsonTitle(v: unknown): string {
  if (typeof v !== "string") return "";
  const t = v.replace(/^["'`*#\s]+|["'`*\s.]+$/g, "").trim();
  return t.length > 64 ? t.slice(0, 64).trim() : t;
}

/** Resolve a model-proposed actionId back to a real workspace action, or null. */
function matchAction(
  actions: ActionDef[],
  idRaw: unknown,
  reasonRaw: unknown,
): { actionId: string; actionName: string; reason: string } | null {
  if (typeof idRaw !== "string" || idRaw.length === 0) return null;
  const action = actions.find((a) => a.id === idRaw);
  if (!action) return null;
  return {
    actionId: action.id,
    actionName: action.name,
    reason: typeof reasonRaw === "string" ? reasonRaw.trim().slice(0, 200) : "",
  };
}

/** Lenient boolean parse — accepts a JSON true or a "true"/"yes" string. */
const truthy = (v: unknown): boolean => v === true || /^(true|yes)$/i.test(String(v).trim());

/**
 * Fused pre-flight triage — ONE provider call that answers every "how should I
 * handle this message?" question the standard chat path needs (agent loop? web
 * search? a short title? a matching workspace action?) instead of 2–4 separate
 * round-trips. Runs on the fast triage tier (see getTriageSettings) so these
 * cheap classifications never sit on the slow reasoning model.
 *
 * Only the requested decisions are asked, and when none are needed the call is
 * skipped entirely (returns defaults, no round-trip). Fails open to the cheap
 * defaults so a triage hiccup never blocks or breaks a reply.
 */
export async function triage(
  provider: AiProvider,
  content: string,
  needs: TriageNeeds,
  signal: AbortSignal,
): Promise<TriageResult> {
  const trimmed = content.trim();
  // Per-decision floors: skip questions too trivial to be worth asking.
  const wantAgent = needs.agent && trimmed.length >= 20;
  const wantWeb = needs.webSearch && trimmed.length >= 8;
  const wantTitle = needs.title && trimmed.length >= 2;
  const wantAction = needs.actions.length > 0 && trimmed.length >= 8;
  if (!wantAgent && !wantWeb && !wantTitle && !wantAction) return { ...TRIAGE_DEFAULTS };

  const questions: string[] = [];
  const keys: string[] = [];
  if (wantAgent) {
    keys.push("agent");
    questions.push(
      '- "agent" (boolean): true ONLY when the task plainly requires multi-step work or external ' +
        'lookups to do well — e.g. "compare X and Y across these files", "research recent news on Z ' +
        'and summarise", "go through holdings.csv and flag anomalies". false for anything one direct ' +
        "response handles well: questions, opinions, small talk, coding, writing, translation, " +
        "general-knowledge lookups.",
    );
  }
  if (wantWeb) {
    keys.push("webSearch");
    questions.push(
      '- "webSearch" (boolean): true ONLY when answering needs a live internet search — current ' +
        "events, recent or time-sensitive data, prices, news, or facts released after training. false " +
        "for greetings, tests, small talk, opinions, or any coding / writing / reasoning / " +
        "general-knowledge task.",
    );
  }
  if (wantTitle) {
    keys.push("title");
    questions.push(
      '- "title" (string): a very short 3–6 word title for a conversation that opens with this ' +
        "message, in the same language as the message, with no quotes or surrounding punctuation.",
    );
  }
  if (wantAction) {
    keys.push("actionId", "actionReason");
    const list = needs.actions
      .slice(0, 12)
      .map((a) => `    - ${a.id}: ${a.name}${a.description ? " — " + a.description : ""}`)
      .join("\n");
    questions.push(
      '- "actionId" (string or null): if the message clearly expresses the intent of running ONE of ' +
        "the workspace actions below, return its id; otherwise null. Be conservative — only a strong, " +
        'specific match. "actionReason" (string): a one-line reason, in the message\'s language, when ' +
        "actionId is set. Actions:\n" + list,
    );
  }

  try {
    const { text } = await provider.complete({
      system:
        "You are a fast triage classifier for a chat assistant. For the user's message, decide the " +
        "items below and reply with ONLY a JSON object containing exactly these keys: " +
        keys.map((k) => `"${k}"`).join(", ") +
        ".\n" +
        questions.join("\n"),
      prompt: trimmed.slice(0, 800),
      json: true,
      signal,
    });
    const parsed = JSON.parse(extractJson(text)) as Record<string, unknown>;
    const result: TriageResult = { ...TRIAGE_DEFAULTS };
    if (wantAgent) result.agentMode = truthy(parsed["agent"]);
    if (wantWeb) result.webSearch = truthy(parsed["webSearch"]);
    if (wantTitle) result.title = cleanJsonTitle(parsed["title"]);
    if (wantAction) result.actionIntent = matchAction(needs.actions, parsed["actionId"], parsed["actionReason"]);
    return result;
  } catch {
    return { ...TRIAGE_DEFAULTS };
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
