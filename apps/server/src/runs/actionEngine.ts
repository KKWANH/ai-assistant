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
      const output = await runBlock(block, priorOutput, workspace, provider);
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
  logger.info({ runId, blocks: action.blocks.length }, "action run completed");
}

/** Execute one block. Throws on failure (the pipeline stops fail-fast). */
async function runBlock(
  block: ActionBlock,
  priorOutput: string,
  workspace: Workspace,
  provider: AiProvider,
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
      const root = path.resolve(workspace.rootPath);
      const resolved = path.resolve(root, filePath);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new Error("Path traversal not allowed");
      }
      if (!fs.existsSync(resolved)) throw new Error(`File not found: ${filePath}`);
      return fs.readFileSync(resolved, "utf-8").slice(0, OUTPUT_CAP);
    }

    default: {
      const exhaustive: never = block.type;
      throw new Error(`Unknown block type: ${String(exhaustive)}`);
    }
  }
}
