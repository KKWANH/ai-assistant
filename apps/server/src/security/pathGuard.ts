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
