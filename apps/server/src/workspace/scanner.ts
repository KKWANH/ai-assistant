import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { DEFAULT_INCLUDE, DEFAULT_EXCLUDE } from "@ariadne/shared";
import type { Workspace, Snapshot, FileMeta } from "@ariadne/shared";
import { buildFileMeta } from "./metadata.js";
import { getDb } from "../db/index.js";
import { dbInsertSnapshot, dbUpsertFileIndex } from "../db/repo.js";
import { ensureAriadneFolder, writeSnapshot } from "../ariadneFolder.js";

/** Walk the directory tree and return all absolute file paths. */
function walk(dir: string, results: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue; // skip symlinks for safety
    if (entry.isDirectory()) {
      walk(full, results);
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

function makeRunId(): string {
  const date = new Date().toISOString().slice(0, 10); // 2026-05-20
  return `${date}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Build a Snapshot from a Workspace and persist it. */
export async function scanWorkspace(workspace: Workspace): Promise<Snapshot> {
  ensureAriadneFolder(workspace.rootPath);

  const include = workspace.include.length > 0 ? workspace.include : DEFAULT_INCLUDE;
  const exclude = [...(workspace.exclude.length > 0 ? workspace.exclude : []), ...DEFAULT_EXCLUDE];

  const isIncluded = picomatch(include, { dot: false });
  const isExcluded = picomatch(exclude, { dot: true });

  const allPaths = walk(workspace.rootPath);

  const files: FileMeta[] = [];
  let ignoredCount = 0;

  for (const absPath of allPaths) {
    const relPath = path.relative(workspace.rootPath, absPath).split(path.sep).join("/");

    if (isExcluded(relPath)) {
      ignoredCount++;
      continue;
    }
    if (!isIncluded(relPath)) {
      ignoredCount++;
      continue;
    }

    try {
      const meta = await buildFileMeta(absPath, relPath);
      files.push(meta);
    } catch {
      ignoredCount++;
    }
  }

  const sensitiveCount = files.filter((f) => f.sensitive).length;
  const totalEstimatedTokens = files.reduce((acc, f) => acc + f.estimatedTokens, 0);

  const snapshot: Snapshot = {
    id: makeRunId(),
    workspaceId: workspace.id,
    createdAt: new Date().toISOString(),
    fileCount: files.length,
    ignoredCount,
    sensitiveCount,
    totalEstimatedTokens,
    files,
  };

  // Persist to DB
  dbInsertSnapshot(snapshot);

  // Persist to .ariadne/snapshots/
  writeSnapshot(workspace.rootPath, `${snapshot.id}.json`, snapshot);

  // Update FTS index
  const db = getDb();
  for (const f of files) {
    const headings = f.headings?.join(" ") ?? "";
    dbUpsertFileIndex(db, workspace.id, f.path, headings);
  }

  return snapshot;
}
