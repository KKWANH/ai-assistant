/**
 * Agent service — plan-and-execute loop for agentMode chat messages.
 *
 * Flow:
 *   1. Plan  — ask provider (JSON) for an ordered list of steps.
 *   2. Execute — run each step's tool; emit SSE events.
 *   3. Re-plan — after each step, let the provider revise remaining steps.
 *   4. Final  — stream a synthesis of all step results.
 *
 * Safety: max 8 steps total, per-step timeout of 30 s, failed tools keep loop alive.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Chat, ChatMessage, ChatStreamEvent, AgentStep, AgentTrace, AgentTool, WorkspaceAction } from "@ariadne/shared";
import type { AiProvider } from "../providers/index.js";
import { extractJson } from "../providers/index.js";
import { performSearch } from "./search.js";
import { focusedRead } from "../gasp/filter.js";
import { dbGetLatestSnapshot, dbGetWorkspace } from "../db/repo.js";
import { createRun } from "../runs/engine.js";
import { loadWorkspaceActions } from "./actions.js";
import { scriptsDir } from "../ariadneFolder.js";
import logger from "../logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_STEPS = 8;
const STEP_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunAgentOptions {
  chat: Chat;
  history: ChatMessage[];
  userMessage: string;
  provider: AiProvider;
  emit: (event: ChatStreamEvent) => void;
}

export interface RunAgentResult {
  content: string;
  agent: AgentTrace;
}

export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const { chat, history, userMessage, provider, emit } = opts;

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
  });

  const initialSteps = parsePlanSteps(planRaw, customActions);
  const steps: AgentStep[] = initialSteps.slice(0, MAX_STEPS).map((s) => ({
    id: crypto.randomUUID(),
    description: s.description,
    tool: s.tool,
    status: "pending" as const,
  }));

  emit({ type: "agent_plan", steps: [...steps] });

  // ── 2. Execute ────────────────────────────────────────────────────────────

  const stepResults: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;

    // Mark running
    step.status = "running";
    emit({ type: "agent_step", step: { ...step } });

    let result: string;
    try {
      result = await withTimeout(
        runTool(step.tool, step.description, chat, provider, customActions),
        STEP_TIMEOUT_MS,
      );
      step.status = "done";
      step.result = result.slice(0, 400);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ stepId: step.id, tool: step.tool, err: msg }, "agent step failed");
      step.status = "failed";
      step.result = `Tool failed: ${msg.slice(0, 200)}`;
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
      }).catch(() => null);

      if (revisedRaw) {
        const revisedSteps = parsePlanSteps(revisedRaw, customActions);
        if (revisedSteps.length > 0) {
          // Replace remaining steps with revised plan (cap total)
          const newRemaining = revisedSteps
            .slice(0, MAX_STEPS - (i + 1))
            .map((s) => ({
              id: crypto.randomUUID(),
              description: s.description,
              tool: s.tool,
              status: "pending" as const,
            }));
          steps.splice(i + 1, steps.length - (i + 1), ...newRemaining);
          emit({ type: "agent_plan", steps: [...steps] });
        }
      }
    }
  }

  // ── 4. Final synthesis ─────────────────────────────────────────────────

  emit({ type: "status", text: "Synthesising answer…" });

  let finalContent = "";
  await provider.completeStream(
    {
      system: buildSynthesisSystem(),
      prompt: buildSynthesisPrompt(userMessage, stepResults),
    },
    (delta) => {
      finalContent += delta;
      emit({ type: "delta", text: delta });
    },
    (status) => {
      emit({ type: "status", text: status });
    },
  );

  const trace: AgentTrace = { steps };
  return { content: finalContent, agent: trace };
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

async function runTool(
  tool: AgentTool,
  description: string,
  chat: Chat,
  provider: AiProvider,
  customActions: WorkspaceAction[] = [],
): Promise<string> {
  // Check if the tool name matches a custom action id
  const customAction = customActions.find((a) => a.id === tool);
  if (customAction) {
    return executeCustomAction(customAction, description, chat, provider);
  }

  switch (tool) {
    case "web_search": {
      const resp = await performSearch(description);
      if (resp.results.length === 0) return "No results found.";
      return resp.results
        .slice(0, 5)
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
        const proc = spawn(cmd, [scriptPath], { cwd: ws.rootPath, env: { ...process.env } });
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
      const resp = await performSearch(query);
      if (resp.results.length === 0) return "No search results found.";
      let result = resp.results
        .slice(0, 5)
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
Given a user task, break it into an ordered list of steps. Each step has:
  - "description": what to do (short, action-oriented)
  - "tool": one of ${builtinTools}${customSection}

Use 2–5 steps. Prefer "reason" for pure analysis. Use "web_search" for factual lookup.
Return ONLY JSON: { "steps": [ { "description": "...", "tool": "..." } ] }
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

Return ONLY JSON: { "steps": [ { "description": "...", "tool": "..." } ] }
"tool" must be one of: ${builtinTools}${customSection}
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

function buildSynthesisSystem(): string {
  return `You are Ariadne's assistant — a calm, precise, local-first AI workspace assistant.
Your role: synthesise the results of a completed research plan into a clear, helpful answer.
Format your response in Markdown. Be concise and direct. Reference specific findings where relevant.`;
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

function parsePlanSteps(
  raw: string,
  customActions: WorkspaceAction[] = [],
): Array<{ description: string; tool: AgentTool }> {
  try {
    const jsonStr = extractJson(raw);
    const parsed = JSON.parse(jsonStr) as { steps?: unknown[] };
    if (!Array.isArray(parsed.steps)) return [];
    const validTools = new Set<string>([
      "web_search", "read_file", "list_files", "analyze_image", "run_template", "reason",
      ...customActions.map((a) => a.id),
    ]);
    return parsed.steps
      .filter((s): s is { description: string; tool: string } =>
        typeof (s as { description?: unknown }).description === "string" &&
        typeof (s as { tool?: unknown }).tool === "string" &&
        validTools.has((s as { tool: string }).tool)
      )
      .map((s) => ({ description: s.description, tool: s.tool as AgentTool }));
  } catch {
    return [];
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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Tool timed out after ${ms.toString()}ms`));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err as Error); },
    );
  });
}
