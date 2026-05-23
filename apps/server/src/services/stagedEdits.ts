/**
 * Staged edits — the working-tree-without-git layer that the `edit_file`
 * block writes into and the `/runs/<id>/diff` review page reads from.
 *
 * Layout: `.ariadne/staged/<run-id>/`
 *   manifest.json           — StagedManifest (paths + actions + diffs)
 *   before/<path>           — copy of the file before the edit (skipped when action="create")
 *   after/<path>            — proposed post-edit body (skipped when action="delete")
 *
 * Applying copies `after/<path>` over the workspace file, hands the
 * commit to workspaceGit so the change lives in the workspace's
 * .ariadne/ history, then marks the manifest applied.
 *
 * Why not git plumbing directly: we want the same "stage + review"
 * primitive to work on workspaces that aren't (and may never be) git
 * repos. Plain files keep the dependency surface to fs only.
 */

import fs from "node:fs";
import path from "node:path";
import type { StagedManifest, StagedFile, Workspace } from "@ariadne/shared";
import { computeDiffOps, toUnifiedDiff, diffStats } from "./diff.js";
import { commitWorkspaceHistory } from "./workspaceGit.js";
import { dbGetWorkspace, dbGetRun } from "../db/repo.js";
import logger from "../logger.js";

function stagedRoot(workspace: Workspace, runId: string): string {
  return path.join(workspace.rootPath, ".ariadne", "staged", runId);
}

function manifestPath(workspace: Workspace, runId: string): string {
  return path.join(stagedRoot(workspace, runId), "manifest.json");
}

function readManifest(workspace: Workspace, runId: string): StagedManifest | null {
  const p = manifestPath(workspace, runId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as StagedManifest;
  } catch (err) {
    logger.warn({ runId, err }, "Failed to parse staged manifest");
    return null;
  }
}

function writeManifest(workspace: Workspace, manifest: StagedManifest): void {
  const p = manifestPath(workspace, manifest.runId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2), "utf-8");
}

// ── Stage / list / read ─────────────────────────────────────────────────────

export interface StageEditInput {
  runId: string;
  workspace: Workspace;
  path: string;
  action: "create" | "modify" | "replace" | "delete";
  before: string | null;
  after: string | null;
}

/**
 * Stage one file change as part of a run's edit set. Multiple
 * `edit_file` blocks in a single run accumulate into the same manifest
 * (same runId) — apply happens once at the end via the diff view.
 */
export async function stageEdit(
  input: StageEditInput,
): Promise<{ added: number; removed: number }> {
  const { runId, workspace, path: filePath, action, before, after } = input;

  // Compute the diff once now; the review UI just renders this.
  const ops = computeDiffOps(before ?? "", after ?? "");
  const stats = diffStats(ops);
  const unified = toUnifiedDiff(
    `a/${filePath}`,
    `b/${filePath}`,
    ops,
  );

  const root = stagedRoot(workspace, runId);
  fs.mkdirSync(root, { recursive: true });

  if (before !== null) {
    const beforeAbs = path.join(root, "before", filePath);
    fs.mkdirSync(path.dirname(beforeAbs), { recursive: true });
    fs.writeFileSync(beforeAbs, before, "utf-8");
  }
  if (after !== null) {
    const afterAbs = path.join(root, "after", filePath);
    fs.mkdirSync(path.dirname(afterAbs), { recursive: true });
    fs.writeFileSync(afterAbs, after, "utf-8");
  }

  // Upsert into the manifest (don't dupe a file edited twice in the
  // same run — last write wins, but we keep stats from the merged diff).
  const existing = readManifest(workspace, runId);
  const manifest: StagedManifest = existing ?? {
    runId,
    workspaceId: workspace.id,
    createdAt: new Date().toISOString(),
    appliedAt: null,
    files: [],
  };

  const entry: StagedFile = {
    path: filePath,
    action,
    diff: unified,
    before,
    after,
  };
  const idx = manifest.files.findIndex((f) => f.path === filePath);
  if (idx >= 0) manifest.files[idx] = entry;
  else manifest.files.push(entry);

  writeManifest(workspace, manifest);

  return stats;
}

export function getStagedManifest(workspaceId: string, runId: string): StagedManifest | null {
  const ws = dbGetWorkspace(workspaceId);
  if (!ws) return null;
  return readManifest(ws, runId);
}

// ── Apply / discard ─────────────────────────────────────────────────────────

export interface ApplyResult {
  applied: string[];
  skipped: string[];
  errors: { path: string; reason: string }[];
  commitSha: string | null;
}

/**
 * Copy the selected file(s) from after/ into the workspace, commit the
 * result to the workspace-history git repo, mark the manifest applied,
 * and leave the staged tree on disk for forensics (deleted by discard()
 * or by a fresh run with the same id).
 */
export async function applyStagedEdits(
  workspaceId: string,
  runId: string,
  selectedPaths: string[],
): Promise<ApplyResult> {
  const ws = dbGetWorkspace(workspaceId);
  if (!ws) throw new Error("Workspace not found");
  const manifest = readManifest(ws, runId);
  if (!manifest) throw new Error("No staged edits for this run");
  if (manifest.appliedAt) throw new Error("This staged set has already been applied");

  const selected = new Set(selectedPaths);
  const result: ApplyResult = { applied: [], skipped: [], errors: [], commitSha: null };
  const root = path.resolve(ws.rootPath);

  for (const f of manifest.files) {
    if (!selected.has(f.path)) {
      result.skipped.push(f.path);
      continue;
    }
    try {
      const abs = path.resolve(root, f.path);
      // Path-traversal guard — staged paths come from the action engine
      // which already guards, but we re-check here because manifest
      // files can be edited externally.
      if (abs !== root && !abs.startsWith(root + path.sep)) {
        throw new Error("Path escapes workspace root");
      }
      if (f.action === "delete") {
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } else {
        if (f.after === null) throw new Error("Missing 'after' content");
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, f.after, "utf-8");
      }
      result.applied.push(f.path);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      result.errors.push({ path: f.path, reason });
    }
  }

  if (result.applied.length > 0) {
    // Compose a commit message that's useful in the run-history log —
    // includes the run id + action name (when known) + a short file list.
    const run = dbGetRun(runId);
    const actionTitle = run?.templateName ?? runId;
    const fileList = result.applied.length <= 3
      ? result.applied.join(", ")
      : `${result.applied.slice(0, 3).join(", ")} + ${(result.applied.length - 3).toString()} more`;
    const message = `apply: ${actionTitle} — ${fileList}`;
    try {
      result.commitSha = await commitWorkspaceHistory(ws.rootPath, message);
    } catch (err) {
      logger.warn({ runId, err }, "workspaceGit commit failed after apply");
    }
  }

  // Mark the manifest applied so the UI can render the past state
  // distinctly and a second click of Apply rejects cleanly.
  manifest.appliedAt = new Date().toISOString();
  writeManifest(ws, manifest);

  return result;
}

export function discardStagedEdits(workspaceId: string, runId: string): void {
  const ws = dbGetWorkspace(workspaceId);
  if (!ws) return;
  const root = stagedRoot(ws, runId);
  if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
