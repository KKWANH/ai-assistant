/**
 * Surface build service.
 *
 * Bundles `.ariadne/surface.tsx` into a self-contained browser IIFE at
 * `.ariadne/surface-dist/bundle.js` using the esbuild JS API.
 *
 * The `@ariadne/surface` import alias is resolved to the runtime module in this
 * server package so that React, hooks, and chart components are bundled in.
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build, type BuildFailure } from "esbuild";
import {
  ensureAriadneFolder,
  surfaceTsxPath,
  surfaceBundlePath,
} from "../ariadneFolder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root — apps/server/src/services → up four levels. */
const REPO_ROOT = path.resolve(__dirname, "../../../../");

/**
 * Where esbuild should resolve bare imports (react, react-dom/client,
 * react/jsx-runtime). The surface source lives in a workspace's `.ariadne/`
 * folder which has no node_modules, so we point esbuild at the monorepo's.
 */
const NODE_PATHS = [
  path.join(REPO_ROOT, "node_modules"),
  path.join(REPO_ROOT, "apps", "server", "node_modules"),
];

/** Absolute path to the runtime module shipped with the server. */
const RUNTIME_PATH = path.resolve(__dirname, "../surface/runtime.js");

export interface BuildResult {
  ok: boolean;
  error: string | null;
}

/**
 * Build the user's `.ariadne/surface.tsx` into `.ariadne/surface-dist/bundle.js`.
 *
 * The entry shim imports the user's default export and mounts it with ReactDOM.
 * Returns `{ ok: true, error: null }` on success or `{ ok: false, error }` on failure.
 */
export async function buildSurface(workspaceRoot: string): Promise<BuildResult> {
  ensureAriadneFolder(workspaceRoot);

  const srcPath = surfaceTsxPath(workspaceRoot);
  if (!fs.existsSync(srcPath)) {
    return {
      ok: false,
      error: "No surface source — save .ariadne/surface.tsx (single-file) or .ariadne/surface/index.tsx (folder form) first.",
    };
  }

  const outFile = surfaceBundlePath(workspaceRoot);

  // The entry shim is inlined so we don't need to write a temp file.
  // esbuild's stdin feature lets us supply a virtual entry point.
  // BJ1: mount via the runtime's mountSurface() so every surface gets the same
  // error boundary + host crash reporting, instead of a bare ReactDOM.render.
  const entryContents = `
import Component from ${JSON.stringify(srcPath)};
import { mountSurface } from "@ariadne/surface";
mountSurface(Component);
`;

  try {
    await build({
      stdin: {
        contents: entryContents,
        resolveDir: workspaceRoot,
        loader: "tsx",
      },
      bundle: true,
      format: "iife",
      jsx: "automatic",
      platform: "browser",
      outfile: outFile,
      nodePaths: NODE_PATHS,
      alias: {
        "@ariadne/surface": RUNTIME_PATH,
      },
      loader: {
        ".tsx": "tsx",
        ".ts": "ts",
        ".jsx": "jsx",
        ".js": "js",
      },
      logLevel: "silent",
    });
    return { ok: true, error: null };
  } catch (err) {
    // esbuild throws a BuildFailure with a .errors array
    const bf = err as BuildFailure;
    if (bf.errors && bf.errors.length > 0) {
      const msgs = bf.errors
        .map((e) => {
          const loc = e.location
            ? ` (${e.location.file}:${String(e.location.line)}:${String(e.location.column)})`
            : "";
          return `${e.text}${loc}`;
        })
        .join("\n");
      return { ok: false, error: msgs };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
