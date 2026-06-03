import crypto from "node:crypto";
import path from "node:path";
import type {
  Run,
  TraceEvent,
  RunPhase,
  ContextPick,
  ContextFile,
  RunArtifacts,
  Workspace,
  Template,
  Settings,
} from "@ariadne/shared";
import { costOf } from "@ariadne/shared";
import { dbGetRun, dbInsertRun, dbUpdateRun, dbGetLatestSnapshot, dbGetEvidencePack, dbInsertClaims, dbListRuns, dbGetWorkspace, dbInsertUsageEvent, dbGetRunUsage } from "../db/repo.js";
import { scanWorkspace } from "../workspace/scanner.js";
import { buildManifest, selectCandidates, focusedRead } from "../gasp/filter.js";
import { getTemplate } from "./templates.js";
import { extractAndMapClaims, renderUnsupportedClaims, buildEvidencePack, computeRunDiff, renderDiff } from "./evidence.js";
import { writeArtifact, writeEvidence, writeRunRecord, readArtifact } from "../ariadneFolder.js";
import type { AiProvider } from "../providers/index.js";
import { getProvider } from "../providers/index.js";
import { createAlert } from "../services/alerts.js";
import { getActiveSettings } from "../config.js";
import logger from "../logger.js";
import type { Snapshot } from "@ariadne/shared";

// ---------------------------------------------------------------------------
// Metering decorator
// ---------------------------------------------------------------------------

/**
 * Wraps a provider so every `complete()` call records a usage_events row.
 * `model` is passed separately because it lives on Settings, not AiProvider.
 */
export function meteringProvider(inner: AiProvider, runId: string, model: string): AiProvider {
  const recordUsage = (usage: import("../providers/index.js").ProviderUsage) => {
    const { inputTokens, outputTokens } = usage;
    const costUsd = costOf(model, inputTokens, outputTokens);
    try {
      dbInsertUsageEvent({
        id: crypto.randomUUID(),
        runId,
        provider: inner.id,
        model,
        inputTokens,
        outputTokens,
        costUsd,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn({ runId, err }, "Failed to insert usage_event");
    }
  };

  const wrapped: AiProvider = {
    id: inner.id,
    async complete(req) {
      const result = await inner.complete(req);
      if (result.usage) recordUsage(result.usage);
      return result;
    },
    async completeStream(req, onDelta, onStatus) {
      const result = await inner.completeStream(req, onDelta, onStatus);
      if (result.usage) recordUsage(result.usage);
      return result;
    },
  };

  // Pass through completeWithImages if the underlying provider supports it
  if (inner.completeWithImages) {
    const innerVision = inner.completeWithImages.bind(inner);
    wrapped.completeWithImages = async (req) => {
      const result = await innerVision(req);
      if (result.usage) recordUsage(result.usage);
      return result;
    };
  }

  return wrapped;
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

export function makeDateRunId(existing: Run[]): string {
  const today = new Date().toISOString().slice(0, 10); // 2026-05-20
  const todayRuns = existing.filter((r) => r.id.startsWith(today));
  const seq = String(todayRuns.length + 1).padStart(3, "0");
  return `${today}-${seq}`;
}

// ---------------------------------------------------------------------------
// Trace helpers
// ---------------------------------------------------------------------------

export function traceEvent(phase: RunPhase, status: TraceEvent["status"], label: string, details?: string): TraceEvent {
  return { timestamp: new Date().toISOString(), phase, status, label, details };
}

export function appendTrace(run: Run, event: TraceEvent): void {
  run.trace = [...run.trace, event];
  dbUpdateRun(run.id, { trace: run.trace });
}

export function failRun(run: Run, phase: RunPhase, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  appendTrace(run, traceEvent(phase, "failed", `${phase} failed`, msg));
  dbUpdateRun(run.id, { status: "failed", error: msg, completedAt: new Date().toISOString() });
  logger.error({ runId: run.id, phase, error: msg }, "run failed");
}

// ---------------------------------------------------------------------------
// Phase 1: createRun  (POST /api/runs)
// ---------------------------------------------------------------------------

export async function createRun(input: {
  workspaceId: string;
  templateId: string;
  input: Record<string, string>;
  createdBy?: string | null;
}): Promise<Run> {
  const workspace = dbGetWorkspace(input.workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${input.workspaceId}`);

  const template = getTemplate(input.templateId);
  if (!template) throw new Error(`Template not found: ${input.templateId}`);

  const settings = getActiveSettings();
  // Load all workspace runs once: used for both the date-based ID counter
  // (which needs a global count) and the previous-run lookup.
  const allRuns = dbListRuns();
  const runId = makeDateRunId(allRuns);
  const workspaceRuns = allRuns.filter((r) => r.workspaceId === input.workspaceId);
  const previousRun = workspaceRuns.find((r) => r.templateId === input.templateId) ?? null;

  const run: Run = {
    id: runId,
    kind: "template",
    workspaceId: input.workspaceId,
    templateId: input.templateId,
    templateName: template.name,
    status: "created",
    input: input.input,
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
    previousRunId: previousRun?.id ?? null,
    error: null,
    createdBy: input.createdBy ?? null,
    createdByName: null, // will be populated by JOIN when read back
    usage: null,
    blockResults: [],
  };

  dbInsertRun(run);

  // Run async — do not await
  void runPhaseOne(run.id, workspace, template, settings).catch((err) => {
    logger.error({ runId: run.id, err }, "Unhandled error in runPhaseOne");
  });

  return run;
}

async function runPhaseOne(
  runId: string,
  workspace: Workspace,
  template: Template,
  settings: Settings
): Promise<void> {
  const run = dbGetRun(runId);
  if (!run) return;

  run.startedAt = new Date().toISOString();
  dbUpdateRun(runId, { status: "scanning", startedAt: run.startedAt });

  let provider: AiProvider;
  try {
    const rawProvider = await getProvider(settings);
    provider = meteringProvider(rawProvider, runId, settings.model);
  } catch (err) {
    failRun(run, "scan", err);
    return;
  }

  // --- scan ---
  let snapshot: Snapshot;
  appendTrace(run, traceEvent("scan", "running", "Scanning workspace"));
  try {
    snapshot = await scanWorkspace(workspace);
    appendTrace(run, traceEvent("scan", "ok", `Scanned ${snapshot.fileCount.toString()} files`));
  } catch (err) {
    failRun(run, "scan", err);
    return;
  }

  // --- manifest ---
  appendTrace(run, traceEvent("manifest", "running", "Building manifest"));
  const manifest = buildManifest(snapshot);
  appendTrace(run, traceEvent("manifest", "ok", `Manifest: ${manifest.files.length.toString()} entries`));

  // --- candidate select ---
  appendTrace(run, traceEvent("candidate_select", "running", "Asking provider to select candidates"));
  const snapshotFiles = new Map(snapshot.files.map((f) => [f.path, f]));
  let candidates: string[] = [];
  let reasonMap = new Map<string, string>();
  try {
    const results = await selectCandidates(manifest, template, run.input, provider);
    // Drop any path the provider invented that is not actually in the snapshot.
    const valid = results.filter((r) => snapshotFiles.has(r.path));
    candidates = valid.map((r) => r.path);
    reasonMap = new Map(valid.map((r) => [r.path, r.reason]));
    run.candidateFiles = candidates;
    dbUpdateRun(runId, { candidateFiles: candidates });
    appendTrace(run, traceEvent("candidate_select", "ok", `${candidates.length.toString()} candidates selected`));
  } catch (err) {
    failRun(run, "candidate_select", err);
    return;
  }

  // Build ContextPick object (stored in the run's snapshot context)
  const contextFiles: ContextFile[] = candidates.map((p) => {
    const meta = snapshotFiles.get(p);
    return {
      path: p,
      reason: reasonMap.get(p) ?? "Selected from manifest metadata",
      estimatedTokens: meta?.estimatedTokens ?? 0,
      sensitive: meta?.sensitive ?? false,
      oversized: (meta?.estimatedTokens ?? 0) > 8000,
      included: true,
    };
  });

  // Store context pick as artifact
  const contextPick: ContextPick = {
    runId,
    files: contextFiles,
    totalTokens: contextFiles.reduce((a, f) => a + f.estimatedTokens, 0),
    skippedLarge: contextFiles.filter((f) => f.oversized).map((f) => f.path),
  };
  try {
    writeRunRecord(workspace.rootPath, `${runId}-context.json`, contextPick);
  } catch {
    // non-fatal
  }

  run.tokenEstimate = contextPick.totalTokens;
  dbUpdateRun(runId, { status: "context_pick", tokenEstimate: contextPick.totalTokens });
  logger.info({ runId, candidates: candidates.length }, "run waiting at context_pick");
}

// ---------------------------------------------------------------------------
// Phase 2: confirmContext  (POST /api/runs/:id/context)
// ---------------------------------------------------------------------------

export async function confirmContext(runId: string, selectedFiles: string[]): Promise<Run> {
  const run = dbGetRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (run.status !== "context_pick") {
    throw new Error(`Run ${runId} is not at context_pick (status: ${run.status})`);
  }

  run.selectedFiles = selectedFiles;
  dbUpdateRun(runId, { status: "generating", selectedFiles });
  appendTrace(run, traceEvent("context_approved", "ok", `${selectedFiles.length.toString()} files approved by user`));

  // Run async
  void runPhaseTwo(run.id).catch((err) => {
    logger.error({ runId: run.id, err }, "Unhandled error in runPhaseTwo");
  });

  return dbGetRun(runId) ?? run;
}

async function runPhaseTwo(runId: string): Promise<void> {
  const run = dbGetRun(runId);
  if (!run) return;

  const workspace = dbGetWorkspace(run.workspaceId);
  if (!workspace) { failRun(run, "focused_read", new Error("Workspace not found")); return; }

  const template = getTemplate(run.templateId);
  if (!template) { failRun(run, "focused_read", new Error("Template not found")); return; }

  const settings = getActiveSettings();
  let provider: AiProvider;
  try {
    const rawProvider = await getProvider(settings);
    provider = meteringProvider(rawProvider, runId, settings.model);
  } catch (err) {
    failRun(run, "focused_read", err);
    return;
  }

  // --- focused read ---
  appendTrace(run, traceEvent("focused_read", "running", "Reading selected files"));
  const snapshot = dbGetLatestSnapshot(run.workspaceId);
  const focusedFiles = await focusedRead(workspace.rootPath, run.selectedFiles, snapshot ?? {
    id: "", workspaceId: run.workspaceId, createdAt: "", fileCount: 0, ignoredCount: 0,
    sensitiveCount: 0, totalEstimatedTokens: 0, files: [],
  }, provider);
  appendTrace(run, traceEvent("focused_read", "ok", `Read ${focusedFiles.length.toString()} files`));

  // --- brief generation ---
  appendTrace(run, traceEvent("brief", "running", "Generating brief"));
  const fileContext = focusedFiles.map((f) => `## ${f.path}\n${f.content}`).join("\n\n---\n\n");

  const system = `You are a research and analysis assistant for Ariadne.
Generate a structured "${template.name}" brief using ONLY the provided source files.
Follow the output contract sections: ${template.outputContract.sections.join(", ")}.
Use Markdown. Cite sources inline. Flag claims that lack direct support.
${template.promptHint ?? ""}`;

  const prompt = `User input: ${JSON.stringify(run.input, null, 2)}

Source files:
${fileContext}`;

  let brief: string;
  try {
    const { text } = await provider.complete({ system, prompt });
    brief = text;
    appendTrace(run, traceEvent("brief", "ok", "Brief generated"));
  } catch (err) {
    failRun(run, "brief", err);
    return;
  }

  // --- claims extraction ---
  appendTrace(run, traceEvent("claims", "running", "Extracting claims"));
  let claims;
  try {
    claims = await extractAndMapClaims(runId, brief, focusedFiles, provider);
    dbInsertClaims(claims);
    appendTrace(run, traceEvent("claims", "ok", `${claims.length.toString()} claims extracted`));
  } catch (err) {
    failRun(run, "claims", err);
    return;
  }

  // --- evidence map ---
  appendTrace(run, traceEvent("evidence", "running", "Building evidence pack"));
  const evidencePack = buildEvidencePack(runId, claims);
  appendTrace(run, traceEvent("evidence", "ok", `Evidence pack ready`));

  // --- unsupported ---
  appendTrace(run, traceEvent("unsupported", "running", "Rendering unsupported claims"));
  const unsupportedMd = renderUnsupportedClaims(claims);
  const unsupportedCount = claims.filter((c) => c.status === "unsupported").length;
  appendTrace(run, traceEvent("unsupported", "ok", `${unsupportedCount.toString()} unsupported`));

  // --- diff ---
  let diffMd: string | null = null;
  if (run.previousRunId) {
    appendTrace(run, traceEvent("diff", "running", "Computing re-run diff"));
    try {
      const prevPack = dbGetEvidencePack(run.previousRunId);
      const prevRun = dbGetRun(run.previousRunId);
      const diff = await computeRunDiff(
        runId,
        run.previousRunId,
        claims,
        prevPack.claims,
        run.selectedFiles,
        prevRun?.selectedFiles ?? [],
        provider
      );
      diffMd = renderDiff(diff);
      appendTrace(run, traceEvent("diff", "ok", "Diff complete"));
    } catch (err) {
      appendTrace(run, traceEvent("diff", "failed", "Diff failed (non-fatal)", String(err)));
    }
  }

  // --- write artifacts ---
  appendTrace(run, traceEvent("artifacts", "running", "Writing artifacts"));
  const artifacts: RunArtifacts = {};
  const datePrefix = runId;

  try {
    artifacts.brief = writeArtifact(workspace.rootPath, `${datePrefix}-brief.md`, brief);
    artifacts.evidence = writeEvidence(workspace.rootPath, `${datePrefix}-evidence.json`, evidencePack);
    artifacts.unsupported = writeArtifact(workspace.rootPath, `${datePrefix}-unsupported-claims.md`, unsupportedMd);
    if (diffMd) {
      artifacts.diff = writeArtifact(workspace.rootPath, `${datePrefix}-diff-from-last-run.md`, diffMd);
    }
    writeRunRecord(workspace.rootPath, `${datePrefix}-run.json`, run);
  } catch (err) {
    failRun(run, "artifacts", err);
    return;
  }

  appendTrace(run, traceEvent("artifacts", "ok", "Artifacts written"));

  // Compute and persist aggregated usage for this run
  const runUsage = dbGetRunUsage(runId);
  const usageToStore = (runUsage.inputTokens > 0 || runUsage.outputTokens > 0) ? runUsage : null;

  dbUpdateRun(runId, {
    status: "completed",
    completedAt: new Date().toISOString(),
    artifacts,
    evidenceCount: claims.length,
    unsupportedCount,
    usage: usageToStore,
  });

  // Surface the finished run in the owner's alert inbox (the bell). Best-effort.
  createAlert(run.createdBy, "run_completed", `${run.templateName} finished`, null, `/runs/${run.id}`);

  // Auto-version the run's .ariadne/ artifacts. Background — never
  // blocks the completed response and silently no-ops when git is
  // unavailable on the host.
  setImmediate(() => {
    void (async () => {
      try {
        const { commitWorkspaceHistory } = await import("../services/workspaceGit.js");
        await commitWorkspaceHistory(
          workspace.rootPath,
          `run: ${runId} (completed)`,
        );
      } catch (err) {
        logger.debug({ runId, err }, "workspaceGit commit threw");
      }
    })();
  });

  logger.info({ runId, usage: usageToStore }, "run completed");
}

// ---------------------------------------------------------------------------
// Read-only helpers used by routes
// ---------------------------------------------------------------------------

export function getContextPick(run: Run, snapshot: Snapshot | null): ContextPick {
  // Prefer the persisted context record — it keeps the AI's per-file reasons.
  const workspace = dbGetWorkspace(run.workspaceId);
  if (workspace) {
    try {
      const raw = readArtifact(
        workspace.rootPath,
        path.join(".ariadne", "runs", `${run.id}-context.json`)
      );
      const stored = JSON.parse(raw) as ContextPick;
      const files = stored.files.map((f) => ({
        ...f,
        included:
          run.status === "context_pick" ? f.included : run.selectedFiles.includes(f.path),
      }));
      return { ...stored, files };
    } catch {
      // fall through and recompute from the snapshot
    }
  }

  const snapshotFiles = new Map((snapshot?.files ?? []).map((f) => [f.path, f]));
  const files: ContextFile[] = run.candidateFiles.map((p) => {
    const meta = snapshotFiles.get(p);
    return {
      path: p,
      reason: "Selected from manifest metadata",
      estimatedTokens: meta?.estimatedTokens ?? 0,
      sensitive: meta?.sensitive ?? false,
      oversized: (meta?.estimatedTokens ?? 0) > 8000,
      included: run.selectedFiles.includes(p),
    };
  });
  return {
    runId: run.id,
    files,
    totalTokens: files.reduce((a, f) => a + f.estimatedTokens, 0),
    skippedLarge: files.filter((f) => f.oversized).map((f) => f.path),
  };
}
