import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertInsideAriadne } from "./security/pathGuard.js";

/** BJ2 — canonical @ariadne/surface type contract, copied into each workspace
 *  so surface builders get IDE autocomplete with no node_modules. */
const SURFACE_ENV_DTS_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/surface-sdk/surface-env.d.ts",
);

/** Tiny tsconfig that puts the .d.ts + surface in scope for the editor. */
const SURFACE_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["surface-env.d.ts", "surface.tsx", "surface/**/*.ts", "surface/**/*.tsx"]
}
`;

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
//
// Two layouts supported (AH):
//   (a) Single-file        .ariadne/surface.tsx        — original
//   (b) Folder + index     .ariadne/surface/index.tsx  — for surfaces
//                                                        that grow past
//                                                        one file, like
//                                                        the brokerage-app
//                                                        portfolio dashboard
//
// The folder form is preferred when present (it's the more expressive shape
// — index.tsx can import sibling files freely). The single-file form stays
// as the default for new workspaces and for back-compat with workspaces
// already in the field. Esbuild resolves whichever path exists.
// ---------------------------------------------------------------------------

const SURFACE_TSX_FILE   = ".ariadne/surface.tsx";
const SURFACE_INDEX_TSX  = ".ariadne/surface/index.tsx";
const SURFACE_BUNDLE     = ".ariadne/surface-dist/bundle.js";

/** Resolve which surface source to use for this workspace.
 *  Folder form wins when present. */
function resolveSurfaceEntry(workspaceRoot: string): string {
  const folderEntry = path.resolve(path.join(workspaceRoot, SURFACE_INDEX_TSX));
  const singleFile = path.resolve(path.join(workspaceRoot, SURFACE_TSX_FILE));
  if (fs.existsSync(folderEntry)) return folderEntry;
  return singleFile; // may not exist yet — caller checks
}

/** Read the surface source if it exists; returns null otherwise.
 *  For the folder form, returns the index.tsx contents (siblings are
 *  read lazily by esbuild at build time, not by this helper). */
export function readSurface(workspaceRoot: string): string | null {
  const entry = resolveSurfaceEntry(workspaceRoot);
  assertInsideAriadne(workspaceRoot, entry);
  if (!fs.existsSync(entry)) return null;
  return fs.readFileSync(entry, "utf-8");
}

/** Write the surface source. Targets `.ariadne/surface.tsx` (single-file
 *  layout) — users who want the folder form create
 *  `.ariadne/surface/index.tsx` directly on disk; the build picks it up. */
export function writeSurface(workspaceRoot: string, source: string): void {
  const dest = path.resolve(path.join(workspaceRoot, SURFACE_TSX_FILE));
  assertInsideAriadne(workspaceRoot, dest);
  fs.writeFileSync(dest, source, "utf-8");
  seedSurfaceTypes(workspaceRoot);
}

/**
 * BJ2 — drop the @ariadne/surface type contract + a tiny tsconfig next to the
 * surface so a builder's editor resolves the SDK with autocomplete. The build
 * ignores these (esbuild aliases @ariadne/surface to runtime.tsx); they're
 * purely an editor aid. Best-effort: silently skips if the contract source is
 * absent (e.g. a trimmed deploy). The .d.ts is generated — rewritten when it
 * drifts; the tsconfig is written once so builder tweaks survive.
 */
export function seedSurfaceTypes(workspaceRoot: string): void {
  if (!fs.existsSync(SURFACE_ENV_DTS_SRC)) return;
  const base = path.join(workspaceRoot, ".ariadne");
  fs.mkdirSync(base, { recursive: true });

  const dts = fs.readFileSync(SURFACE_ENV_DTS_SRC, "utf-8");
  const dtsDest = path.join(base, "surface-env.d.ts");
  assertInsideAriadne(workspaceRoot, dtsDest);
  if (!fs.existsSync(dtsDest) || fs.readFileSync(dtsDest, "utf-8") !== dts) {
    fs.writeFileSync(dtsDest, dts, "utf-8");
  }

  const tsconfigDest = path.join(base, "tsconfig.json");
  assertInsideAriadne(workspaceRoot, tsconfigDest);
  if (!fs.existsSync(tsconfigDest)) {
    fs.writeFileSync(tsconfigDest, SURFACE_TSCONFIG, "utf-8");
  }
}

/** Returns the absolute path to the built bundle, or null if it doesn't exist. */
export function surfaceBundlePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, SURFACE_BUNDLE);
}

/** Returns the absolute path to the surface entry TSX source —
 *  `.ariadne/surface/index.tsx` if present, otherwise `.ariadne/surface.tsx`. */
export function surfaceTsxPath(workspaceRoot: string): string {
  return resolveSurfaceEntry(workspaceRoot);
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
