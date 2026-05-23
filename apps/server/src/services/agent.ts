/**
 * Agent service — plan-and-execute loop for agentMode chat messages.
 *
 * Flow:
 *   1. Plan  — ask provider (JSON) for an ordered list of steps.
 *   2. Execute — run each step's tool; emit SSE events.
 *   3. Re-plan — conditionally, when a step fails or yields a low-information
 *      result (and we still have replan budget left). The previous version
 *      re-planned after every step, paying an LLM round-trip even when the
 *      plan was clearly still fine; in practice 80%+ of those revisions were
 *      no-ops and cost the user 500ms–1s of latency per step.
 *   4. Final  — stream a synthesis of all step results.
 *
 * Safety: max 8 steps total, per-step timeout of 60 s, failed tools keep loop alive.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Chat, ChatMessage, ChatStreamEvent, AgentStep, AgentTrace, AgentTool, WorkspaceAction, SearchResult } from "@ariadne/shared";
import type { AiProvider } from "../providers/index.js";
import { safeResolveUnderRoot } from "../security/pathGuard.js";
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
/**
 * Hard cap on re-planning calls per agent run. One re-plan handles a typical
 * mid-course correction (failed tool, empty search). Higher values rarely pay
 * for themselves — each one costs an extra provider round-trip.
 */
const MAX_REPLANS = 2;

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

  // Load custom actions for this workspace (if any), plus a short summary
  // of workspace state so the planner knows whether file/list tools are
  // even useful. Without this, it routinely planned `read_file` steps for
  // workspace-less chats and burned a tool call on "[No workspace attached]".
  let customActions: WorkspaceAction[] = [];
  let workspaceHint: WorkspaceHint = { attached: false, fileCount: 0 };
  if (chat.workspaceId) {
    const ws = dbGetWorkspace(chat.workspaceId);
    if (ws) {
      const { actions } = loadWorkspaceActions(ws.rootPath);
      customActions = actions;
      const snapshot = dbGetLatestSnapshot(chat.workspaceId);
      workspaceHint = {
        attached: true,
        fileCount: snapshot?.files.length ?? 0,
      };
    }
  }

  // ── 1. Plan ──────────────────────────────────────────────────────────────

  emit({ type: "status", text: "Planning steps…" });

  const planRaw = await safeComplete(provider, {
    system: buildPlannerSystem(customActions, workspaceHint),
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
  // Each conditional re-plan costs a full provider round-trip; track usage
  // against MAX_REPLANS so a long plan can't burn budget mid-execution.
  let replansUsed = 0;

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

    // ── 3. Conditional re-plan ─────────────────────────────────────────────
    // Skip the re-planner LLM call unless something actually changed:
    //   - the step failed (recover), OR
    //   - the step returned little / no information (low signal)
    // and we still have replan budget. Doc-promised but previously not done.
    const isLast = i >= steps.length - 1;
    // A `run_tests` step that reports ✗ should re-plan even though the
    // step itself succeeded (status === "done") and the output is
    // long. This is the fix-until-tests-pass loop the code-editing
    // planner expects.
    const testFailure = step.tool === "run_tests" && /^✗/.test(result.trimStart());
    const shouldConsiderReplan =
      !isLast &&
      replansUsed < MAX_REPLANS &&
      (step.status === "failed" || isLowInformation(result) || testFailure);

    if (shouldConsiderReplan) {
      const remaining = steps.slice(i + 1);
      const revisedRaw = await safeComplete(provider, {
        system: buildReplannerSystem(customActions),
        prompt: buildReplannerPrompt(userMessage, stepResults, remaining),
        json: true,
        signal,
      }).catch(() => null);

      if (revisedRaw) {
        const revisedSteps = parsePlan(revisedRaw, customActions).steps;
        // Skip the rewrite if the re-planner returned an identical or
        // smaller version of what was already queued — it's a no-op
        // change and emitting agent_plan again just causes the client to
        // re-render for nothing.
        if (revisedSteps.length > 0 && !plansEqual(revisedSteps, remaining)) {
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
          replansUsed += 1;
          emit({ type: "status", text: "Adjusting plan…" });
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

    case "calculate": {
      // Math expressions via mathjs — in-process, no side effects, no
      // filesystem / network. The planner puts the expression in the
      // step's description; we accept either a bare expression
      // ("17% of 48200") or one wrapped in obvious context the model
      // tends to add ("Calculate: 17% of 48200" / "= 17% of 48200").
      const { evaluate } = await import("mathjs");
      const cleaned = description
        .replace(/^.*?[:=]/, "")                            // drop "Calculate:" / "result ="
        .replace(/(\d+(?:\.\d+)?)\s*%/g, "($1/100)")         // tolerant percent-of, multi-digit
        .replace(/\bof\b/gi, "*")                           // "of" → "*"
        .trim();
      if (!cleaned) return "[calculate: empty expression]";
      try {
        // Hard timeout via Promise.race — mathjs evaluations are
        // synchronous so we wrap in a setImmediate boundary.
        const result = await Promise.race<unknown>([
          new Promise((resolve, reject) => {
            try {
              resolve(evaluate(cleaned));
            } catch (err) {
              reject(err);
            }
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 200),
          ),
        ]);
        const formatted =
          typeof result === "number" || typeof result === "bigint"
            ? result.toString()
            : (result?.toString?.() ?? JSON.stringify(result));
        return `\`${cleaned}\` = **${formatted}**`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `[calculate failed: ${msg}]`;
      }
    }

    case "edit_file": {
      // Phase C: actually stage. The chat's open attempt is the
      // staging "branch"; multiple edit_file calls in one turn or
      // across turns accumulate into the same manifest.
      if (!chat.workspaceId) return "[No workspace attached — cannot propose file edits]";
      const ws = dbGetWorkspace(chat.workspaceId);
      if (!ws) return "[Workspace not found]";

      // Ask the model for a concrete, machine-readable edit. We accept
      // either {path, search, replace} or {path, content} from the
      // model so it can full-write when the change is too broad for
      // a clean search/replace.
      const { text } = await provider.complete({
        system:
          "You produce a single file edit as JSON. Given a workspace and a goal, " +
          "decide ONE file to change and emit exactly:\n" +
          "  { \"path\": \"...\", \"search\": \"...\", \"replace\": \"...\" }  OR\n" +
          "  { \"path\": \"...\", \"content\": \"...full file body...\" }\n" +
          "Prefer search/replace; fall back to full content only when the change " +
          "is too broad for a clean string match. The `search` must occur exactly " +
          "once in the file. Do not add commentary outside the JSON.",
        prompt: description,
        json: true,
        signal,
      });

      let proposal: { path?: string; search?: string; replace?: string; content?: string };
      try {
        proposal = JSON.parse(extractJson(text)) as typeof proposal;
      } catch {
        return "[edit_file: model did not return valid JSON — kept the agent's plan but did not stage]\n" + text.slice(0, 500);
      }
      if (!proposal.path || typeof proposal.path !== "string") {
        return "[edit_file: missing 'path' in model output]";
      }

      // Resolve the attempt + run the same stage logic the edit_file
      // action block uses. Path-traversal + match-count rules are
      // shared via stageEdit().
      const { getOrOpenAttempt, stagingIdForAttempt } = await import("./attempts.js");
      const { stageEdit } = await import("./stagedEdits.js");
      const attempt = getOrOpenAttempt(chat.id, chat.workspaceId);
      const stagingId = stagingIdForAttempt(attempt.id);

      const abs = safeResolveUnderRoot(ws.rootPath, proposal.path);
      if (!abs) {
        return `[edit_file: path traversal rejected: ${proposal.path}]`;
      }
      const existing = fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : null;

      let proposed: string;
      let action: "create" | "modify" | "replace";
      if (typeof proposal.content === "string") {
        proposed = proposal.content;
        action = existing === null ? "create" : "replace";
      } else if (typeof proposal.search === "string" && proposal.search.length > 0) {
        if (existing === null) return `[edit_file: file does not exist for search/replace: ${proposal.path}]`;
        let count = 0;
        let from = 0;
        while (true) {
          const idx = existing.indexOf(proposal.search, from);
          if (idx === -1) break;
          count++;
          from = idx + proposal.search.length;
        }
        if (count === 0) return `[edit_file: search string not found in ${proposal.path}]`;
        if (count > 1) return `[edit_file: search matched ${count.toString()} times in ${proposal.path} (need exactly 1)]`;
        proposed = existing.split(proposal.search).join(proposal.replace ?? "");
        action = "modify";
      } else {
        return "[edit_file: model output missing 'search' or 'content']";
      }
      if (existing !== null && proposed === existing) {
        return `[edit_file: proposed change is identical to current ${proposal.path}]`;
      }

      try {
        const stats = await stageEdit({
          runId: stagingId,
          workspace: ws,
          path: proposal.path,
          action,
          before: existing,
          after: proposed,
        });
        return `Staged ${action} for ${proposal.path} (+${stats.added.toString()}/-${stats.removed.toString()}) — attempt ${attempt.id.slice(0, 8)}. Review at /attempts/${attempt.id}/diff`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `[edit_file: staging failed: ${msg}]`;
      }
    }

    case "run_tests": {
      // Real execution: run the workspace's test command. Output is
      // prefixed with ✓/✗ so the re-plan gate (low-information
      // detection) can branch on failure automatically.
      if (!chat.workspaceId) return "[No workspace attached — cannot run tests]";
      const ws = dbGetWorkspace(chat.workspaceId);
      if (!ws) return "[Workspace not found]";

      // For agent use the command comes from the step description
      // ("run npm test", "execute pytest -k auth") or a sensible default.
      const command = description.trim() || "npm test";

      const { spawn } = await import("node:child_process");
      return await new Promise<string>((resolve) => {
        let stdout = "";
        let stderr = "";
        const proc = spawn("/bin/sh", ["-c", command], { cwd: ws.rootPath });
        const timer = setTimeout(() => proc.kill("SIGTERM"), 120_000);
        proc.stdout.on("data", (c: Buffer) => { stdout += c.toString("utf-8"); });
        proc.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf-8"); });
        proc.on("close", (code) => {
          clearTimeout(timer);
          const passed = code === 0;
          const head = passed
            ? `✓ Tests passed (\`${command}\`)`
            : `✗ Tests failed (exit ${(code ?? "?").toString()}, \`${command}\`)`;
          // Trim aggressively — agent context budget is tighter than
          // an action block's. Tail of stdout/stderr is what's useful
          // for triage anyway.
          const out = stdout.slice(-1500);
          const err = stderr.slice(-500);
          resolve(
            [head, out.trim() ? "stdout: " + out : "", err.trim() ? "stderr: " + err : ""]
              .filter(Boolean)
              .join("\n"),
          );
        });
        proc.on("error", (e) => {
          clearTimeout(timer);
          resolve(`[run_tests error: ${e.message}]`);
        });
      });
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
        // safeResolveUnderRoot uses `+ path.sep` to block sibling like
        // `/root-secrets` from satisfying a bare prefix match.
        const resolved = safeResolveUnderRoot(ws.rootPath, filePath);
        if (!resolved) return "[Path traversal not allowed]";
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

interface WorkspaceHint {
  attached: boolean;
  fileCount: number;
}

function buildPlannerSystem(
  customActions: WorkspaceAction[] = [],
  workspace: WorkspaceHint = { attached: false, fileCount: 0 },
): string {
  const builtinTools = "web_search | read_file | list_files | analyze_image | run_template | reason | edit_file | run_tests | calculate";
  const customSection = customActions.length > 0
    ? `\n\nThis workspace also has custom actions you may use as tool names:\n${customActions
        .map((a) => `  - "${a.id}": ${a.name} — ${a.description}${a.constraints ? ` [constraints: ${a.constraints}]` : ""}`)
        .join("\n")}`
    : "";
  // A short, structured fact block beats burying these in prose — the
  // planner respects it more reliably and avoids picking `read_file` when
  // there is nothing to read.
  const wsLine = workspace.attached
    ? `Workspace attached: yes (${workspace.fileCount.toString()} indexed files). You may use read_file / list_files / run_template.`
    : `Workspace attached: no. Do NOT pick read_file, list_files, or run_template — they will return errors. Use web_search or reason instead.`;
  return `You are an agent planner for the Ariadne AI workspace tool.
${wsLine}

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

For ANY numeric calculation — percentages, sums over a small set of
values, conversions, weighted averages — use "calculate". The
expression goes in the description (e.g. "17% of 48200",
"(120 + 85 + 230) / 3"). Don't ask the model to do mental arithmetic.

For code-editing tasks (e.g. "fix the failing tests", "rename X to Y",
"add validation to the foo handler") the canonical chain is:
  read_file → reason → edit_file → run_tests
The replanner will re-run the edit/test pair if tests fail, so emit just
one edit_file + run_tests pair — don't pre-plan retries.

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
  const builtinTools = "web_search | read_file | list_files | analyze_image | run_template | reason | edit_file | run_tests | calculate";
  const customSection = customActions.length > 0
    ? ` | ${customActions.map((a) => a.id).join(" | ")}`
    : "";
  return `You are an agent replanner for the Ariadne AI workspace tool.
You are called only when something went off-track — the previous step failed,
returned little information, or revealed the plan was wrong. Given the user
task, completed step results so far, and the remaining planned steps, decide
whether to revise the remaining steps.

Bias toward MINIMAL changes — only rewrite what truly needs to change. If the
existing plan is still fine, return the same steps verbatim; the caller
detects identity and skips the rewrite.

Return ONLY JSON: { "steps": [ { "description": "...", "tool": "...", "note": "..." } ] }
"tool" must be one of: ${builtinTools}${customSection}
Each step's "note" is a brief one-line rationale.`;
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
      "edit_file", "run_tests", "calculate",
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

/**
 * Heuristic: did a tool result tell us almost nothing? Used as a re-plan
 * trigger so the agent can pivot when web search yielded zero results or a
 * file read hit a missing path. Conservative — we'd rather under-trigger a
 * re-plan than burn budget on the wrong signal.
 */
function isLowInformation(result: string): boolean {
  const trimmed = result.trim();
  if (trimmed.length < 40) return true;
  // The standard "I have nothing" markers our own tools emit, plus the most
  // common natural-language equivalents from web/search backends.
  return /^\[[^\]]+\]\s*$|no results found|no snapshot|no workspace|workspace not found|could not read/i.test(
    trimmed,
  );
}

/**
 * Compare a revised plan against the currently-queued remaining steps.
 * Returns true when the re-planner produced an effective no-op so we can
 * skip emitting a fresh `agent_plan` event (and avoid the client re-render).
 */
function plansEqual(
  revised: Array<{ description: string; tool: AgentTool }>,
  remaining: AgentStep[],
): boolean {
  if (revised.length !== remaining.length) return false;
  for (let i = 0; i < revised.length; i++) {
    const r = revised[i];
    const c = remaining[i];
    if (!r || !c) return false;
    if (r.tool !== c.tool) return false;
    // Tolerate tiny wording differences (extra whitespace, punctuation).
    if (normaliseDescription(r.description) !== normaliseDescription(c.description)) return false;
  }
  return true;
}

function normaliseDescription(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?]+$/g, "");
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
