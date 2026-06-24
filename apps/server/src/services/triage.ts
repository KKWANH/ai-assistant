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
  /** Decide whether the message asks to FIND images (direct-answer path). */
  images: boolean;
  /** Workspace actions to match the message against (empty = skip). */
  actions: ActionDef[];
  /** Decide whether the task is hard enough to escalate to a stronger model
   *  (difficulty-aware routing — direct-answer path). */
  hard: boolean;
}

export interface TriageResult {
  agentMode: boolean;
  webSearch: boolean;
  title: string;
  /** True when the message asks to find/search images. */
  images: boolean;
  /** English search terms for the image database (artist + work + medium),
   *  extracted/translated from the message. Empty when images is false. */
  imageQuery: string;
  actionIntent: { actionId: string; actionName: string; reason: string } | null;
  /** True when the message is a hard reasoning/analysis task worth escalating. */
  hard: boolean;
}

const TRIAGE_DEFAULTS: TriageResult = {
  agentMode: false,
  webSearch: false,
  title: "",
  images: false,
  imageQuery: "",
  actionIntent: null,
  hard: false,
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
  const wantImages = needs.images && trimmed.length >= 6;
  const wantHard = needs.hard && trimmed.length >= 20;
  if (!wantAgent && !wantWeb && !wantTitle && !wantAction && !wantImages && !wantHard) return { ...TRIAGE_DEFAULTS };

  const questions: string[] = [];
  const keys: string[] = [];
  if (wantAgent) {
    keys.push("agent");
    questions.push(
      '- "agent" (boolean): true ONLY when the task needs ITERATIVE tool use a single ' +
        'answer cannot give — e.g. "compare X and Y across these files", "research recent news on Z ' +
        'and summarise", "go through holdings.csv and flag anomalies", running code/tests, or editing ' +
        'files. false for anything one direct response handles well: questions, opinions, small talk, ' +
        "coding, writing, translation, general-knowledge lookups. IMPORTANT: a plain summary, " +
        'overview, or "explain/what does this do" over the attached or workspace files is FALSE — ' +
        "those files are already retrieved into context, so a direct answer covers it without the " +
        "slower agent loop.",
    );
  }
  if (wantWeb) {
    keys.push("webSearch");
    questions.push(
      '- "webSearch" (boolean): true when answering well needs facts from the live internet — EITHER ' +
        "(a) current / time-sensitive info (events, news, prices, data or releases after training), OR " +
        "(b) a SPECIFIC CHECKABLE FACT the user needs correct: a date, attribution, name, place, " +
        "statistic, definition, or historical / biographical / scientific detail — where a confident " +
        "WRONG answer would mislead, so grounding it in a source prevents hallucination (e.g. \"when was " +
        'this painted?\", "who composed X?", "what year did Y happen?"). false for: greetings, tests, ' +
        "small talk, opinions, reasoning, coding, writing, translation — AND for anything answerable " +
        "from the attached files, images, or workspace context already provided (those ARE the source; " +
        "do not web-search them).",
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
  if (wantImages) {
    keys.push("images", "imageQuery");
    questions.push(
      '- "images" (boolean): true ONLY when the message asks to FIND / SEARCH / GET ' +
        "images / pictures / photos / 그림 / 사진 / 도판 OF something (e.g. to put on a slide). " +
        "false for everything else — including questions ABOUT an image, or asking to analyze / " +
        'describe / generate one. "imageQuery" (string): when images is true, the best ENGLISH ' +
        "search terms for an art/image database — artist + work + medium/subject " +
        '(e.g. "Bernini Apollo and Daphne marble sculpture"). Empty string when images is false.',
    );
  }

  if (wantHard) {
    keys.push("hard");
    questions.push(
      '- "hard" (boolean): true ONLY when answering well needs careful multi-step reasoning, rigorous ' +
        "analysis, or specialised expertise that a small fast model would likely get wrong — intricate " +
        "math/logic, tricky algorithms or debugging, deep analysis or evaluation of a document or argument, " +
        "multi-constraint planning. false for everyday questions, lookups, summaries, small talk, " +
        "translation, and routine writing or coding that a quick answer handles well.",
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
      noThink: true,
    });
    const parsed = JSON.parse(extractJson(text)) as Record<string, unknown>;
    const result: TriageResult = { ...TRIAGE_DEFAULTS };
    if (wantAgent) result.agentMode = truthy(parsed["agent"]);
    if (wantWeb) result.webSearch = truthy(parsed["webSearch"]);
    if (wantTitle) result.title = cleanJsonTitle(parsed["title"]);
    if (wantAction) result.actionIntent = matchAction(needs.actions, parsed["actionId"], parsed["actionReason"]);
    if (wantImages) {
      result.images = truthy(parsed["images"]);
      result.imageQuery =
        result.images && typeof parsed["imageQuery"] === "string"
          ? (parsed["imageQuery"] as string).trim().slice(0, 200)
          : "";
    }
    if (wantHard) result.hard = truthy(parsed["hard"]);
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
      noThink: true,
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
