/**
 * Built-in skills — shipped with Ariadne, available to every account.
 *
 * These cover the most common one-click prompts (translate, summarise,
 * code review, explain). They render in the same picker as user-created
 * skills and respond to the same `/<name>` slash-command. The UI marks
 * them with a `builtin: true` flag so the manage screen can hide edit/
 * delete affordances.
 *
 * Each variable in `{key}` form is collected through the picker's fill
 * modal before insert. Empty `variables` means insert as-is.
 */
import type { Skill } from "@ariadne/shared";

const FIXED_TIMESTAMP = "2026-01-01T00:00:00.000Z";

/**
 * Returns the canonical built-in skill list. Ids are stable, prefixed
 * `builtin:` so they can never collide with user-created UUIDs.
 */
export function listBuiltinSkills(): Skill[] {
  return BUILTINS;
}

const BUILTINS: Skill[] = [
  {
    id: "builtin:translate",
    accountId: null,
    name: "translate",
    description: "Translate text into another language, keeping tone + formatting.",
    category: "writing",
    prompt:
      "Translate the following text into {target_language}. Preserve formatting (line breaks, lists, code fences) and the original tone — formal stays formal, casual stays casual. If a term has no good direct equivalent, keep the original in parentheses.\n\nText:\n{text}",
    variables: [
      {
        key: "target_language",
        label: "Target language",
        hint: "e.g. Korean, English, Japanese, French",
        default: "English",
      },
      { key: "text", label: "Text to translate" },
    ],
    builtin: true,
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
  },
  {
    id: "builtin:summarise",
    accountId: null,
    name: "summarise",
    description: "Summarise a long piece of text into N bullet points.",
    category: "writing",
    prompt:
      "Summarise the text below in exactly {bullets} bullet points. Each bullet starts with the noun/topic (not 'The author says…'), is one sentence, and captures a distinct idea — no overlap.\n\nText:\n{text}",
    variables: [
      { key: "bullets", label: "How many bullets?", default: "5" },
      { key: "text", label: "Text to summarise" },
    ],
    builtin: true,
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
  },
  {
    id: "builtin:rewrite",
    accountId: null,
    name: "rewrite",
    description: "Rewrite a draft in a different tone (professional / friendly / concise).",
    category: "writing",
    prompt:
      "Rewrite the draft below so it reads as {tone}. Keep the meaning + every fact intact; change only voice, sentence structure, and word choice. Return ONLY the rewritten text — no preamble, no notes.\n\nDraft:\n{text}",
    variables: [
      {
        key: "tone",
        label: "Target tone",
        hint: "e.g. professional, friendly, concise, enthusiastic",
        default: "professional",
      },
      { key: "text", label: "Draft to rewrite" },
    ],
    builtin: true,
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
  },
  {
    id: "builtin:review-code",
    accountId: null,
    name: "review-code",
    description: "Review code for bugs + readability. Names specific lines.",
    category: "code",
    prompt:
      "Review the {language} code below as a senior engineer. Find:\n1. Real correctness bugs (not style).\n2. Edge cases the code mishandles or doesn't handle.\n3. Readability issues that would slow a teammate down.\nFor each, quote the problematic line(s) and explain in one sentence. End with the single most valuable change if you had to pick one.\n\n```{language}\n{code}\n```",
    variables: [
      { key: "language", label: "Language", hint: "e.g. c, python, typescript", default: "typescript" },
      { key: "code", label: "Code to review" },
    ],
    builtin: true,
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
  },
  {
    id: "builtin:explain-code",
    accountId: null,
    name: "explain-code",
    description: "Explain unfamiliar code line-by-line at the level you ask for.",
    category: "code",
    prompt:
      "Explain the {language} code below at the level of {audience}. Walk through it block by block, naming what each piece does and *why* — not just paraphrasing the syntax. Call out any nonobvious gotchas. Use Markdown.\n\n```{language}\n{code}\n```",
    variables: [
      { key: "language", label: "Language", default: "typescript" },
      {
        key: "audience",
        label: "Audience level",
        hint: "e.g. junior engineer, senior reviewer, non-programmer",
        default: "junior engineer",
      },
      { key: "code", label: "Code to explain" },
    ],
    builtin: true,
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
  },
  {
    id: "builtin:debug-help",
    accountId: null,
    name: "debug",
    description: "Triage a stack trace / error message — likely cause + next checks.",
    category: "code",
    prompt:
      "Here's an error / stack trace from a {context} application. Tell me:\n1. The most likely root cause (one sentence).\n2. Two cheap things I can check / log right now to confirm or rule out (1).\n3. Anything in the message I'm probably missing.\nNo speculation about causes the trace doesn't support.\n\n```\n{error}\n```\n\nWhat I was doing when it happened: {context_note}",
    variables: [
      { key: "context", label: "Stack context", hint: "e.g. Node.js, Python Flask, browser React, C", default: "Node.js" },
      { key: "error", label: "Error / stack trace" },
      { key: "context_note", label: "What were you doing?", default: "" },
    ],
    builtin: true,
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
  },
];
