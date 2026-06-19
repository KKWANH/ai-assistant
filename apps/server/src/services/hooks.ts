/**
 * Workspace hook runner.
 *
 * Reads `.ariadne/hooks.yaml`, fires the matching subset on a named
 * event, captures stdout/stderr per hook to `.ariadne/hooks/<id>.log`,
 * returns a summary the caller can broadcast / store. Failures never
 * throw — a wedged hook command can't take down the request that
 * triggered the event.
 *
 * The YAML shape is intentionally minimal:
 *
 *   hooks:
 *     - id: typecheck-on-apply
 *       event: staged_apply
 *       command: npm run typecheck
 *       timeoutMs: 60000      # optional, default 30s, max 5m
 *       enabled: true         # optional, default true
 *
 * The runner spawns through the user's shell so `&&`, `|`, `cd` etc.
 * work as written. Hooks inherit the supervisor's PATH so users can
 * call workspace-local binaries (e.g. `./node_modules/.bin/foo`)
 * without absolute paths.
 *
 * Security: hook EDITING is gated by routes/workspaces.ts at the
 * route layer (local-only). Hook EXECUTION fires regardless of who
 * triggered the source event — the user wrote the command, they want
 * it to run.
 */
import { spawn } from "node:child_process";
import yaml from "yaml";
import type { HookEvent, WorkspaceHook, HookRunSummary } from "@ariadne/shared";
import { HOOK_EVENTS } from "@ariadne/shared";
import { appendHookLog, readHooksYaml } from "../ariadneFolder.js";
import { scriptEnv } from "./scriptEnv.js";
import logger from "../logger.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;

interface HookFile {
  hooks?: unknown[];
}

/** Parse `.ariadne/hooks.yaml`. Bad YAML returns an empty list rather
 *  than throwing — chat/scan flows shouldn't fail because the hook
 *  file is mid-edit. */
export function loadHooks(workspaceRoot: string): WorkspaceHook[] {
  const raw = readHooksYaml(workspaceRoot);
  if (!raw) return [];
  let parsed: HookFile | null;
  try {
    parsed = yaml.parse(raw) as HookFile | null;
  } catch {
    return [];
  }
  const rows = parsed?.hooks;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is Partial<WorkspaceHook> & Record<string, unknown> =>
      typeof row === "object" && row !== null,
    )
    .map((row) => normaliseHook(row))
    .filter((h): h is WorkspaceHook => h !== null);
}

function normaliseHook(raw: Partial<WorkspaceHook> & Record<string, unknown>): WorkspaceHook | null {
  const id = typeof raw["id"] === "string" ? raw["id"].trim() : "";
  const event = raw["event"] as HookEvent | undefined;
  const command = typeof raw["command"] === "string" ? raw["command"].trim() : "";
  if (!id || !command || !event || !HOOK_EVENTS.includes(event)) return null;
  const timeoutRaw = raw["timeoutMs"];
  const timeoutMs =
    typeof timeoutRaw === "number" && timeoutRaw > 0
      ? Math.min(timeoutRaw, MAX_TIMEOUT_MS)
      : undefined;
  const enabledRaw = raw["enabled"];
  const enabled = enabledRaw === undefined ? true : Boolean(enabledRaw);
  const hook: WorkspaceHook = { id, event, command, enabled };
  if (timeoutMs !== undefined) hook.timeoutMs = timeoutMs;
  return hook;
}

/** Fire every enabled hook matching `event`. Each hook is awaited
 *  sequentially to keep the log file's interleave deterministic —
 *  parallel runs hide which hook produced which line. */
export async function fireHooks(
  event: HookEvent,
  workspaceRoot: string,
  payload?: Record<string, unknown>,
): Promise<HookRunSummary[]> {
  const all = loadHooks(workspaceRoot);
  const matching = all.filter((h) => h.event === event && h.enabled);
  if (matching.length === 0) return [];
  const summaries: HookRunSummary[] = [];
  for (const hook of matching) {
    const summary = await runOne(hook, workspaceRoot, payload);
    summaries.push(summary);
  }
  return summaries;
}

function runOne(
  hook: WorkspaceHook,
  workspaceRoot: string,
  payload?: Record<string, unknown>,
): Promise<HookRunSummary> {
  return new Promise<HookRunSummary>((resolve) => {
    const startedAt = new Date();
    const t0 = startedAt.getTime();
    const timeoutMs = hook.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Shell-based spawn so users can write idiomatic command lines.
    // cwd is the workspace root — hooks operate on user files, not
    // Ariadne internals. Env is augmented with ARIADNE_EVENT and
    // ARIADNE_PAYLOAD for hooks that want to branch on details.
    // scriptEnv() strips API keys/secrets so a hook command can't read the
    // provider keys out of its own environment.
    const env: NodeJS.ProcessEnv = {
      ...scriptEnv(),
      ARIADNE_EVENT: hook.event,
    };
    if (payload) {
      try {
        env.ARIADNE_PAYLOAD = JSON.stringify(payload);
      } catch {
        // payload should always be serialisable; ignore on the off chance.
      }
    }

    const banner =
      `\n— ${startedAt.toISOString()} · event=${hook.event} · command=${hook.command} —\n`;
    appendHookLog(workspaceRoot, hook.id, banner);

    const proc = spawn(hook.command, {
      shell: true,
      cwd: workspaceRoot,
      env,
    });

    let tail = "";
    const captureTail = (chunk: Buffer): void => {
      const text = chunk.toString("utf-8");
      tail = (tail + text).slice(-2_000);
      appendHookLog(workspaceRoot, hook.id, text);
    };
    proc.stdout.on("data", captureTail);
    proc.stderr.on("data", captureTail);

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      const note = `\n[ariadne] hook timed out after ${timeoutMs.toString()}ms; SIGTERM sent\n`;
      tail = (tail + note).slice(-2_000);
      appendHookLog(workspaceRoot, hook.id, note);
    }, timeoutMs);

    const finalise = (exitCode: number | null): void => {
      clearTimeout(timer);
      const durationMs = Date.now() - t0;
      const footer = `\n[ariadne] exit=${exitCode === null ? "n/a" : exitCode.toString()} duration=${durationMs.toString()}ms\n`;
      appendHookLog(workspaceRoot, hook.id, footer);
      resolve({
        hookId: hook.id,
        event: hook.event,
        startedAt: startedAt.toISOString(),
        durationMs,
        exitCode,
        outputTail: tail,
      });
    };

    proc.on("close", (code) => {
      finalise(code);
    });
    proc.on("error", (err) => {
      const errMsg = `\n[ariadne] spawn error: ${err.message}\n`;
      tail = (tail + errMsg).slice(-2_000);
      appendHookLog(workspaceRoot, hook.id, errMsg);
      finalise(null);
    });
  });
}

/** Fire-and-forget variant used by request handlers that shouldn't
 *  block on hook execution (e.g. /scan, /memory POST). Errors are
 *  logged via pino and otherwise discarded. */
export function fireHooksDetached(
  event: HookEvent,
  workspaceRoot: string,
  payload?: Record<string, unknown>,
): void {
  void fireHooks(event, workspaceRoot, payload).catch((err: unknown) => {
    logger.warn({ err, event, workspaceRoot }, "fireHooksDetached failed");
  });
}
