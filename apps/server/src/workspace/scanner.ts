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
import logger from "../logger.js";

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

  // Re-build the embedding + symbol indexes in the background. Both
  // are no-ops for trivial workspaces (no embedding model installed /
  // no source-code files), so this is safe to run unconditionally.
  setImmediate(() => {
    void (async () => {
      // First scan into Ollama-equipped machines that don't have an
      // embedding model yet → kick off a background pull. Doesn't
      // block this scan; the next one picks up the model.
      try {
        const { ensureOllamaEmbeddingModel } = await import("../providers/embedding.js");
        const started = await ensureOllamaEmbeddingModel();
        if (started) {
          logger.info(
            { workspaceId: workspace.id },
            "auto-pulling Ollama embedding model in background — next scan will use it",
          );
        }
      } catch (err) {
        logger.debug({ workspaceId: workspace.id, err }, "embedding model auto-pull check threw");
      }
      try {
        const { indexWorkspaceEmbeddings } = await import("../services/retrieval.js");
        const result = await indexWorkspaceEmbeddings(workspace.id, workspace.rootPath, files);
        if (result.indexed > 0) {
          logger.info(
            { workspaceId: workspace.id, indexed: result.indexed, provider: result.provider },
            "embedding index rebuilt",
          );
        }
      } catch (err) {
        logger.warn({ workspaceId: workspace.id, err }, "embedding indexer threw");
      }
      try {
        const { indexWorkspaceSymbols } = await import("../services/symbolIndex.js");
        const r = await indexWorkspaceSymbols(workspace.id, workspace.rootPath, files);
        if (r.symbols > 0) {
          logger.info(
            { workspaceId: workspace.id, symbols: r.symbols },
            "symbol index rebuilt",
          );
        }
      } catch (err) {
        logger.warn({ workspaceId: workspace.id, err }, "symbol indexer threw");
      }
    })();
  });

  return snapshot;
}
