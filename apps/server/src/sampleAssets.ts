/**
 * Built-in "자산 현황 (샘플)" workspace — a PUBLIC copy of the real net-worth
 * dashboard *view* with fully fabricated data.
 *
 * The surface (.tsx) is a personal-info-scrubbed copy of the user's real 자산
 * 현황 dashboard: same front view + data structure, but every value here is
 * invented and all hardcoded personal specifics (holdings, employment, tax /
 * jurisdiction notes) were removed. Source lives as real files under
 *   apps/server/src/surface-templates/assets-sample/
 *     surface.tsx          — the scrubbed dashboard
 *     data/<relpath>...     — fabricated view.json + targets + history + CSVs
 * (excluded from the server's tsc; built by esbuild at the workspace level).
 *
 * Files are seeded only when missing, so Data-tab edits survive a restart.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ASSETS_SAMPLE_WORKSPACE_ID, DEFAULT_INCLUDE, DEFAULT_EXCLUDE } from "@ariadne/shared";
import type { Workspace } from "@ariadne/shared";
import { dbGetWorkspace, dbInsertWorkspace, dbDeleteWorkspace, dbGetSetting } from "./db/repo.js";
import { PATHS } from "./config.js";
import { ensureAriadneFolder, writeSurface } from "./ariadneFolder.js";
import { buildSurface } from "./services/surfaceBuild.js";
import logger from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, "surface-templates", "assets-sample");

/** The id of the earlier "Net Worth" sample this workspace supersedes. */
const OLD_NETWORTH_ID = "ariadne-sample-networth";

/** Recursively copy `src` → `dst`, skipping any file that already exists so the
 *  user's later edits in the Data tab are never overwritten on boot. */
function copyTreeIfMissing(src: string, dst: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyTreeIfMissing(s, d);
    } else if (!fs.existsSync(d)) {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    }
  }
}

/** Seed the built-in public "자산 현황 (샘플)" workspace at data/sample-assets/. */
export async function ensureAssetsSample(): Promise<void> {
  try {
    // The user deleted this sample — the tombstone (written by the workspace
    // DELETE route) means "don't recreate it at boot".
    if (dbGetSetting(`builtinDeleted:${ASSETS_SAMPLE_WORKSPACE_ID}`)) return;
    // One-time cleanup — remove the earlier "Net Worth" sample this replaces
    // (it was a transient showcase added in the same development cycle).
    if (dbGetWorkspace(OLD_NETWORTH_ID)) {
      dbDeleteWorkspace(OLD_NETWORTH_ID);
      try {
        fs.rmSync(path.join(PATHS.home, "sample-networth"), { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      logger.info("Removed the superseded Net Worth sample workspace");
    }

    const exists = !!dbGetWorkspace(ASSETS_SAMPLE_WORKSPACE_ID);
    const rootPath = path.join(PATHS.home, "sample-assets");
    fs.mkdirSync(rootPath, { recursive: true });

    // Fabricated data files — seeded once. `seed/` mirrors the workspace root;
    // `store/` lands under .ariadne/store/ (kept out of the template's .ariadne
    // path so the repo's `data/` + `.ariadne` gitignore rules don't drop it).
    copyTreeIfMissing(path.join(TEMPLATE_DIR, "seed"), rootPath);
    copyTreeIfMissing(path.join(TEMPLATE_DIR, "store"), path.join(rootPath, ".ariadne", "store"));

    // Surface — the scrubbed dashboard. Seed only when neither surface form
    // exists yet, so a user's later customisation of the screen survives.
    ensureAriadneFolder(rootPath);
    const singleSurfacePath = path.join(rootPath, ".ariadne", "surface.tsx");
    const folderEntry = path.join(rootPath, ".ariadne", "surface", "index.tsx");
    if (!fs.existsSync(folderEntry) && !fs.existsSync(singleSurfacePath)) {
      const surfaceSrc = fs.readFileSync(path.join(TEMPLATE_DIR, "surface.tsx"), "utf-8");
      writeSurface(rootPath, surfaceSrc);
    }
    await buildSurface(rootPath);

    if (!exists) {
      const workspace: Workspace = {
        id: ASSETS_SAMPLE_WORKSPACE_ID,
        name: "자산 현황 (샘플)",
        rootPath,
        include: DEFAULT_INCLUDE,
        exclude: DEFAULT_EXCLUDE,
        createdAt: new Date().toISOString(),
        lastScanAt: null,
        fileCount: 0,
        createdBy: null,
        createdByName: null,
        visibility: "public",
        category: "finance",
        section: null,
        // Open straight to the immersive dashboard — it's a showcase screen.
        homeView: "surface",
        defaultProvider: null,
        defaultModel: null,
        defaultSkillId: null,
      };
      dbInsertWorkspace(workspace);
      logger.info({ rootPath }, "Seeded the built-in 자산 현황 sample workspace");
    }
  } catch (err) {
    logger.warn({ err }, "Failed to seed the 자산 현황 sample workspace");
  }
}
