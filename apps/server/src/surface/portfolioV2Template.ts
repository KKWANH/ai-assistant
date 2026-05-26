/**
 * Portfolio v2 surface — read the multi-file template from disk.
 *
 * The v2 surface lives as real .tsx files under
 *   apps/server/src/surface-templates/portfolio-v2/
 *
 * (excluded from tsc via apps/server/tsconfig.json — they're built by
 * esbuild at the user-workspace level, not the server's own typecheck).
 *
 * `seedPortfolioV2Surface(workspaceRoot)` copies each file into the
 * workspace's `.ariadne/surface/` folder when missing, preserving any
 * user edits. The seeder is called from both:
 *   - demoWorkspace.ts             (built-in Portfolio at boot)
 *   - routes/workspaces.ts         (Investment Portfolio starter dialog)
 *
 * This pattern avoids the template-string escape problem of embedding
 * the surface source inside a TS string literal — the files stay as
 * real source we can edit + diff normally.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import logger from "../logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Absolute path to the template source directory. Resolves at startup. */
const TEMPLATE_DIR = path.resolve(__dirname, "..", "surface-templates", "portfolio-v2");

/** The 6 files that make up the v2 surface (folder form). */
const V2_FILES = [
  "index.tsx",
  "types.ts",
  "yaml.ts",
  "utils.ts",
  "primitives.tsx",
  "sections.tsx",
] as const;

/**
 * Seed `<workspaceRoot>/.ariadne/surface/<file>` from
 * `apps/server/src/surface-templates/portfolio-v2/<file>` for any
 * file that doesn't exist yet. Existing files are left untouched —
 * the user's edits always win.
 *
 * Idempotent: if all 6 files are already present, this is a no-op.
 * Returns the count of files actually written, for log lines.
 */
export function seedPortfolioV2Surface(workspaceRoot: string): { written: number; total: number } {
  const surfaceDir = path.join(workspaceRoot, ".ariadne", "surface");
  fs.mkdirSync(surfaceDir, { recursive: true });

  let written = 0;
  for (const file of V2_FILES) {
    const dest = path.join(surfaceDir, file);
    if (fs.existsSync(dest)) continue;
    const src = path.join(TEMPLATE_DIR, file);
    if (!fs.existsSync(src)) {
      logger.warn({ src }, "v2 surface template file missing from repo — skipping");
      continue;
    }
    fs.copyFileSync(src, dest);
    written++;
  }
  return { written, total: V2_FILES.length };
}
