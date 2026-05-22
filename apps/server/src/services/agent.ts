/**
 * Agent service — plan-and-execute loop for agentMode chat messages.
 *
 * Flow:
 *   1. Plan  — ask provider (JSON) for an ordered list of steps.
 *   2. Execute — run each step's tool; emit SSE events.
 *   3. Re-plan — after each step, let the provider revise remaining steps.
 *   4. Final  — stream a synthesis of all step results.
 *
 * Safety: max 8 steps total, per-step timeout of 60 s, failed tools keep loop alive.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Chat, ChatMessage, ChatStreamEvent, AgentStep, AgentTrace, AgentTool, WorkspaceAction, SearchResult } from "@ariadne/shared";
import type { AiProvider } from "../providers/index.js";
import { extractJson } from "../providers/index.js";
import { performSearch } from "./search.js";
import { appendUserProfile } from "./chatContext.js";
import { focusedRead } from "../gasp/filter.js";
import { dbGetLatestSnapshot, dbGetWorkspace } from "../db/repo.js";
import { createRun } from "../runs/engine.js";
import { loadWorkspaceActions } from "./actions.js";
import { scriptEnv } from "./scriptEnv.js";
import { scriptsDir } from "../ariadneFolder.js";
import logger from "../logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_STEPS = 8;
const STEP_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunAgentOptions {
  chat: Chat;
  history: ChatMessage[];
  userMessage: string;
  provider: AiProvider;
  emit: (event: ChatStreamEvent) => void;
  /** Aborts the agent loop and its in-flight provider calls. */
  signal: AbortSignal;
  /** The user's saved profile, injected into the answer prompts. */
  accountContext?: string;
}

export interface RunAgentResult {
  content: string;
  agent: AgentTrace;
  /** Web sources gathered across the agent's search steps. */
  searchResults: SearchResult[] | null;
}

export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const { chat, history, userMessage, provider, emit, signal, accountContext } = opts;

  // Load custom actions for this workspace (if any)
  let customActions: WorkspaceAction[] = [];
  if (chat.workspaceId) {
    const ws = dbGetWorkspace(chat.workspaceId);
    if (ws) {
      const { actions } = loadWorkspaceActions(ws.rootPath);
      customActions = actions;
    }
  }

  // ── 1. Plan ──────────────────────────────────────────────────────────────

  emit({ type: "status", text: "Planning steps…" });

  const planRaw = await safeComplete(provider, {
    system: buildPlannerSystem(customActions),
    prompt: buildPlannerPrompt(history, userMessage),
    json: true,
    signal,
  });

  const plan = parsePlan(planRaw, customActions);
  const steps: AgentStep[] = plan.steps.slice(0, MAX_STEPS).map((s) => ({
    id: crypto.randomUUID(),
    description: s.description,
    tool: s.tool,
    note: s.note,
    status: "pending" as const,
  }));

  // Simple message — the planner decided no tools/research are needed.
  // Skip the plan-and-execute loop and answer directly.
  if (steps.length === 0) {
    emit({ type: "status", text: "Answering…" });
    let direct = "";
    try {
      await provider.completeStream(
        {
          system: buildDirectSystem(accountContext),
          prompt: buildDirectPrompt(history, userMessage),
          signal,
        },
        (delta) => {
          direct += delta;
          emit({ type: "delta", text: delta });
        },
        (status) => {
          emit({ type: "status", text: status });
        },
      );
    } catch {
      // Aborted (or failed) mid-stream — keep whatever streamed so far.
    }
    return { content: direct, agent: { steps: [] }, searchResults: null };
  }

  emit({ type: "agent_plan", steps: [...steps] });

  // ── 2. Execute ────────────────────────────────────────────────────────────

  const stepResults: string[] = [];
  const collectedSources: SearchResult[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    if (signal.aborted) break;

    // Mark running
    step.status = "running";
    emit({ type: "agent_step", step: { ...step } });

    let result: string;
    // Per-step abort — fires if the agent is cancelled OR this step times
    // out, so the tool's in-flight LLM / network call is actually stopped.
    const stepCtl = new AbortController();
    const stepSignal = AbortSignal.any([signal, stepCtl.signal]);
    try {
      result = await withTimeout(
        runTool(step.tool, step.description, chat, provider, customActions, collectedSources, stepSignal),
        STEP_TIMEOUT_MS,
        stepCtl,
      );
      step.status = "done";
      step.result = result.slice(0, 400);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ stepId: step.id, tool: step.tool, err: msg }, "agent step failed");
      step.status = "failed";
      step.result = /timed out/i.test(msg)
        ? "This step ran over the time limit and was skipped — continuing."
        : `Tool failed: ${msg.slice(0, 200)}`;
      result = step.result;
    }

    emit({ type: "agent_step", step: { ...step } });
    stepResults.push(`Step "${step.description}" (${step.tool}): ${step.result ?? ""}`);

    // ── 3. Re-plan after each step ─────────────────────────────────────────
    if (i < steps.length - 1) {
      const remaining = steps.slice(i + 1);
      const revisedRaw = await safeComplete(provider, {
        system: buildReplannerSystem(customActions),
        prompt: buildReplannerPrompt(userMessage, stepResults, remaining),
        json: true,
        signal,
      }).catch(() => null);

      if (revisedRaw) {
        const revisedSteps = parsePlan(revisedRaw, customActions).steps;
        if (revisedSteps.length > 0) {
          // Replace remaining steps with revised plan (cap total)
          const newRemaining = revisedSteps
            .slice(0, MAX_STEPS - (i + 1))
            .map((s) => ({
              id: crypto.randomUUID(),
              description: s.description,
              tool: s.tool,
              note: s.note,
              status: "pending" as const,
            }));
          steps.splice(i + 1, steps.length - (i + 1), ...newRemaining);
          emit({ type: "agent_plan", steps: [...steps] });
        }
      }
    }
  }

  // ── 4. Final synthesis ─────────────────────────────────────────────────

  let finalContent = "";
  if (!signal.aborted) {
    emit({ type: "status", text: "Synthesising answer…" });
    try {
      await provider.completeStream(
        {
          system: buildSynthesisSystem(accountContext),
          prompt: buildSynthesisPrompt(userMessage, stepResults),
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

  const trace: AgentTrace = { steps, summary: plan.summary || undefined };

  // De-duplicate gathered sources by URL.
  const seenUrls = new Set<string>();
  const uniqueSources = collectedSources.filter((s) => {
    if (seenUrls.has(s.url)) return false;
    seenUrls.add(s.url);
    return true;
  });

  return {
    content: finalContent,
    agent: trace,
    searchResults: uniqueSources.length > 0 ? uniqueSources : null,
  };
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

async function runTool(
  tool: AgentTool,
  description: string,
  chat: Chat,
  provider: AiProvider,
  customActions: WorkspaceAction[],
  sources: SearchResult[],
  signal: AbortSignal,
): Promise<string> {
  // Check if the tool name matches a custom action id
  const customAction = customActions.find((a) => a.id === tool);
  if (customAction) {
    return executeCustomAction(customAction, description, chat, provider, sources, signal);
  }

  switch (tool) {
    case "web_search": {
      const resp = await performSearch(description, signal);
      if (resp.results.length === 0) return "No results found.";
      const top = resp.results.slice(0, 5);
      sources.push(...top);
      return top
        .map((r, i) => `[${(i + 1).toString()}] ${r.title}\n${r.url}\n${r.snippet}`)
        .join("\n\n");
    }

    case "read_file": {
      if (!chat.workspaceId) return "[No workspace attached — cannot read files]";
      const snapshot = dbGetLatestSnapshot(chat.workspaceId);
      if (!snapshot || snapshot.files.length === 0) return "[No snapshot available]";
      // Heuristically pick up to 3 files whose names match the description
      const descLower = description.toLowerCase();
      const candidates = snapshot.files
        .filter((f) => f.path.toLowerCase().includes(descLower) || descLower.includes(f.path.split("/").pop()?.toLowerCase() ?? ""))
        .slice(0, 3)
        .map((f) => f.path);
      if (candidates.length === 0) {
        // Fallback: just read first 2 files
        candidates.push(...snapshot.files.slice(0, 2).map((f) => f.path));
      }
      // We need root path — pull from snapshot workspace
      const ws = dbGetWorkspace(chat.workspaceId);
      if (!ws) return "[Workspace not found]";
      const focused = await focusedRead(ws.rootPath, candidates, snapshot, provider);
      return focused.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n");
    }

    case "list_files": {
      if (!chat.workspaceId) return "[No workspace attached]";
      const snapshot = dbGetLatestSnapshot(chat.workspaceId);
      if (!snapshot) return "[No snapshot available]";
      const list = snapshot.files.slice(0, 30).map((f) => f.path).join("\n");
      return `Files in workspace:\n${list}`;
    }

    case "analyze_image": {
      // Requires images in context — delegate to reason step
      if (!provider.completeWithImages) return "[Vision not supported by this provider]";
      const { text } = await provider.completeWithImages({
        system: "You are a visual analysis assistant.",
        prompt: description,
        images: [],
        signal,
      });
      return text;
    }

    case "run_template": {
      if (!chat.workspaceId) return "[No workspace attached — cannot run templates]";
      // Fire off a run async and return the run ID as result
      try {
        const run = await createRun({
          workspaceId: chat.workspaceId,
          templateId: "research-brief",
          input: { topic: description },
        });
        return `Started template run ${run.id} (status: ${run.status})`;
      } catch (err) {
        return `[run_template failed: ${err instanceof Error ? err.message : String(err)}]`;
      }
    }

    case "reason": {
      const { text } = await provider.complete({
        system: "You are a reasoning assistant. Think through the task carefully and provide a clear, well-structured analysis.",
        prompt: description,
        signal,
      });
      return text;
    }

    default: {
      const _exhaustive: never = tool;
      return `[Unknown tool: ${String(_exhaustive)}]`;
    }
  }
}

// ---------------------------------------------------------------------------
// Custom action executor
// ---------------------------------------------------------------------------

async function executeCustomAction(
  action: WorkspaceAction,
  description: string,
  chat: Chat,
  provider: AiProvider,
  sources: SearchResult[],
  signal: AbortSignal,
): Promise<string> {
  switch (action.type) {
    case "run_script": {
      if (!chat.workspaceId) return "[No workspace attached — cannot run scripts]";
      const ws = dbGetWorkspace(chat.workspaceId);
      if (!ws) return "[Workspace not found]";
      const scriptName = action.script;
      if (!scriptName) return `[Action ${action.id}: missing 'script' field]`;

      const scriptPath = path.join(scriptsDir(ws.rootPath), scriptName);
      if (!fs.existsSync(scriptPath)) {
        return `[Script not found: ${scriptName}]`;
      }

      const isShell = scriptName.endsWith(".sh");
      const isPy = scriptName.endsWith(".py");
      if (!isShell && !isPy) return `[Unsupported script type: ${scriptName}]`;

      const { spawn } = await import("node:child_process");
      const cmd = isShell ? "/bin/bash" : "python3";

      return new Promise<string>((resolve) => {
        let out = "";
        let err = "";
        const proc = spawn(cmd, [scriptPath], { cwd: ws.rootPath, env: scriptEnv() });
        const timer = setTimeout(() => { proc.kill("SIGTERM"); resolve("[Script timed out]"); }, 30_000);
        proc.stdout.on("data", (c: Buffer) => { out += c.toString("utf-8"); });
        proc.stderr.on("data", (c: Buffer) => { err += c.toString("utf-8"); });
        proc.on("close", (code) => {
          clearTimeout(timer);
          const result = out.slice(0, 8_000);
          if (err) resolve(`stdout: ${result}\nstderr: ${err.slice(0, 1_000)}\nexit: ${String(code)}`);
          else resolve(result || `[Script exited with code ${String(code)}]`);
        });
        proc.on("error", (e) => { clearTimeout(timer); resolve(`[Script error: ${e.message}]`); });
      });
    }

    case "read_file": {
      if (!chat.workspaceId) return "[No workspace attached — cannot read files]";
      const ws = dbGetWorkspace(chat.workspaceId);
      if (!ws) return "[Workspace not found]";
      const filePath = action.path ?? description;
      try {
        const root = path.resolve(ws.rootPath);
        const resolved = path.resolve(root, filePath);
        // Guard against path traversal — must stay within the workspace root.
        // The `+ path.sep` check prevents a sibling like `/root-secrets` from
        // satisfying a bare `startsWith(root)` prefix match.
        if (resolved !== root && !resolved.startsWith(root + path.sep)) {
          return "[Path traversal not allowed]";
        }
        const content = fs.readFileSync(resolved, "utf-8");
        return content.slice(0, 8_000);
      } catch {
        return `[Could not read file: ${filePath}]`;
      }
    }

    case "web_search": {
      const query = action.query ?? description;
      const resp = await performSearch(query, signal);
      if (resp.results.length === 0) return "No search results found.";
      const top = resp.results.slice(0, 5);
      sources.push(...top);
      let result = top
        .map((r, i) => `[${(i + 1).toString()}] ${r.title}\n${r.url}\n${r.snippet}`)
        .join("\n\n");
      if (action.constraints) result += `\n\n[Constraints: ${action.constraints}]`;
      return result;
    }

    case "format": {
      const template = action.template ?? "";
      const constraints = action.constraints ?? "";
      const { text } = await provider.complete({
        system: `You are a formatting assistant. ${constraints ? `Constraints: ${constraints}` : ""}`,
        prompt: `Format the following using this template: ${template}\n\nContent to format:\n${description}`,
        signal,
      });
      return text;
    }

    default: {
      const _exhaustive: never = action.type;
      return `[Unknown custom action type: ${String(_exhaustive)}]`;
    }
  }
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildPlannerSystem(customActions: WorkspaceAction[] = []): string {
  const builtinTools = "web_search | read_file | list_files | analyze_image | run_template | reason";
  const customSection = customActions.length > 0
    ? `\n\nThis workspace also has custom actions you may use as tool names:\n${customActions
        .map((a) => `  - "${a.id}": ${a.name} — ${a.description}${a.constraints ? ` [constraints: ${a.constraints}]` : ""}`)
        .join("\n")}`
    : "";
  return `You are an agent planner for the Ariadne AI workspace tool.
First decide whether the task needs a multi-step plan at all.

If it is a simple question, greeting, small talk, or anything you can answer
directly from general knowledge without tools or research, return an EMPTY
steps array — the task will be answered directly:
  { "summary": "Answer directly — no tools needed", "steps": [] }

Otherwise, break it into an ordered list of 2–5 steps. Each step has:
  - "description": what to do (short, action-oriented)
  - "tool": one of ${builtinTools}${customSection}
  - "note": a brief one-line rationale — why this step, what it should surface

Prefer "reason" for pure analysis. Use "web_search" for factual lookup.
Return ONLY JSON: { "summary": "<one line describing your approach>", "steps": [ { "description": "...", "tool": "...", "note": "..." } ] }
This is a plan-and-execute agent. Do not add commentary outside the JSON.`;
}

function buildPlannerPrompt(history: ChatMessage[], userMessage: string): string {
  const historyStr = history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 300)}`)
    .join("\n");
  return `${historyStr ? `Recent conversation:\n${historyStr}\n\n` : ""}Task: ${userMessage}`;
}

function buildReplannerSystem(customActions: WorkspaceAction[] = []): string {
  const builtinTools = "web_search | read_file | list_files | analyze_image | run_template | reason";
  const customSection = customActions.length > 0
    ? ` | ${customActions.map((a) => a.id).join(" | ")}`
    : "";
  return `You are an agent replanner for the Ariadne AI workspace tool.
Given the user task, completed step results so far, and the remaining planned steps,
revise the remaining steps if needed based on what was learned.

Return ONLY JSON: { "steps": [ { "description": "...", "tool": "...", "note": "..." } ] }
"tool" must be one of: ${builtinTools}${customSection}
Each step's "note" is a brief one-line rationale.
If no changes are needed, return the same steps unchanged.`;
}

function buildReplannerPrompt(
  userMessage: string,
  completedResults: string[],
  remainingSteps: AgentStep[],
): string {
  return `Task: ${userMessage}

Completed steps so far:
${completedResults.join("\n\n")}

Remaining planned steps:
${JSON.stringify(remainingSteps.map((s) => ({ description: s.description, tool: s.tool })), null, 2)}

Revise the remaining steps if warranted by what you have learned. Return JSON.`;
}

/** System + prompt for the direct-answer path (planner returned no steps). */
function buildDirectSystem(accountContext?: string): string {
  return appendUserProfile(
    `You are Ariadne's assistant — a calm, precise, local-first AI workspace assistant.
Answer the user's message directly and helpfully.
Always reply in the same language the user writes in.
Be concise and direct. Write your answer as normal Markdown prose — never wrap the whole reply in a code block.`,
    accountContext,
  );
}

function buildDirectPrompt(history: ChatMessage[], userMessage: string): string {
  const historyStr = history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 600)}`)
    .join("\n");
  return `${historyStr ? `Recent conversation:\n${historyStr}\n\n` : ""}User: ${userMessage}`;
}

function buildSynthesisSystem(accountContext?: string): string {
  return appendUserProfile(
    `You are Ariadne's assistant — a calm, precise, local-first AI workspace assistant.
Your role: synthesise the results of a completed research plan into a clear, helpful answer.
Always reply in the same language the user writes in.
Be concise and direct. Reference specific findings where relevant.
Write your answer as normal Markdown prose — never wrap the whole reply in a code block, and do not add bracketed citation markers like [1].`,
    accountContext,
  );
}

function buildSynthesisPrompt(userMessage: string, stepResults: string[]): string {
  return `Original task: ${userMessage}

Research findings:
${stepResults.join("\n\n")}

Based on these findings, provide a comprehensive answer to the original task.`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ParsedPlan {
  steps: Array<{ description: string; tool: AgentTool; note?: string }>;
  summary: string;
}

function parsePlan(raw: string, customActions: WorkspaceAction[] = []): ParsedPlan {
  try {
    const parsed = JSON.parse(extractJson(raw)) as {
      steps?: unknown[];
      summary?: unknown;
    };
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    if (!Array.isArray(parsed.steps)) return { steps: [], summary };
    const validTools = new Set<string>([
      "web_search", "read_file", "list_files", "analyze_image", "run_template", "reason",
      ...customActions.map((a) => a.id),
    ]);
    const steps = parsed.steps
      .filter((s): s is { description: string; tool: string; note?: unknown } =>
        typeof (s as { description?: unknown }).description === "string" &&
        typeof (s as { tool?: unknown }).tool === "string" &&
        validTools.has((s as { tool: string }).tool)
      )
      .map((s) => ({
        description: s.description,
        tool: s.tool as AgentTool,
        note: typeof s.note === "string" && s.note.trim() ? s.note.trim() : undefined,
      }));
    return { steps, summary };
  } catch {
    return { steps: [], summary: "" };
  }
}

async function safeComplete(
  provider: AiProvider,
  req: Parameters<AiProvider["complete"]>[0],
): Promise<string> {
  try {
    const { text } = await provider.complete(req);
    return text;
  } catch {
    return "{}";
  }
}

/** Race a promise against a timeout. On timeout, aborts `ctl` so the tool's
 *  in-flight work can stop, then rejects. */
function withTimeout<T>(promise: Promise<T>, ms: number, ctl: AbortController): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      ctl.abort();
      reject(new Error(`Tool timed out after ${ms.toString()}ms`));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err as Error); },
    );
  });
}
