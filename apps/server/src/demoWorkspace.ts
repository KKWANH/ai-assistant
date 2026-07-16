/**
 * Built-in Portfolio workspace.
 *
 * Originally a "demo-portfolio" showcase; promoted in AG to be the user's
 * canonical portfolio workspace at `data/portfolio/` with the v2 multi-
 * account / 3-tier-analysis layout (per docs/PORTFOLIO_STARTER_V2.md).
 *
 * The CSV / YAML data files are seeded ONLY when missing — the user's later
 * edits (Data-tab + manual maintenance) are never overwritten on boot.
 * The surface dashboard is similarly preserved if the user has customized
 * it (e.g. dropped in the v2 brokerage-app surface from the repo); only
 * a fresh first-time seed writes the bundled v1 surface.
 *
 * Promotion in AG also moves the on-disk path from `demo-portfolio/` to
 * `portfolio/`. Older installs whose DB row still points at
 * `demo-portfolio/` are migrated to the new path if the new path exists.
 */

import fs from "node:fs";
import path from "node:path";
import { DEMO_WORKSPACE_ID, DEFAULT_INCLUDE, DEFAULT_EXCLUDE } from "@ariadne/shared";
import type { Workspace } from "@ariadne/shared";
import { dbGetWorkspace, dbInsertWorkspace, dbUpdateWorkspace, dbGetSetting } from "./db/repo.js";
import { PATHS } from "./config.js";
import { ensureAriadneFolder, writeSurface } from "./ariadneFolder.js";
import { buildSurface } from "./services/surfaceBuild.js";
import {
  HOLDINGS_CSV,
  FX_RATES_CSV,
  HISTORY_CSV,
  SURFACE_TSX,
  ACTIONS_YAML,
  ACCOUNTS_INDEX_YAML,
  POSITIONS_CURRENT_CSV,
  POSITIONS_WATCHLIST_CSV,
  CASH_INDEX_YAML,
  ASSETS_PRECIOUS_METALS_YAML,
  ASSETS_FUNDS_YAML,
  ANALYSIS_MACRO_SAMPLE_MD,
  ANALYSIS_MESO_SAMPLE_MD,
  ANALYSIS_MICRO_AAPL_MD,
  GOALS_2026_ALLOCATION_MD,
} from "./surface/portfolioStarter.js";
import { seedPortfolioV2Surface } from "./surface/portfolioV2Template.js";
import logger from "./logger.js";

/** Seed the built-in Portfolio workspace at data/portfolio/. */
export async function ensureDemoWorkspace(): Promise<void> {
  try {
    // The user deleted this sample — the tombstone (written by the workspace
    // DELETE route) means "don't recreate it at boot".
    if (dbGetSetting(`builtinDeleted:${DEMO_WORKSPACE_ID}`)) return;
    const exists = !!dbGetWorkspace(DEMO_WORKSPACE_ID);
    const rootPath = path.join(PATHS.home, "portfolio");
    fs.mkdirSync(rootPath, { recursive: true });

    // CSV data is seeded on first creation and left alone afterwards so
    // Data-tab edits survive. Exception — a one-time schema upgrade: an
    // older row whose holdings.csv predates the quote_symbol column (added
    // for live quotes) is re-seeded so live market data resolves correctly.
    const holdingsPath = path.join(rootPath, "holdings.csv");
    let needsV1Seed = !exists;
    if (exists) {
      try {
        const firstLine = fs.readFileSync(holdingsPath, "utf-8").split("\n")[0] ?? "";
        if (!firstLine.includes("quote_symbol")) needsV1Seed = true;
      } catch {
        needsV1Seed = true;
      }
    }
    if (needsV1Seed) {
      fs.writeFileSync(holdingsPath, HOLDINGS_CSV, "utf-8");
      fs.writeFileSync(path.join(rootPath, "fx_rates.csv"), FX_RATES_CSV, "utf-8");
      fs.writeFileSync(path.join(rootPath, "history.csv"), HISTORY_CSV, "utf-8");
    }

    // v2 layout — seeded only when each individual file is missing, so the
    // user's real maintained data (accounts/, positions/, cash/, analysis/,
    // goals/) is never overwritten on boot. Anything the user has put in
    // place wins.
    const v2Files: Array<[string, string]> = [
      ["accounts/_index.yaml",                    ACCOUNTS_INDEX_YAML],
      ["positions/current.csv",                   POSITIONS_CURRENT_CSV],
      ["positions/watchlist.csv",                 POSITIONS_WATCHLIST_CSV],
      ["cash/_index.yaml",                        CASH_INDEX_YAML],
      ["assets/precious_metals.yaml",             ASSETS_PRECIOUS_METALS_YAML],
      ["assets/funds.yaml",                       ASSETS_FUNDS_YAML],
      ["analysis/macro/sample.md",                ANALYSIS_MACRO_SAMPLE_MD],
      ["analysis/meso/sample.md",                 ANALYSIS_MESO_SAMPLE_MD],
      ["analysis/micro/AAPL-2026-01.md",          ANALYSIS_MICRO_AAPL_MD],
      ["goals/2026-allocation.md",                GOALS_2026_ALLOCATION_MD],
    ];
    for (const [rel, body] of v2Files) {
      const abs = path.join(rootPath, rel);
      if (fs.existsSync(abs)) continue;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body, "utf-8");
    }

    // Surface — preferred path is the v2 multi-file folder
    // (.ariadne/surface/index.tsx + 5 sibling files). Seed via the
    // disk-based helper which copies each file only when missing,
    // so user edits to any single file survive a restart.
    //
    // Fallback for very old installs: if neither folder form nor
    // single-file exists, also seed the v1 template at
    // .ariadne/surface.tsx — gives the bundler something to build
    // even before the v2 folder seed has run on a corrupted disk.
    ensureAriadneFolder(rootPath);
    const { written: v2Written, total: v2Total } = seedPortfolioV2Surface(rootPath);
    if (v2Written > 0) {
      logger.info({ rootPath, written: v2Written, total: v2Total }, "Seeded Portfolio v2 surface folder");
    }
    const singleSurfacePath = path.join(rootPath, ".ariadne", "surface.tsx");
    const folderEntry = path.join(rootPath, ".ariadne", "surface", "index.tsx");
    if (!fs.existsSync(folderEntry) && !fs.existsSync(singleSurfacePath)) {
      writeSurface(rootPath, SURFACE_TSX);
    }

    // actions.yaml — seed once, do NOT overwrite later.
    const actionsPath = path.join(rootPath, ".ariadne", "actions.yaml");
    if (!fs.existsSync(actionsPath)) {
      fs.writeFileSync(actionsPath, ACTIONS_YAML, "utf-8");
    }
    await buildSurface(rootPath);

    if (!exists) {
      const workspace: Workspace = {
        id: DEMO_WORKSPACE_ID,
        name: "Portfolio",
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
        homeView: null,
        defaultProvider: null,
        defaultModel: null,
        defaultSkillId: null,
      };
      dbInsertWorkspace(workspace);
      logger.info({ rootPath }, "Seeded the built-in Portfolio workspace");
    } else {
      // Backfill: an older row predates the category column.
      const demo = dbGetWorkspace(DEMO_WORKSPACE_ID);
      if (demo && !demo.category) {
        dbUpdateWorkspace(DEMO_WORKSPACE_ID, { category: "finance" });
      }
      // Migrate the rootPath from demo-portfolio/ to portfolio/ for
      // older rows. dbUpdateWorkspace doesn't currently accept rootPath
      // via the public API, so we only repoint when both:
      //   (a) the DB row points at demo-portfolio/, AND
      //   (b) data/portfolio/ exists on disk
      // by going through a thin repo helper. The schema is intentionally
      // narrow — this is the only place we change rootPath at boot.
      if (demo && demo.rootPath !== rootPath && fs.existsSync(rootPath)) {
        try {
          dbUpdateWorkspace(DEMO_WORKSPACE_ID, { rootPath });
          logger.info(
            { from: demo.rootPath, to: rootPath },
            "Migrated Portfolio workspace rootPath demo-portfolio/ → portfolio/",
          );
        } catch (e) {
          logger.warn({ err: e, from: demo.rootPath, to: rootPath },
            "Could not migrate Portfolio rootPath — leaving as-is");
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to seed the Portfolio workspace");
  }
}
