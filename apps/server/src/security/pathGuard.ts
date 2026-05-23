import path from "node:path";

/**
 * Assert that `writePath` resolves to somewhere inside
 * `<workspaceRoot>/.ariadne/`.  Throws if the path escapes.
 *
 * All write helpers in ariadneFolder.ts must route through this.
 */
export function assertInsideAriadne(workspaceRoot: string, writePath: string): void {
  const ariadneDir = path.resolve(workspaceRoot, ".ariadne");
  const resolved = path.resolve(writePath);

  if (!resolved.startsWith(ariadneDir + path.sep) && resolved !== ariadneDir) {
    throw new Error(
      `Path guard: write outside .ariadne is forbidden.\n  tried: ${resolved}\n  allowed under: ${ariadneDir}`
    );
  }
}

/**
 * Resolve `relPath` against `root` and return the absolute path only if
 * it stays inside `root`. Returns null on traversal — callers typically
 * `continue` past the file rather than throw.
 *
 * The classic shape `if (abs !== root && !abs.startsWith(root + path.sep))`
 * is duplicated across the indexers; this is the one place to keep it
 * correct. Adopt incrementally — see the symbol indexer for the pattern.
 */
export function safeResolveUnderRoot(root: string, relPath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const abs = path.resolve(resolvedRoot, relPath);
  if (abs === resolvedRoot) return abs;
  if (abs.startsWith(resolvedRoot + path.sep)) return abs;
  return null;
}
