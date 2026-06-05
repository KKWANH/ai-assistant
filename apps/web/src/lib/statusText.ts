import type { TranslationKey } from "./i18n/en";

type TFn = (key: TranslationKey) => string;

// The agent/orchestrator narrate progress in English over SSE. Map the known
// lines to translation keys so a Korean user sees Korean status, not a
// half-translated UI. Keep this in sync with the emit({type:"status"}) strings
// in apps/server/src/services/{agent,orchestrator}.ts + routes/chat.ts.
const STATUS_KEYS: Record<string, TranslationKey> = {
  "Planning steps…": "chat.status.planning",
  "Answering…": "chat.status.answering",
  "Adjusting plan…": "chat.status.adjusting",
  "Synthesising answer…": "chat.status.synthesising",
  "Synthesising the combined answer…": "chat.status.synthesisingCombined",
  "Breaking the task into sub-topics…": "chat.status.decomposing",
  "Building context…": "chat.status.buildingContext",
  "Checking whether a web search helps…": "chat.status.checkingWeb",
  "Compacting earlier conversation…": "chat.status.compacting",
  "Deciding whether to use the agent…": "chat.status.decidingAgent",
  "Generating…": "chat.status.generating",
  "Warming up the model…": "chat.status.warmingUp",
};

/**
 * Localize a server-emitted status line into the user's language. Handles the
 * "[n/N] " deep-mode sub-agent prefix and the "Researching … sub-topics"
 * template; anything unrecognized passes through unchanged.
 */
export function localizeStatus(text: string, t: TFn): string {
  if (!text) return text;
  const pm = text.match(/^(\[\d+\/\d+\]\s*)([\s\S]*)$/);
  const prefix = pm ? pm[1] ?? "" : "";
  const core = pm ? pm[2] ?? "" : text;
  if (/^Researching \d+ sub-topics in parallel…$/.test(core)) {
    return prefix + t("chat.status.researching");
  }
  const key = STATUS_KEYS[core];
  return key ? prefix + t(key) : text;
}
