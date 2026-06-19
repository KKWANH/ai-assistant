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
import { performSearch, fetchUrlText } from "./search.js";
import { appendUserProfile } from "./chatContext.js";
import { focusedRead } from "../gasp/filter.js";
import { dbGetLatestSnapshot, dbGetWorkspace, dbListMcpServers } from "../db/repo.js";
import { createRun } from "../runs/engine.js";
import { loadWorkspaceActions } from "./actions.js";
import { callTool as mcpCallTool, listTools as mcpListTools } from "./mcpClient.js";
import { listMemories, renderMemoryForPrompt } from "./workspaceMemory.js";
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

/** What every built-in tool's `run` receives: the step's description, the chat +
 *  provider it runs under, the per-step abort signal, and the shared `sources`
 *  array that web-gathering tools push onto for citation. Built once per step in
 *  runTool from the same args the switch used to read off its closure. */
interface ToolContext {
  description: string;
  chat: Chat;
  provider: AiProvider;
  sources: SearchResult[];
  signal: AbortSignal;
  /** Whether the originating chat request was a local (loopback) session.
   *  The shell-spawning tools (run_tests, run_script) refuse when false, so a
   *  remote session can plan/read/search/answer but never execute host code. */
  allowLocalExec: boolean;
}

interface ToolDef {
  /** Read-only, side-effect-free, fixed-arg tools (no dependency on a prior
   *  step's result). The executor batches a maximal run of consecutive such
   *  steps concurrently (R3); everything else (edits, runs, mcp_call,
   *  reason/calculate which synthesize prior results) stays strictly sequential. */
  parallel?: boolean;
  /** The tool's execution — each was a `case` in runTool's old switch. */
  run: (ctx: ToolContext) => Promise<string>;
}

/** The built-in agent tools — the SINGLE source for each tool's name,
 *  parallelism, AND execution. Adding a tool is one entry here (plus the shared
 *  `AgentTool` union, which the `run` body can't live without). The
 *  `Record<AgentTool, …>` keys ARE that union, so the compiler forces this table
 *  to stay exhaustive — the successor to runTool's old `default: never` guard —
 *  and rejects a name that isn't a real tool. BUILTIN_AGENT_TOOLS, the planner
 *  schema enum, PARALLEL_TOOLS, the replanner prompt, and runTool's dispatch all
 *  derive from this; nothing repeats the list. Key order is the prompt order, so
 *  keep it stable. */
const AGENT_TOOLS: Record<AgentTool, ToolDef> = {
  web_search: {
    parallel: true,
    run: async ({ description, signal, sources }) => {
      const resp = await performSearch(description, signal);
      if (resp.results.length === 0) return "No results found.";
      const top = resp.results.slice(0, 5);
      sources.push(...top);
      // Read the top pages, not just snippets — so the model can extract real
      // content (tables, rankings, detail) a 150-char snippet can never hold.
      // This is the difference between "couldn't find KLA in the list" and
      // actually pulling the ranking. Concurrent + best-effort; a failed/empty
      // fetch falls back to that result's snippet.
      const pages = await Promise.all(top.slice(0, 3).map((r) => fetchUrlText(r.url, signal)));
      return top
        .map((r, i) => {
          const body = (pages[i] ?? "").trim();
          const content = body ? body.slice(0, 2500) : r.snippet;
          return `[${(i + 1).toString()}] ${r.title}\n${r.url}\n${content}`;
        })
        .join("\n\n");
    },
  },

  read_file: {
    parallel: true,
    run: async ({ description, chat, provider }) => {
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
    },
  },

  list_files: {
    parallel: true,
    run: async ({ chat }) => {
      if (!chat.workspaceId) return "[No workspace attached]";
      const snapshot = dbGetLatestSnapshot(chat.workspaceId);
      if (!snapshot) return "[No snapshot available]";
      const list = snapshot.files.slice(0, 30).map((f) => f.path).join("\n");
      return `Files in workspace:\n${list}`;
    },
  },

  analyze_image: {
    run: async ({ description, provider, signal }) => {
      // Requires images in context — delegate to reason step
      if (!provider.completeWithImages) return "[Vision not supported by this provider]";
      const { text } = await provider.completeWithImages({
        system: "You are a visual analysis assistant.",
        prompt: description,
        images: [],
        signal,
      });
      return text;
    },
  },

  run_template: {
    run: async ({ description, chat }) => {
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
    },
  },

  reason: {
    run: async ({ description, provider, signal }) => {
      const { text } = await provider.complete({
        system: "You are a reasoning assistant. Think through the task carefully and provide a clear, well-structured analysis.",
        prompt: description,
        signal,
      });
      return text;
    },
  },

  edit_file: {
    run: async ({ description, chat, provider, signal }) => {
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
    },
  },

  run_tests: {
    run: async ({ description, chat, allowLocalExec, signal }) => {
      // Real execution: run the workspace's test command. Output is
      // prefixed with ✓/✗ so the re-plan gate (low-information
      // detection) can branch on failure automatically.
      if (!chat.workspaceId) return "[No workspace attached — cannot run tests]";
      // Shell execution is local-only — a remote session must not be able to
      // run host commands through the agent (same rule as terminal/scripts).
      if (!allowLocalExec) {
        return "[Skipped — running commands is only available from the local app, not over the remote connection.]";
      }
      const ws = dbGetWorkspace(chat.workspaceId);
      if (!ws) return "[Workspace not found]";

      // For agent use the command comes from the step description
      // ("run npm test", "execute pytest -k auth") or a sensible default.
      const command = description.trim() || "npm test";

      const { spawn } = await import("node:child_process");
      return await new Promise<string>((resolve) => {
        let stdout = "";
        let stderr = "";
        // scriptEnv() strips API keys/secrets so an agent-run command can't read
        // them out of its own environment.
        const proc = spawn("/bin/sh", ["-c", command], { cwd: ws.rootPath, env: scriptEnv() });
        const timer = setTimeout(() => proc.kill("SIGTERM"), 120_000);
        // Kill the child when the step/run is aborted (Stop, disconnect-reap, or
        // step timeout) — otherwise it keeps running for the full 120s with
        // nobody waiting on it.
        const onAbort = (): void => { proc.kill("SIGTERM"); };
        signal.addEventListener("abort", onAbort, { once: true });
        const cleanup = (): void => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); };
        proc.stdout.on("data", (c: Buffer) => { stdout += c.toString("utf-8"); });
        proc.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf-8"); });
        proc.on("close", (code) => {
          cleanup();
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
          cleanup();
          resolve(`[run_tests error: ${e.message}]`);
        });
      });
    },
  },

  calculate: {
    run: async ({ description }) => {
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
        // mathjs evaluate is synchronous; a Promise.race "timeout" can't
        // interrupt it (the event loop is blocked during evaluation) and only
        // leaks a timer, so call it directly. A malformed expression throws
        // into the catch below.
        const result: unknown = evaluate(cleaned);
        const formatted =
          typeof result === "number" || typeof result === "bigint"
            ? result.toString()
            : (result?.toString?.() ?? JSON.stringify(result));
        return `\`${cleaned}\` = **${formatted}**`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `[calculate failed: ${msg}]`;
      }
    },
  },

  mcp_call: {
    run: async ({ description, chat }) => {
      // Description format the planner agreed to in its system prompt:
      //   "<serverName>::<toolName> <json-args>"
      // We split on the FIRST whitespace after `::` so server/tool names
      // with no internal spaces stay intact and the JSON tail starts
      // where the brace begins.
      const trimmed = description.trim();
      const sepIdx = trimmed.indexOf("::");
      if (sepIdx < 0) {
        return `[mcp_call: description must be "<serverName>::<toolName> <jsonArgs>", got: ${description.slice(0, 80)}]`;
      }
      const serverName = trimmed.slice(0, sepIdx).trim();
      const afterServer = trimmed.slice(sepIdx + 2);
      const braceIdx = afterServer.indexOf("{");
      const toolName = (braceIdx < 0 ? afterServer : afterServer.slice(0, braceIdx)).trim();
      const argsRaw = braceIdx < 0 ? "{}" : afterServer.slice(braceIdx).trim();
      if (!serverName || !toolName) {
        return `[mcp_call: empty server or tool name]`;
      }
      let args: Record<string, unknown>;
      try {
        const parsed = JSON.parse(argsRaw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return `[mcp_call: args must be a JSON object, got ${argsRaw.slice(0, 80)}]`;
        }
        args = parsed as Record<string, unknown>;
      } catch (err) {
        return `[mcp_call: invalid JSON args — ${err instanceof Error ? err.message : String(err)}]`;
      }
      // Resolve serverName → serverId. The planner sees names, not ids,
      // so the agent does the lookup. Account-scoped — admin sees all.
      const candidate = dbListMcpServers(chat.createdBy ?? undefined)
        .find((s) => s.enabled && s.name === serverName);
      if (!candidate) {
        const enabled = dbListMcpServers(chat.createdBy ?? undefined)
          .filter((s) => s.enabled).map((s) => s.name).join(", ") || "(none)";
        // Throw so the caller's catch block sets step.status="failed"
        // and the conditional re-plan kicks in. Re-planner sees the
        // refreshed inventory and can pick the right server.
        throw new Error(`no enabled MCP server named "${serverName}" — registered: ${enabled}`);
      }
      const result = await mcpCallTool(candidate.id, toolName, args);
      // mcpClient.callTool maps tool-level errors to "[mcp_call error] ..."
      // strings (preserves the body for the re-planner). Throw on that
      // prefix so the step status flips to "failed" — without this the
      // UI checklist renders ✓ for a step that visibly failed (the
      // audit V3 bug). The re-plan loop already triggers on
      // step.status === "failed", so a tool-name typo gets a second
      // chance with the full inventory in the planner prompt.
      if (result.startsWith("[mcp_call error]")) {
        throw new Error(result.slice("[mcp_call error]".length).trim());
      }
      return result.slice(0, 8_000);
    },
  },
};

const BUILTIN_AGENT_TOOLS = Object.keys(AGENT_TOOLS) as AgentTool[];
const PARALLEL_TOOLS = new Set<AgentTool>(
  (Object.entries(AGENT_TOOLS) as [AgentTool, ToolDef][])
    .filter(([, def]) => def.parallel)
    .map(([name]) => name),
);

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
  /** Web-search policy forwarded from the request. "on" overrides the
   *  planner's "no tools needed" decision — if the user explicitly
   *  toggled web search, we honor it even when the plan is empty. */
  webSearchMode?: "off" | "auto" | "on";
  /** Whether the chat request came from a local (loopback) session. Gates the
   *  shell-spawning tools (run_tests / run_script). Defaults to false (deny) so
   *  a caller that forgets to pass it can never accidentally enable remote exec. */
  allowLocalExec?: boolean;
}

export interface RunAgentResult {
  content: string;
  agent: AgentTrace;
  /** Web sources gathered across the agent's search steps. */
  searchResults: SearchResult[] | null;
}

export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const { chat, history, userMessage, provider, emit, signal, accountContext, webSearchMode } = opts;
  const allowLocalExec = opts.allowLocalExec ?? false;

  // Load custom actions for this workspace (if any), plus a short summary
  // of workspace state so the planner knows whether file/list tools are
  // even useful. Without this, it routinely planned `read_file` steps for
  // workspace-less chats and burned a tool call on "[No workspace attached]".
  let customActions: WorkspaceAction[] = [];
  let workspaceHint: WorkspaceHint = { attached: false, fileCount: 0 };
  let workspaceMemoryBlock: string | null = null;
  // MCP servers are per-account, not per-workspace. Pre-fetch each
  // enabled server's tool list concurrently so the planner sees the
  // REAL tool names. Without this the planner guesses English-y names
  // (e.g. "list_files" instead of the canonical "list_directory") and
  // every mcp_call step fails with -32602 Tool not found.
  const enabledMcpServers = dbListMcpServers(chat.createdBy ?? undefined)
    .filter((s) => s.enabled);
  const mcpInventory: McpInventoryEntry[] = await Promise.all(
    enabledMcpServers.map(async (s) => {
      try {
        // Cheap when the connection is cached (R3); a few seconds
        // worst-case on the first call of the session. The 10s
        // connect timeout in mcpClient still bounds the worst case.
        const tools = await mcpListTools(s.id);
        return {
          name: s.name,
          tools: tools.map((t) => ({ name: t.name, description: t.description })),
        };
      } catch (err) {
        logger.warn(
          { serverId: s.id, name: s.name, err: (err as Error).message },
          "MCP server failed to list tools at agent start — excluding from planner inventory",
        );
        return { name: s.name, tools: [] };
      }
    }),
  );
  if (chat.workspaceId) {
    const ws = dbGetWorkspace(chat.workspaceId);
    if (ws) {
      const { actions } = loadWorkspaceActions(ws.rootPath);
      customActions = actions;
      const snapshot = dbGetLatestSnapshot(chat.workspaceId);
      workspaceHint = {
        attached: true,
        fileCount: snapshot?.files.length ?? 0,
        files: (snapshot?.files ?? []).slice(0, 50).map((f) => f.path),
        mcpServers: mcpInventory,
      };
      // Memory rides on the planner AND the synthesis system so both the
      // step-picking and the final write-up reflect the user's confirmed
      // facts. Chat-direct already had this; the agent path was the gap.
      workspaceMemoryBlock = renderMemoryForPrompt(listMemories(ws.rootPath));
    } else {
      workspaceHint = { attached: false, fileCount: 0, mcpServers: mcpInventory };
    }
  } else {
    workspaceHint = { attached: false, fileCount: 0, mcpServers: mcpInventory };
  }

  // ── 1. Plan ──────────────────────────────────────────────────────────────

  emit({ type: "status", text: "Planning steps…" });

  const plannerSchema = buildPlannerSchema(customActions);
  const planRaw = await safeComplete(provider, {
    system: withMemory(buildPlannerSystem(customActions, workspaceHint), workspaceMemoryBlock),
    prompt: buildPlannerPrompt(history, userMessage),
    json: true,
    jsonSchema: plannerSchema,
    // Planning is structured selection, not prose — pick which real files to
    // read and in what order. With the manifest grounding it, chain-of-thought
    // adds ~40s of <think> on a local reasoning model for little gain. Ollama
    // honors this via native /api/chat (think:false + the schema as `format`),
    // so the plan is still guided-decoded; other providers ignore it.
    noThink: true,
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

  // Explicit-on web search must always reach the answer. If the user
  // toggled web search on but the plan doesn't already include a
  // web_search step (empty plan OR a 1-step reason/think plan), prepend
  // one so the execution loop runs the search and feeds the results
  // into synthesis. Without this, the planner silently overrules the
  // user — the bug the dev-persona audit V3 caught ("TensorFlow is MIT"
  // hallucination on a license-comparison prompt with web search on),
  // and the V2.1 residual gap where a 1-step `[{tool:"reason"}]` plan
  // bypassed the original `steps.length === 0` guard.
  if (
    webSearchMode === "on"
    && userMessage.trim()
    && !steps.some((s) => s.tool === "web_search")
  ) {
    steps.unshift({
      id: crypto.randomUUID(),
      description: userMessage.trim().slice(0, 240),
      tool: "web_search",
      note: "User explicitly enabled web search.",
      status: "pending" as const,
    });
  }

  // Simple message — the planner decided no tools/research are needed
  // and the user didn't force web search either. Skip the plan-and-
  // execute loop and answer directly.
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

  // Execute one step: run its tool with a per-step timeout, update status, and
  // emit progress. Returns the FULL tool result (step.result is truncated for
  // display). Extracted so a run of independent read-only steps (R3) can be
  // driven concurrently via Promise.all. Never throws — a tool failure is
  // captured as a failed status so a parallel batch always resolves.
  const executeStep = async (step: AgentStep): Promise<string> => {
    step.status = "running";
    emit({ type: "agent_step", step: { ...step } });

    // Per-step abort — fires if the agent is cancelled OR this step times
    // out, so the tool's in-flight LLM / network call is actually stopped.
    const stepCtl = new AbortController();
    const stepSignal = AbortSignal.any([signal, stepCtl.signal]);
    let result: string;
    try {
      result = await withTimeout(
        runTool(step.tool, step.description, chat, provider, customActions, collectedSources, stepSignal, allowLocalExec),
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
    return result;
  };

  let i = 0;
  while (i < steps.length) {
    if (signal.aborted) break;

    // Group a maximal run of consecutive independent read-only steps so they
    // run concurrently (R3). A single non-parallelizable step is just a run of
    // length 1, executed exactly as before.
    let runEnd = i;
    if (steps[i] && PARALLEL_TOOLS.has(steps[i]!.tool)) {
      while (
        runEnd + 1 < steps.length &&
        steps[runEnd + 1] &&
        PARALLEL_TOOLS.has(steps[runEnd + 1]!.tool)
      ) {
        runEnd += 1;
      }
    }
    const batch = steps.slice(i, runEnd + 1).filter((s): s is AgentStep => !!s);
    if (batch.length === 0) {
      i = runEnd + 1;
      continue;
    }

    // Execute concurrently when the run has more than one step.
    const results =
      batch.length > 1
        ? await Promise.all(batch.map((s) => executeStep(s)))
        : [await executeStep(batch[0]!)];

    // Record results in plan order for synthesis and re-planning. Use the FULL
    // tool result (not step.result, which is truncated to 400 chars for the
    // trace UI) so synthesis can actually read web-page / file content — capped
    // so a long page can't blow the synthesis context.
    batch.forEach((s, i) => {
      const full = (results[i] ?? s.result ?? "").slice(0, 4000);
      stepResults.push(`Step "${s.description}" (${s.tool}): ${full}`);
    });

    // ── 3. Conditional re-plan ─────────────────────────────────────────────
    // Skip the re-planner LLM call unless something actually changed:
    //   - a step failed (recover), OR
    //   - the run returned little / no information (low signal), OR
    //   - a run_tests step reported ✗ (fix-until-tests-pass loop)
    // and we still have replan budget. For a parallel batch the decision is
    // made once, after the whole run (the steps are independent); for a single
    // step this is identical to the previous per-step behavior.
    const lastIdx = runEnd;
    const isLast = lastIdx >= steps.length - 1;
    const lastStep = batch[batch.length - 1]!;
    const lastResult = results[results.length - 1] ?? "";
    const testFailure = lastStep.tool === "run_tests" && /^✗/.test(lastResult.trimStart());
    const anyFailed = batch.some((s) => s.status === "failed");
    const allLowInformation = results.every((r) => isLowInformation(r));
    const shouldConsiderReplan =
      !isLast &&
      replansUsed < MAX_REPLANS &&
      (anyFailed || allLowInformation || testFailure);

    if (shouldConsiderReplan) {
      const remaining = steps.slice(lastIdx + 1);
      const revisedRaw = await safeComplete(provider, {
        system: buildReplannerSystem(customActions, workspaceHint),
        prompt: buildReplannerPrompt(userMessage, stepResults, remaining),
        json: true,
        jsonSchema: plannerSchema,
        noThink: true,
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
            .slice(0, MAX_STEPS - (lastIdx + 1))
            .map((s) => ({
              id: crypto.randomUUID(),
              description: s.description,
              tool: s.tool,
              note: s.note,
              status: "pending" as const,
            }));
          steps.splice(lastIdx + 1, steps.length - (lastIdx + 1), ...newRemaining);
          replansUsed += 1;
          emit({ type: "status", text: "Adjusting plan…" });
          emit({ type: "agent_plan", steps: [...steps] });
        }
      }
    }

    i = runEnd + 1;
  }

  // ── 4. Final synthesis ─────────────────────────────────────────────────

  let finalContent = "";
  if (!signal.aborted) {
    emit({ type: "status", text: "Synthesising answer…" });
    try {
      await provider.completeStream(
        {
          system: withMemory(buildSynthesisSystem(accountContext), workspaceMemoryBlock),
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
  allowLocalExec: boolean,
): Promise<string> {
  // Check if the tool name matches a custom action id
  const customAction = customActions.find((a) => a.id === tool);
  if (customAction) {
    return executeCustomAction(customAction, description, chat, provider, sources, signal, allowLocalExec);
  }

  // Dispatch to the registry — every built-in tool's execution lives in its
  // AGENT_TOOLS[tool].run. The planner schema constrains `tool` to the
  // registered names plus custom-action ids; a custom action deleted between
  // planning and execution arrives as a name with no entry, so fall back the
  // same way the old switch's `default` did.
  const entry = AGENT_TOOLS[tool];
  if (!entry) return `[Unknown tool: ${String(tool)}]`;
  return entry.run({ description, chat, provider, sources, signal, allowLocalExec });
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
  allowLocalExec: boolean,
): Promise<string> {
  switch (action.type) {
    case "run_script": {
      if (!chat.workspaceId) return "[No workspace attached — cannot run scripts]";
      // Script execution is local-only — same rule as run_tests / terminal.
      if (!allowLocalExec) {
        return "[Skipped — running scripts is only available from the local app, not over the remote connection.]";
      }
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
        // Kill the script if the step/run is aborted (Stop, disconnect-reap).
        const onAbort = (): void => { proc.kill("SIGTERM"); };
        signal.addEventListener("abort", onAbort, { once: true });
        const cleanup = (): void => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); };
        proc.stdout.on("data", (c: Buffer) => { out += c.toString("utf-8"); });
        proc.stderr.on("data", (c: Buffer) => { err += c.toString("utf-8"); });
        proc.on("close", (code) => {
          cleanup();
          const result = out.slice(0, 8_000);
          if (err) resolve(`stdout: ${result}\nstderr: ${err.slice(0, 1_000)}\nexit: ${String(code)}`);
          else resolve(result || `[Script exited with code ${String(code)}]`);
        });
        proc.on("error", (e) => { cleanup(); resolve(`[Script error: ${e.message}]`); });
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

interface McpInventoryEntry {
  /** Server name as registered (e.g. "audit-fs"). The agent picks
   *  steps by name, not id. */
  name: string;
  /** Tools the server actually exposed when we listed them. Empty
   *  array means listTools failed — we still include the server so
   *  the planner sees its name but it won't generate confident
   *  `serverName::toolName` choices. */
  tools: Array<{ name: string; description: string }>;
}

interface WorkspaceHint {
  attached: boolean;
  fileCount: number;
  /** A sample of the actual indexed file paths. Without this the planner
   *  only knows *how many* files exist, not *what* they are, so it plans
   *  around a guessed generic project (`README.md`, `main.py`, `tests/`,
   *  a `/workspace` root) that doesn't match the real workspace — the first
   *  read/list step then fails. Feeding the real manifest makes the plan
   *  cite files that exist. Capped to keep the prompt small. */
  files?: string[];
  /** Enabled MCP servers visible to this account, each carrying its
   *  current tool list. The planner system prompt renders these so
   *  the model picks REAL tool names (e.g. `list_directory`) instead
   *  of guessing English-sounding ones (`list_files`) that don't
   *  exist on the server. Pre-fetched concurrently at agent start;
   *  servers that fail to list are skipped from the inventory. */
  mcpServers?: McpInventoryEntry[];
}

/** Append the workspace memory block to a system prompt, no-op when empty.
 *  Kept tiny + at the top of the prompt builders so every system prompt
 *  that wants memory follows the same single concatenation. */
function withMemory(system: string, memoryBlock: string | null): string {
  if (!memoryBlock) return system;
  return system + "\n\n" + memoryBlock;
}

/** Build a JSON schema for the planner output so providers that support
 *  guided decoding (OpenAI json_schema, vLLM xgrammar, Anthropic
 *  tool input_schema, Gemini responseSchema) enforce the shape at the
 *  decoding layer. Without this, a malformed planner response slips
 *  through parsePlan's catch block as `{steps:[]}` → agentic mode
 *  silently disables. With it, the model literally cannot emit
 *  invalid JSON in the first place. */
function buildPlannerSchema(customActions: WorkspaceAction[] = []) {
  const toolEnum = [
    ...BUILTIN_AGENT_TOOLS,
    ...customActions.map((a) => a.id),
  ];
  return {
    name: "ariadne_plan",
    schema: {
      type: "object" as const,
      additionalProperties: false,
      required: ["summary", "steps"],
      properties: {
        summary: { type: "string" },
        steps: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["description", "tool"],
            properties: {
              description: { type: "string" },
              tool: { type: "string", enum: toolEnum },
              note: { type: "string" },
            },
          },
        },
      },
    },
  };
}

/** A compact list of the workspace's real files for a planner/replanner
 *  prompt ("" when none). Grounds the plan in files that exist — read_file
 *  takes these exact relative paths — and steers away from an external fs MCP
 *  server whose root differs from the workspace. Shared by plan + re-plan so a
 *  recovery plan is just as grounded as the first one. */
function workspaceManifestBlock(workspace: WorkspaceHint): string {
  if (!workspace.files || workspace.files.length === 0) return "";
  const more =
    workspace.fileCount > workspace.files.length
      ? `\n  … and ${(workspace.fileCount - workspace.files.length).toString()} more`
      : "";
  return `\nIndexed files — plan around THESE; pass these exact relative paths to read_file, and prefer the built-in read_file / list_files over any external fs MCP tool for workspace files:\n${workspace.files
    .map((p) => `  - ${p}`)
    .join("\n")}${more}`;
}

function buildPlannerSystem(
  customActions: WorkspaceAction[] = [],
  workspace: WorkspaceHint = { attached: false, fileCount: 0 },
): string {
  const mcpAvailable = (workspace.mcpServers?.length ?? 0) > 0;
  // Derive from the registry (single source) — mcp_call is only offered when the
  // workspace actually has an enabled MCP server. Adding a tool to AGENT_TOOLS
  // now surfaces it to the planner automatically.
  const builtinTools = BUILTIN_AGENT_TOOLS
    .filter((t) => t !== "mcp_call" || mcpAvailable)
    .join(" | ");
  const customSection = customActions.length > 0
    ? `\n\nThis workspace also has custom actions you may use as tool names:\n${customActions
        .map((a) => `  - "${a.id}": ${a.name} — ${a.description}${a.constraints ? ` [constraints: ${a.constraints}]` : ""}`)
        .join("\n")}`
    : "";
  // Render the FULL MCP inventory: each enabled server with its exact
  // tool names + descriptions. Without this, the planner guesses
  // English-sounding names ("list_files") that don't exist on the
  // server — see audit V3. With it, the planner sees that the fs
  // server's actual list-files tool is `list_directory`.
  const mcpSection = mcpAvailable
    ? `\n\nMCP servers available (use the "mcp_call" tool). Each server's exact tool names are listed — DO NOT guess tool names, use one from this list verbatim:\n${
        (workspace.mcpServers ?? [])
          .map((s) => {
            if (s.tools.length === 0) {
              return `  - ${s.name} (no tools — server failed to list; pick a different server or skip mcp_call)`;
            }
            const toolLines = s.tools
              .slice(0, 30)
              .map((t) => `      · ${t.name}${t.description ? ` — ${t.description.slice(0, 100)}` : ""}`)
              .join("\n");
            const more = s.tools.length > 30 ? `\n      … and ${(s.tools.length - 30).toString()} more` : "";
            return `  - ${s.name}\n${toolLines}${more}`;
          })
          .join("\n")
      }\n\nFor mcp_call, the "description" MUST be: <serverName>::<toolName> <json-args>\nExample: { "tool": "mcp_call", "description": "fs::read_text_file {\\"path\\":\\"/tmp/x.txt\\"}", "note": "Read the requested file via the fs MCP server" }`
    : "";
  // A short, structured fact block beats burying these in prose — the
  // planner respects it more reliably and avoids picking `read_file` when
  // there is nothing to read.
  const manifest = workspaceManifestBlock(workspace);
  const wsLine = workspace.attached
    ? `Workspace attached: yes (${workspace.fileCount.toString()} indexed files). You may use read_file / list_files / run_template.${manifest}`
    : `Workspace attached: no. Do NOT pick read_file, list_files, or run_template — they will return errors. Use web_search or reason instead.`;
  return `You are an agent planner for the Ariadne AI workspace tool.
${wsLine}

Step 1: decide whether the task needs a multi-step plan at all.

If it is a simple question, greeting, small talk, or anything you can answer
directly from general knowledge without tools or research, return an EMPTY
steps array — the task will be answered directly:
  { "summary": "Answer directly — no tools needed", "steps": [] }

Otherwise, decompose the task into an ordered list of 2–7 steps that, run
in sequence, will let the synthesiser write a calibrated, well-cited
answer. Each step has:
  - "description": what to do (short, action-oriented)
  - "tool": one of ${builtinTools}${customSection}
  - "note": one-line rationale — *what specific finding this step is
    expected to surface* (not just 'gather info'). Vague notes produce
    vague answers downstream.

Quality bar for the plan:
  - Hit the question's actual sub-parts. If the user asks 'how does X
    compare to Y in 2026?', you almost certainly need at least 2
    research steps (X then Y) plus a comparison step.
  - Prefer 'web_search' for time-sensitive facts (rates, prices,
    laws, news). Prefer 'reason' for pure analysis of material the
    earlier steps surfaced. Don't 'reason' about facts you haven't
    fetched.
  - For ANY numeric calculation — percentages, sums over a small set
    of values, conversions, weighted averages — use "calculate". The
    expression goes in the description (e.g. "17% of 48200",
    "(120 + 85 + 230) / 3"). Don't ask the model to do mental
    arithmetic — it gets it wrong.
  - For code-editing tasks the canonical chain is
    read_file → reason → edit_file → run_tests. The replanner re-runs
    edit/test if tests fail — emit just one pair.

Quality bar against under-planning:
  - If you find yourself wanting a 1-step "reason" plan to handle a
    question with research components, that's almost always wrong —
    return more concrete tool steps instead. The downstream
    synthesiser will read your step results, not invent its own.

Quality bar against over-planning:
  - 8+ steps suggest the task should be smaller. Cap at 7. The
    replanner can extend if needed.
  - Don't add a 'verify' or 'double-check' step unless the question
    explicitly demands extreme care — the synthesiser already
    distinguishes confirmed vs plausible.

Return ONLY JSON: { "summary": "<one line describing your approach>", "steps": [ { "description": "...", "tool": "...", "note": "..." } ] }
This is a plan-and-execute agent. Do not add commentary outside the JSON.${mcpSection}`;
}

function buildPlannerPrompt(history: ChatMessage[], userMessage: string): string {
  const historyStr = history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 300)}`)
    .join("\n");
  return `${historyStr ? `Recent conversation:\n${historyStr}\n\n` : ""}Task: ${userMessage}`;
}

function buildReplannerSystem(
  customActions: WorkspaceAction[] = [],
  workspace: WorkspaceHint = { attached: false, fileCount: 0 },
): string {
  const builtinTools = BUILTIN_AGENT_TOOLS.join(" | ");
  const customSection = customActions.length > 0
    ? ` | ${customActions.map((a) => a.id).join(" | ")}`
    : "";
  return `You are an agent replanner for the Ariadne AI workspace tool.${workspaceManifestBlock(workspace)}
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
  // AI4 — direct (no-agent) chat. Mirrors the synthesiser's principles
  // at a lighter weight: answer well from priors + any context already
  // in the prompt (workspace meta / memory / attachments / web-search
  // results — all of which the chat-context builder may have injected
  // even on the no-step path). Citations on, gaps surfaced honestly,
  // no padding.
  return appendUserProfile(
    `You are Ariadne's assistant — a calm, precise, local-first AI workspace assistant.

Answer rules:
  - Same language as the user's question.
  - Lead with the answer, then back it up. No 'Great question!' or
    'Sure!' intros, no recap of the question.
  - When the prompt includes web-search results, workspace files, or
    attachments, treat them as the primary source. Cite specific
    snippets inline as [1], [2], … matching the order they appear in
    the prompt. The UI surfaces them.
  - When the user asks something the supplied context doesn't cover,
    answer from your own knowledge but say so ('I don't see anything
    about X in the supplied files — from general knowledge, …').
    Never silently pretend the context covered a question it didn't.
  - Concise > comprehensive. Two sentences if two sentences suffice.
  - Markdown prose. Lists / tables only when the content is genuinely
    list-shaped.
  - Never wrap the entire reply in a code block.`,
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
  // AI4 — intelligence boost. The earlier prompt was three sentences of
  // generic 'be helpful, be concise'. That left too much variance in
  // answer quality (especially for chat-with-search where the model
  // would happily ignore the search results and answer from priors).
  //
  // The new prompt forces a clear think→check→write→limit shape and
  // makes citations + honest gaps an explicit requirement. It also
  // un-bans inline [1]-style citations (the earlier prompt forbade
  // them — that was right for pure-LLM answers, wrong for ones built
  // on search/file results, which the user has every reason to trust
  // less without seeing where claims come from).
  return appendUserProfile(
    `You are Ariadne's assistant — a calm, precise, local-first AI workspace assistant.
You have just completed a research plan; your job now is to synthesise its
findings into the best possible answer for the user.

Before you write the answer, think through (silently — do not narrate this
to the user):
  1. What did each step actually establish? Distinguish *confirmed* facts
     (multiple sources agree, or a primary source says so directly) from
     *plausible* claims (one secondary source, or an inference) from
     *gaps* (the question requires information no step produced).
  2. Do any findings conflict? If so, the answer must surface the
     conflict, not paper over it.
  3. Does the user's question have a calibrated yes/no / numeric answer
     buried in the findings, or only directional guidance?

Then write the answer with these rules:
  - Same language as the user's question.
  - Lead with the answer, then back it up. No throat-clearing intros.
  - Cite specific findings inline using [1], [2], … when the answer
    depends on a search result or a file read. Order corresponds to the
    Research findings block below; you don't need a footer reference
    list — the UI surfaces them.
  - When sources disagree, say so explicitly ('A says X; B says Y' →
    your reasoned best-guess + the uncertainty).
  - When the findings don't cover part of the question, say so
    explicitly ('the plan didn't surface evidence on Y'). Don't fill
    gaps with plausible-sounding guesses.
  - Concise > comprehensive. A two-sentence answer beats a 200-word
    one if the question is two sentences worth.
  - Markdown prose, not a code block. Lists / tables OK when the answer
    is genuinely list-shaped.

The user is not your only reader — your answer becomes part of the
workspace's audit trail. Calibrated honesty beats confident-sounding
guesses every time.`,
    accountContext,
  );
}

function buildSynthesisPrompt(userMessage: string, stepResults: string[]): string {
  const numbered = stepResults
    .map((r, i) => `[${(i + 1).toString()}] ${r}`)
    .join("\n\n");
  return `User's original question: ${userMessage}

Research findings (cite as [1], [2], …):
${numbered}

Now: think through the findings per the system prompt, then write the answer.`;
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
      ...BUILTIN_AGENT_TOOLS,
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
