/**
 * Orchestrator — sub-agent fan-out for "deep" mode (R4).
 *
 * Flow:
 *   1. Decompose — split the user's request into 2–4 INDEPENDENT sub-questions.
 *   2. Fan out  — run each sub-question as an isolated `runAgent()` instance,
 *      concurrently. Their fine-grained events are swallowed (only coarse
 *      progress surfaces) so N interleaved step streams don't garble the UI.
 *   3. Synthesize — stream one merged answer built from the sub-results.
 *
 * Gated behind explicit "deep" mode (cost-aware: up to MAX_SUBTASKS× a normal
 * agent run) — never the default. Calls `runAgent`, not itself, so there is no
 * recursion / unbounded fan-out.
 */

import crypto from "node:crypto";
import type { AgentStep, AgentTrace, ChatStreamEvent, SearchResult } from "@ariadne/shared";
import type { AiProvider } from "../providers/index.js";
import { extractJson } from "../providers/index.js";
import { runAgent, type RunAgentOptions, type RunAgentResult } from "./agent.js";
import logger from "../logger.js";

const MAX_SUBTASKS = 4;

export async function runDeepAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const { userMessage, provider, emit, signal } = opts;

  // ── 1. Decompose ──────────────────────────────────────────────────────────
  emit({ type: "status", text: "Breaking the task into sub-topics…" });
  const subTasks = await decompose(provider, userMessage, signal);

  // Simple request — not worth the fan-out cost. Fall back to one agent so
  // "deep" never costs more than "agent" on a task that can't be split.
  if (subTasks.length <= 1) {
    return runAgent(opts);
  }

  // Surface the decomposition as a plan so the UI renders sub-topic progress.
  const planSteps: AgentStep[] = subTasks.map((t) => ({
    id: crypto.randomUUID(),
    description: t,
    tool: "reason",
    note: "Independent sub-agent",
    status: "pending" as const,
  }));
  emit({ type: "agent_plan", steps: [...planSteps] });

  // ── 2. Fan out ──────────────────────────────────────────────────────────
  emit({ type: "status", text: `Researching ${subTasks.length.toString()} sub-topics in parallel…` });
  const subResults = await Promise.all(
    subTasks.map(async (task, idx) => {
      const step = planSteps[idx]!;
      step.status = "running";
      emit({ type: "agent_step", step: { ...step } });

      // Swallow the sub-agent's own plan/step/delta events; forward only a
      // coarse status line so the user sees movement without N streams.
      const quietEmit = (ev: ChatStreamEvent) => {
        if (ev.type === "status") {
          emit({ type: "status", text: `[${(idx + 1).toString()}/${subTasks.length.toString()}] ${ev.text}` });
        }
      };

      try {
        const res = await runAgent({ ...opts, userMessage: task, emit: quietEmit });
        step.status = "done";
        step.result = res.content.slice(0, 400);
        emit({ type: "agent_step", step: { ...step } });
        return { task, content: res.content, sources: res.searchResults ?? [] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ task: task.slice(0, 80), err: msg }, "deep sub-agent failed");
        step.status = "failed";
        step.result = `Sub-task failed: ${msg.slice(0, 160)}`;
        emit({ type: "agent_step", step: { ...step } });
        return { task, content: "", sources: [] as SearchResult[] };
      }
    }),
  );

  // ── 3. Synthesize ────────────────────────────────────────────────────────
  emit({ type: "status", text: "Synthesising the combined answer…" });
  const findings = subResults
    .filter((r) => r.content.trim())
    .map((r, i) => `### Finding ${(i + 1).toString()} — ${r.task}\n${r.content}`)
    .join("\n\n");

  let finalContent = "";
  if (!signal.aborted && findings) {
    try {
      await provider.completeStream(
        {
          system:
            "You are Ariadne's research synthesiser. You are given several findings that " +
            "were researched INDEPENDENTLY by separate agents. Merge them into one coherent, " +
            "well-structured answer to the user's original question. Resolve overlaps, flag " +
            "any disagreements, and do not echo the 'Finding N' headers verbatim. Always reply " +
            "in the same language the user writes in, as normal Markdown prose.",
          prompt: `Original question:\n${userMessage}\n\nIndependent findings:\n${findings}`,
          signal,
        },
        (delta) => {
          finalContent += delta;
          emit({ type: "delta", text: delta });
        },
        (status) => {
          emit({ type: "status", text: status });
        },
      );
    } catch {
      // Aborted (or failed) mid-synthesis — keep whatever streamed so far.
    }
  }
  if (!finalContent) {
    finalContent = findings || "The sub-topics could not be researched.";
    emit({ type: "delta", text: finalContent });
  }

  // Merge + de-duplicate sources gathered across all sub-agents.
  const seen = new Set<string>();
  const sources = subResults
    .flatMap((r) => r.sources)
    .filter((s) => {
      if (seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });

  const trace: AgentTrace = {
    steps: planSteps,
    summary: `Deep mode — ${subTasks.length.toString()} parallel sub-agents`,
  };
  return {
    content: finalContent,
    agent: trace,
    searchResults: sources.length > 0 ? sources : null,
  };
}

/**
 * Ask the provider to split the request into independent sub-questions. Returns
 * `[userMessage]` (single element) when the task is simple or parsing fails —
 * the caller treats that as "don't fan out".
 */
async function decompose(
  provider: AiProvider,
  userMessage: string,
  signal: AbortSignal,
): Promise<string[]> {
  let text: string;
  try {
    const res = await provider.complete({
      system:
        "Decompose the user's request into 2–4 INDEPENDENT sub-questions that can be " +
        "researched in parallel and merged afterwards. Each sub-question must stand alone " +
        "(no references to 'the above' or to other sub-questions). If the request is simple " +
        "and not worth splitting, return a single-element array containing the original " +
        "request. Write the sub-questions in the user's language.",
      prompt: userMessage,
      json: true,
      jsonSchema: {
        name: "decomposition",
        schema: {
          type: "object",
          properties: {
            subtasks: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: MAX_SUBTASKS,
            },
          },
          required: ["subtasks"],
          additionalProperties: false,
        },
      },
      signal,
    });
    text = res.text;
  } catch {
    return [userMessage];
  }

  try {
    const parsed: unknown = JSON.parse(extractJson(text));
    const raw =
      parsed && typeof parsed === "object" && Array.isArray((parsed as { subtasks?: unknown }).subtasks)
        ? (parsed as { subtasks: unknown[] }).subtasks
        : [];
    const clean = raw
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim())
      .slice(0, MAX_SUBTASKS);
    return clean.length > 0 ? clean : [userMessage];
  } catch {
    return [userMessage];
  }
}
