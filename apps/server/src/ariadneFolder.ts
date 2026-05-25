import fs from "node:fs";
import path from "node:path";
import { assertInsideAriadne } from "./security/pathGuard.js";

const SUB_DIRS = ["runs", "snapshots", "artifacts", "evidence", "scripts", "surface-dist"] as const;

/** Ensure the .ariadne scaffold exists under workspaceRoot. */
export function ensureAriadneFolder(workspaceRoot: string): void {
  const base = path.join(workspaceRoot, ".ariadne");
  fs.mkdirSync(base, { recursive: true });

  for (const dir of SUB_DIRS) {
    fs.mkdirSync(path.join(base, dir), { recursive: true });
  }

  const yamlPath = path.join(base, "workspace.yaml");
  if (!fs.existsSync(yamlPath)) {
    fs.writeFileSync(
      yamlPath,
      `# Ariadne workspace configuration\n# Edit include/exclude globs in the Ariadne UI.\n`,
      "utf-8"
    );
  }
}

/** Returns the absolute path to the scripts directory for a workspace. */
export function scriptsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".ariadne", "scripts");
}

/** Write a script file into .ariadne/scripts/. */
export function writeScript(workspaceRoot: string, filename: string, content: string): void {
  const dest = path.join(workspaceRoot, ".ariadne", "scripts", filename);
  assertInsideAriadne(workspaceRoot, dest);
  fs.writeFileSync(dest, content, "utf-8");
}

/** Write a text artifact (brief, unsupported, diff) into .ariadne/artifacts/. */
export function writeArtifact(workspaceRoot: string, filename: string, content: string): string {
  const dest = path.join(workspaceRoot, ".ariadne", "artifacts", filename);
  assertInsideAriadne(workspaceRoot, dest);
  fs.writeFileSync(dest, content, "utf-8");
  return path.join(".ariadne", "artifacts", filename);
}

/** Write a JSON evidence file into .ariadne/evidence/. */
export function writeEvidence(workspaceRoot: string, filename: string, content: unknown): string {
  const dest = path.join(workspaceRoot, ".ariadne", "evidence", filename);
  assertInsideAriadne(workspaceRoot, dest);
  fs.writeFileSync(dest, JSON.stringify(content, null, 2), "utf-8");
  return path.join(".ariadne", "evidence", filename);
}

/** Write a snapshot JSON into .ariadne/snapshots/. */
export function writeSnapshot(workspaceRoot: string, filename: string, content: unknown): string {
  const dest = path.join(workspaceRoot, ".ariadne", "snapshots", filename);
  assertInsideAriadne(workspaceRoot, dest);
  fs.writeFileSync(dest, JSON.stringify(content, null, 2), "utf-8");
  return path.join(".ariadne", "snapshots", filename);
}

/** Write a run JSON into .ariadne/runs/. */
export function writeRunRecord(workspaceRoot: string, filename: string, content: unknown): string {
  const dest = path.join(workspaceRoot, ".ariadne", "runs", filename);
  assertInsideAriadne(workspaceRoot, dest);
  fs.writeFileSync(dest, JSON.stringify(content, null, 2), "utf-8");
  return path.join(".ariadne", "runs", filename);
}

/** Read an artifact file by its relative path (inside workspaceRoot). */
export function readArtifact(workspaceRoot: string, relPath: string): string {
  const dest = path.join(workspaceRoot, relPath);
  assertInsideAriadne(workspaceRoot, dest);
  return fs.readFileSync(dest, "utf-8");
}

// ---------------------------------------------------------------------------
// Surface helpers (.ariadne/surface.tsx + .ariadne/surface-dist/)
// ---------------------------------------------------------------------------

const SURFACE_TSX = ".ariadne/surface.tsx";
const SURFACE_BUNDLE = ".ariadne/surface-dist/bundle.js";

/** Read the surface source (.ariadne/surface.tsx) if it exists; returns null otherwise. */
export function readSurface(workspaceRoot: string): string | null {
  const dest = path.join(workspaceRoot, SURFACE_TSX);
  const resolved = path.resolve(dest);
  assertInsideAriadne(workspaceRoot, resolved);
  if (!fs.existsSync(resolved)) return null;
  return fs.readFileSync(resolved, "utf-8");
}

/** Write the surface source to .ariadne/surface.tsx. */
export function writeSurface(workspaceRoot: string, source: string): void {
  const dest = path.resolve(path.join(workspaceRoot, SURFACE_TSX));
  assertInsideAriadne(workspaceRoot, dest);
  fs.writeFileSync(dest, source, "utf-8");
}

/** Returns the absolute path to the built bundle, or null if it doesn't exist. */
export function surfaceBundlePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, SURFACE_BUNDLE);
}

/** Returns the absolute path to the surface TSX source. */
export function surfaceTsxPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, SURFACE_TSX);
}

// ---------------------------------------------------------------------------
// Actions helpers (.ariadne/actions.yaml)
// ---------------------------------------------------------------------------

const ACTIONS_YAML = ".ariadne/actions.yaml";

/** Returns the absolute path to the actions YAML file. */
export function actionsYamlPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ACTIONS_YAML);
}

/** Read .ariadne/actions.yaml source; returns null if the file does not exist. */
export function readActionsYaml(workspaceRoot: string): string | null {
  const dest = path.resolve(path.join(workspaceRoot, ACTIONS_YAML));
  assertInsideAriadne(workspaceRoot, dest);
  if (!fs.existsSync(dest)) return null;
  return fs.readFileSync(dest, "utf-8");
}

/** Write a new YAML source to .ariadne/actions.yaml. */
export function writeActionsYaml(workspaceRoot: string, source: string): void {
  const dest = path.resolve(path.join(workspaceRoot, ACTIONS_YAML));
  assertInsideAriadne(workspaceRoot, dest);
  fs.writeFileSync(dest, source, "utf-8");
}

// ---------------------------------------------------------------------------
// Workspace hooks (.ariadne/hooks.yaml + .ariadne/hooks/*.log)
// ---------------------------------------------------------------------------

const HOOKS_YAML = ".ariadne/hooks.yaml";
const HOOKS_LOG_DIR = ".ariadne/hooks";

export function hooksYamlPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, HOOKS_YAML);
}

export function hooksLogDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, HOOKS_LOG_DIR);
}

export function readHooksYaml(workspaceRoot: string): string | null {
  const dest = path.resolve(path.join(workspaceRoot, HOOKS_YAML));
  assertInsideAriadne(workspaceRoot, dest);
  if (!fs.existsSync(dest)) return null;
  return fs.readFileSync(dest, "utf-8");
}

export function writeHooksYaml(workspaceRoot: string, source: string): void {
  const dest = path.resolve(path.join(workspaceRoot, HOOKS_YAML));
  assertInsideAriadne(workspaceRoot, dest);
  fs.writeFileSync(dest, source, "utf-8");
}

/** Append one log line to .ariadne/hooks/<hookId>.log. Caller-owned
 *  format. Used by the hook runner to record each invocation. */
export function appendHookLog(workspaceRoot: string, hookId: string, line: string): void {
  const dir = path.resolve(hooksLogDir(workspaceRoot));
  assertInsideAriadne(workspaceRoot, dir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${hookId}.log`);
  fs.appendFileSync(file, line, "utf-8");
}

/** Read the tail of a hook's log, capped at ~8 KB. Used by the UI
 *  panel so the user sees recent output without us streaming MBs. */
export function readHookLogTail(workspaceRoot: string, hookId: string, maxBytes = 8_000): string | null {
  const file = path.resolve(path.join(hooksLogDir(workspaceRoot), `${hookId}.log`));
  assertInsideAriadne(workspaceRoot, file);
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  if (stat.size <= maxBytes) return fs.readFileSync(file, "utf-8");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
    return "...(truncated)\n" + buf.toString("utf-8");
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------------
// Workspace memory (.ariadne/memory.yaml)
// ---------------------------------------------------------------------------

const MEMORY_YAML = ".ariadne/memory.yaml";

export function memoryYamlPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, MEMORY_YAML);
}

/** Read raw .ariadne/memory.yaml; null if the file does not exist. */
export function readMemoryYaml(workspaceRoot: string): string | null {
  const dest = path.resolve(path.join(workspaceRoot, MEMORY_YAML));
  assertInsideAriadne(workspaceRoot, dest);
  if (!fs.existsSync(dest)) return null;
  return fs.readFileSync(dest, "utf-8");
}

/** Write raw .ariadne/memory.yaml. */
export function writeMemoryYaml(workspaceRoot: string, source: string): void {
  const dest = path.resolve(path.join(workspaceRoot, MEMORY_YAML));
  assertInsideAriadne(workspaceRoot, dest);
  fs.writeFileSync(dest, source, "utf-8");
}
