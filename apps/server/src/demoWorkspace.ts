/**
 * Built-in demo workspace — the Portfolio showcase.
 *
 * Seeded on boot at a stable path inside the app data home, so the flagship
 * custom-surface demo is always present and reproducible. Its id is fixed
 * (DEMO_WORKSPACE_ID); the access guard and the delete route treat it as a
 * built-in, like the tutorial.
 *
 * The CSV data and the workspace row are seeded once; the user's later edits
 * (e.g. via the Data tab) are never overwritten. The surface dashboard, in
 * contrast, is re-synced from portfolioStarter.ts on every boot so showcase
 * improvements always reach the existing demo workspace.
 */

import fs from "node:fs";
import path from "node:path";
import { DEMO_WORKSPACE_ID, DEFAULT_INCLUDE, DEFAULT_EXCLUDE } from "@ariadne/shared";
import type { Workspace } from "@ariadne/shared";
import { dbGetWorkspace, dbInsertWorkspace, dbUpdateWorkspace } from "./db/repo.js";
import { PATHS } from "./config.js";
import { ensureAriadneFolder, writeSurface } from "./ariadneFolder.js";
import { buildSurface } from "./services/surfaceBuild.js";
import {
  HOLDINGS_CSV,
  FX_RATES_CSV,
  HISTORY_CSV,
  SURFACE_TSX,
} from "./surface/portfolioStarter.js";
import logger from "./logger.js";

/** Seed the demo Portfolio workspace, and keep its surface dashboard current. */
export async function ensureDemoWorkspace(): Promise<void> {
  try {
    const exists = !!dbGetWorkspace(DEMO_WORKSPACE_ID);
    const rootPath = path.join(PATHS.home, "demo-portfolio");
    fs.mkdirSync(rootPath, { recursive: true });

    // CSV data is seeded on first creation and left alone afterwards so Data-tab
    // edits survive. Exception — a one-time schema upgrade: an older demo whose
    // holdings.csv predates the quote_symbol column (added for live quotes) is
    // re-seeded so live market data resolves correctly.
    const holdingsPath = path.join(rootPath, "holdings.csv");
    let needsSeed = !exists;
    if (exists) {
      try {
        const firstLine = fs.readFileSync(holdingsPath, "utf-8").split("\n")[0] ?? "";
        if (!firstLine.includes("quote_symbol")) needsSeed = true;
      } catch {
        needsSeed = true;
      }
    }
    if (needsSeed) {
      fs.writeFileSync(holdingsPath, HOLDINGS_CSV, "utf-8");
      fs.writeFileSync(path.join(rootPath, "fx_rates.csv"), FX_RATES_CSV, "utf-8");
      fs.writeFileSync(path.join(rootPath, "history.csv"), HISTORY_CSV, "utf-8");
    }

    // The dashboard surface is always re-synced so showcase updates land.
    ensureAriadneFolder(rootPath);
    writeSurface(rootPath, SURFACE_TSX);
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
      };
      dbInsertWorkspace(workspace);
      logger.info({ rootPath }, "Seeded the built-in Portfolio demo workspace");
    } else {
      // Backfill: an older demo row predates the category column and would
      // still surface every template — pin it to finance once.
      const demo = dbGetWorkspace(DEMO_WORKSPACE_ID);
      if (demo && !demo.category) {
        dbUpdateWorkspace(DEMO_WORKSPACE_ID, { category: "finance" });
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to seed the demo workspace");
  }
}
