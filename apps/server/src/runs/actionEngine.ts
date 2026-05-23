/**
 * Action pipeline engine — runs a block-pipeline ActionDef as a Run (kind="action").
 *
 * Blocks execute in order; each block's output becomes the next block's
 * `priorOutput`. Fail-fast: the first failing block stops the pipeline and the
 * run is marked failed, with every block's BlockResult kept so the user sees
 * exactly where it stopped.
 */

import fs from "node:fs";
import path from "node:path";
import type { Run, ActionDef, ActionBlock, BlockResult, Workspace } from "@ariadne/shared";
import { safeResolveUnderRoot } from "../security/pathGuard.js";
import {
  dbGetRun,
  dbInsertRun,
  dbUpdateRun,
  dbListRuns,
  dbGetWorkspace,
  dbGetRunUsage,
} from "../db/repo.js";
import type { AiProvider } from "../providers/index.js";
import { getProvider } from "../providers/index.js";
import { getActiveSettings } from "../config.js";
import { performSearch } from "../services/search.js";
import { loadActionDefs } from "../services/actions.js";
import { scriptEnv } from "../services/scriptEnv.js";
import { scriptsDir } from "../ariadneFolder.js";
import { meteringProvider, makeDateRunId, traceEvent, appendTrace, failRun } from "./engine.js";
import logger from "../logger.js";

const BLOCK_LLM_TIMEOUT_MS = 60_000;
const SCRIPT_TIMEOUT_MS = 30_000;
const OUTPUT_CAP = 8_000;

/** Create an action run and fire the pipeline asynchronously. */
export async function createActionRun(input: {
  workspaceId: string;
  actionId: string;
  input?: Record<string, string>;
  createdBy?: string | null;
}): Promise<Run> {
  const workspace = dbGetWorkspace(input.workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${input.workspaceId}`);

  const { actions } = loadActionDefs(workspace.rootPath);
  const action = actions.find((a) => a.id === input.actionId);
  if (!action) throw new Error(`Action not found: ${input.actionId}`);

  const settings = getActiveSettings();
  const run: Run = {
    id: makeDateRunId(dbListRuns()),
    kind: "action",
    workspaceId: input.workspaceId,
    templateId: action.id,
    templateName: action.name,
    status: "created",
    input: input.input ?? {},
    model: settings.model,
    provider: settings.provider,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    candidateFiles: [],
    selectedFiles: [],
    tokenEstimate: 0,
    evidenceCount: 0,
    unsupportedCount: 0,
    artifacts: {},
    trace: [],
    previousRunId: null,
    error: null,
    createdBy: input.createdBy ?? null,
    createdByName: null,
    usage: null,
    blockResults: [],
  };

  dbInsertRun(run);

  void runActionPipeline(run.id, action).catch((err: unknown) => {
    logger.error({ runId: run.id, err }, "Unhandled error in runActionPipeline");
  });

  return run;
}

async function runActionPipeline(runId: string, action: ActionDef): Promise<void> {
  const run = dbGetRun(runId);
  if (!run) return;
  const workspace = dbGetWorkspace(run.workspaceId);
  if (!workspace) {
    failRun(run, "block", new Error("Workspace not found"));
    return;
  }

  run.startedAt = new Date().toISOString();
  dbUpdateRun(runId, { status: "generating", startedAt: run.startedAt });

  let provider: AiProvider;
  try {
    const settings = getActiveSettings();
    provider = meteringProvider(await getProvider(settings), runId, settings.model);
  } catch (err) {
    failRun(run, "block", err);
    return;
  }

  const results: BlockResult[] = [];
  let priorOutput = "";

  for (let i = 0; i < action.blocks.length; i++) {
    const block = action.blocks[i]!;
    const label = `Block ${(i + 1).toString()}/${action.blocks.length.toString()}: ${block.type}`;
    const result: BlockResult = {
      blockId: block.id,
      type: block.type,
      status: "running",
      output: "",
      startedAt: new Date().toISOString(),
    };
    results.push(result);
    appendTrace(run, traceEvent("block", "running", label));
    dbUpdateRun(runId, { blockResults: results });

    try {
      const output = await runBlock(block, priorOutput, workspace, provider, runId);
      result.status = "ok";
      result.output = output;
      priorOutput = output;
      appendTrace(run, traceEvent("block", "ok", label));
      dbUpdateRun(runId, { blockResults: results });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.status = "failed";
      result.error = msg;
      appendTrace(run, traceEvent("block", "failed", label, msg));
      const usage = dbGetRunUsage(runId);
      dbUpdateRun(runId, {
        status: "failed",
        error: `${label} failed: ${msg}`,
        completedAt: new Date().toISOString(),
        blockResults: results,
        usage: usage.inputTokens > 0 || usage.outputTokens > 0 ? usage : null,
      });
      logger.warn({ runId, block: block.id, err: msg }, "action block failed");
      return;
    }
  }

  const usage = dbGetRunUsage(runId);
  dbUpdateRun(runId, {
    status: "completed",
    completedAt: new Date().toISOString(),
    blockResults: results,
    usage: usage.inputTokens > 0 || usage.outputTokens > 0 ? usage : null,
  });

  // Mirror engine.ts: auto-version the .ariadne/ artifacts in the
  // workspace's history repo. Background, no-op without git.
  setImmediate(() => {
    void (async () => {
      try {
        const { commitWorkspaceHistory } = await import("../services/workspaceGit.js");
        await commitWorkspaceHistory(
          workspace.rootPath,
          `action: ${action.name} (${runId}) completed`,
        );
      } catch (err) {
        logger.debug({ runId, err }, "workspaceGit commit threw");
      }
    })();
  });

  logger.info({ runId, blocks: action.blocks.length }, "action run completed");
}

/** Execute one block. Throws on failure (the pipeline stops fail-fast). */
async function runBlock(
  block: ActionBlock,
  priorOutput: string,
  workspace: Workspace,
  provider: AiProvider,
  runId: string,
): Promise<string> {
  const cfg = block.config;

  switch (block.type) {
    case "ask_ai": {
      const instruction = (cfg["prompt"] ?? "").trim();
      if (!instruction) throw new Error("ask_ai: missing 'prompt'");
      const prompt = priorOutput
        ? `Instruction:\n${instruction}\n\nPrevious step output:\n${priorOutput}`
        : `Instruction:\n${instruction}`;
      const { text } = await provider.complete({
        system:
          "You are an assistant inside an Ariadne action pipeline. " +
          "Follow the instruction and answer clearly and concisely in Markdown.",
        prompt,
        signal: AbortSignal.timeout(BLOCK_LLM_TIMEOUT_MS),
      });
      return text;
    }

    case "web_analysis": {
      const query = (cfg["query"] || priorOutput).trim().slice(0, 240);
      if (!query) throw new Error("web_analysis: no query (set 'query' or chain after a block)");
      const resp = await performSearch(query);
      if (resp.results.length === 0) return "검색 결과가 없습니다.";
      const top = resp.results.slice(0, 6);
      const sourcesBlock = top
        .map((r, i) => `[${(i + 1).toString()}] ${r.title}\n${r.url}\n${r.snippet}`)
        .join("\n\n");
      const { text } = await provider.complete({
        system:
          "Summarize these web search results into a concise, well-sourced analysis " +
          "in Markdown. Keep the bracketed source numbers.",
        prompt: `Query: ${query}\n\nResults:\n${sourcesBlock}`,
        signal: AbortSignal.timeout(BLOCK_LLM_TIMEOUT_MS),
      });
      return text;
    }

    case "run_script": {
      const scriptName = (cfg["script"] ?? "").trim();
      if (!scriptName) throw new Error("run_script: missing 'script'");
      const scriptPath = path.join(scriptsDir(workspace.rootPath), scriptName);
      if (!fs.existsSync(scriptPath)) throw new Error(`Script not found: ${scriptName}`);
      const isShell = scriptName.endsWith(".sh");
      const isPy = scriptName.endsWith(".py");
      if (!isShell && !isPy) throw new Error(`Unsupported script type: ${scriptName}`);

      const { spawn } = await import("node:child_process");
      const cmd = isShell ? "/bin/bash" : "python3";
      return await new Promise<string>((resolve, reject) => {
        let out = "";
        let err = "";
        const proc = spawn(cmd, [scriptPath], { cwd: workspace.rootPath, env: scriptEnv() });
        const timer = setTimeout(() => {
          proc.kill("SIGTERM");
          reject(new Error("Script timed out"));
        }, SCRIPT_TIMEOUT_MS);
        proc.stdout.on("data", (c: Buffer) => { out += c.toString("utf-8"); });
        proc.stderr.on("data", (c: Buffer) => { err += c.toString("utf-8"); });
        proc.on("close", (code) => {
          clearTimeout(timer);
          const result = out.slice(0, OUTPUT_CAP);
          if (code !== 0 && !result) {
            reject(new Error(`Script exited ${String(code)}: ${err.slice(0, 500)}`));
          } else {
            resolve(result || `[script exited ${String(code)}]`);
          }
        });
        proc.on("error", (e) => { clearTimeout(timer); reject(e); });
      });
    }

    case "read_file": {
      const filePath = (cfg["path"] ?? "").trim();
      if (!filePath) throw new Error("read_file: missing 'path'");
      const resolved = safeResolveUnderRoot(workspace.rootPath, filePath);
      if (!resolved) throw new Error("Path traversal not allowed");
      if (!fs.existsSync(resolved)) throw new Error(`File not found: ${filePath}`);
      return fs.readFileSync(resolved, "utf-8").slice(0, OUTPUT_CAP);
    }

    case "write_file": {
      // Closes the loop for scheduled actions — the prior block's text
      // (or a configured constant) lands back on disk. mode=append is
      // the default since most callers want a running log (monthly
      // briefs append into one file rather than overwriting).
      const filePath = (cfg["path"] ?? "").trim();
      if (!filePath) throw new Error("write_file: missing 'path'");
      const mode = (cfg["mode"] ?? "append").trim().toLowerCase();
      if (mode !== "append" && mode !== "replace") {
        throw new Error("write_file: 'mode' must be 'append' or 'replace'");
      }
      // Substitute {date} / {time} / {timestamp} in the path so a schedule
      // can land into per-run files without templating elsewhere.
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, "0");
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}`;
      const resolvedPath = filePath
        .replace(/\{date\}/g, dateStr)
        .replace(/\{time\}/g, timeStr)
        .replace(/\{timestamp\}/g, `${dateStr}_${timeStr}`);

      const abs = safeResolveUnderRoot(workspace.rootPath, resolvedPath);
      if (!abs) throw new Error("Path traversal not allowed");
      // Body: explicit cfg.content wins, otherwise the prior block's output.
      const body = (cfg["content"] ?? priorOutput ?? "").toString();
      if (!body.trim()) {
        throw new Error("write_file: nothing to write (no priorOutput and no 'content')");
      }
      // Ensure the directory exists so users can target e.g. briefs/{date}.md.
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (mode === "replace") {
        fs.writeFileSync(abs, body, "utf-8");
      } else {
        // Separator only inserted when the file already has content, so a
        // brand-new file isn't prefixed with a stray blank line.
        const sep = fs.existsSync(abs) && fs.statSync(abs).size > 0 ? "\n\n---\n\n" : "";
        fs.appendFileSync(abs, sep + body, "utf-8");
      }
      const rel = path.relative(path.resolve(workspace.rootPath), abs);
      return `Wrote ${body.length.toString()} chars to ${rel} (${mode}).`;
    }

    case "edit_file": {
      // Doesn't touch the workspace — proposed edit lands at
      // .ariadne/staged/<runId>/{before,after}/<path> + manifest.json.
      // The user reviews + applies from /runs/<id>/diff.
      const filePath = (cfg["path"] ?? "").trim();
      if (!filePath) throw new Error("edit_file: missing 'path'");
      const abs = safeResolveUnderRoot(workspace.rootPath, filePath);
      if (!abs) throw new Error("Path traversal not allowed");

      const existing = fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : null;
      const hasContent = typeof cfg["content"] === "string";
      const hasSearch = typeof cfg["search"] === "string" && cfg["search"].length > 0;

      let proposed: string;
      let action: "create" | "modify" | "replace";

      if (hasContent) {
        // Full rewrite — the model produced the whole desired body.
        proposed = cfg["content"]!;
        action = existing === null ? "create" : "replace";
      } else if (hasSearch) {
        // Search/replace — robust to formatting drift since it
        // matches on string content rather than line numbers.
        if (existing === null) {
          throw new Error(`edit_file: file does not exist for search/replace: ${filePath}`);
        }
        const search = cfg["search"]!;
        const replace = cfg["replace"] ?? "";
        const expected = cfg["require_match_count"]
          ? parseInt(cfg["require_match_count"], 10)
          : null;

        // Count non-overlapping matches first so we can reject ambiguous edits
        // (e.g. `search="x"` matching 14 places when only one was intended).
        let count = 0;
        let from = 0;
        while (true) {
          const idx = existing.indexOf(search, from);
          if (idx === -1) break;
          count++;
          from = idx + search.length;
        }
        if (count === 0) {
          throw new Error(`edit_file: search string not found in ${filePath}`);
        }
        if (expected !== null && !isNaN(expected) && count !== expected) {
          throw new Error(
            `edit_file: search matched ${count.toString()} times in ${filePath}, expected ${expected.toString()}`,
          );
        }
        proposed = existing.split(search).join(replace);
        action = "modify";
      } else {
        throw new Error("edit_file: requires 'content' or 'search'");
      }

      // No-op detection — if the edit is a wash, refuse rather than stage
      // an empty diff so the diff view never lists trivial entries.
      if (existing !== null && proposed === existing) {
        throw new Error(`edit_file: proposed change is identical to current file: ${filePath}`);
      }

      const { stageEdit } = await import("../services/stagedEdits.js");
      const stats = await stageEdit({
        runId,
        workspace,
        path: filePath,
        action,
        before: existing,
        after: proposed,
      });
      return `Staged ${action} for ${filePath} (+${stats.added.toString()}/-${stats.removed.toString()})`;
    }

    case "run_tests": {
      // Thin wrapper over a shell exec, with a known success/failure
      // semantics so a re-plan loop can branch on the exit code.
      const command = (cfg["command"] ?? "").trim();
      if (!command) throw new Error("run_tests: missing 'command'");
      const timeoutSec = parseInt(cfg["timeout_seconds"] ?? "120", 10);
      const ms = isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec * 1000 : 120_000;

      const { spawn } = await import("node:child_process");
      return await new Promise<string>((resolve) => {
        let stdout = "";
        let stderr = "";
        const proc = spawn("/bin/sh", ["-c", command], {
          cwd: workspace.rootPath,
          env: scriptEnv(),
        });
        const timer = setTimeout(() => proc.kill("SIGTERM"), ms);
        proc.stdout.on("data", (c: Buffer) => { stdout += c.toString("utf-8"); });
        proc.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf-8"); });
        proc.on("close", (code) => {
          clearTimeout(timer);
          const passed = code === 0;
          // Slice generously but stay under the per-block output cap so
          // the next ask_ai block isn't drowned in test logs.
          const stdoutClipped = stdout.slice(-Math.floor(OUTPUT_CAP / 2));
          const stderrClipped = stderr.slice(-1000);
          const head = passed
            ? `✓ Tests passed (exit 0, command: \`${command}\`)`
            : `✗ Tests failed (exit ${(code ?? "?").toString()}, command: \`${command}\`)`;
          const parts = [head];
          if (stdoutClipped.trim()) parts.push("\n--- stdout (tail) ---\n" + stdoutClipped);
          if (stderrClipped.trim()) parts.push("\n--- stderr (tail) ---\n" + stderrClipped);
          resolve(parts.join(""));
        });
        proc.on("error", (e) => {
          clearTimeout(timer);
          resolve(`[run_tests error: ${e.message}]`);
        });
      });
    }

    default: {
      const exhaustive: never = block.type;
      throw new Error(`Unknown block type: ${String(exhaustive)}`);
    }
  }
}
