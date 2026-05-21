/**
 * Built-in tutorial workspace.
 *
 * A non-deletable example workspace seeded on first boot so the guided tour
 * and "try a template run" walkthroughs always have a real workspace — with
 * real files — to point at. Its id is fixed (TUTORIAL_WORKSPACE_ID); the
 * access guard and the delete route special-case it.
 */

import fs from "node:fs";
import path from "node:path";
import { TUTORIAL_WORKSPACE_ID, DEFAULT_INCLUDE, DEFAULT_EXCLUDE } from "@ariadne/shared";
import type { Workspace } from "@ariadne/shared";
import { dbGetWorkspace, dbInsertWorkspace } from "./db/repo.js";
import { PATHS } from "./config.js";
import { ensureAriadneFolder } from "./ariadneFolder.js";
import logger from "./logger.js";

/** Sample files placed in the workspace so template runs have real material. */
const SAMPLE_FILES: Record<string, string> = {
  "welcome.md":
    "# Tutorial workspace\n\n" +
    "This is Ariadne's built-in example workspace. It is always here and cannot\n" +
    "be deleted, so it is a safe place to try things out.\n\n" +
    "Use it to learn the workflow:\n\n" +
    "- Open the **Create & runs** tab and run a template (for example, a\n" +
    "  Research Brief) against the sample notes in this folder.\n" +
    "- Watch Ariadne scan the folder, propose which files to read, and produce a\n" +
    "  source-backed brief with a claim-to-source map.\n" +
    "- Or open a chat with this workspace attached and ask about the files.\n\n" +
    "The other two files are short example notes on remote work — enough\n" +
    "material for a template run to summarize.\n",
  "remote-work-benefits.md":
    "# Remote work — reported benefits\n\n" +
    "Surveys of distributed teams consistently report a few recurring advantages.\n\n" +
    "**Time and cost.** Eliminating the commute returns several hours a week to\n" +
    "employees and removes a daily expense, along with office-related costs such\n" +
    "as meals and work clothing.\n\n" +
    "**Focus.** A large share of remote workers say they get more deep,\n" +
    "uninterrupted work done at home than in an open-plan office, where ad-hoc\n" +
    "interruptions are frequent.\n\n" +
    "**Flexibility and retention.** Control over one's schedule and location is\n" +
    "repeatedly ranked among the most valued job benefits, and companies offering\n" +
    "it tend to report higher retention and a wider, geography-independent hiring\n" +
    "pool.\n\n" +
    "**Continuity.** Distributed teams proved more resilient to local disruptions\n" +
    "— weather, transit, or health events — because work is not tied to one\n" +
    "building.\n",
  "remote-work-challenges.md":
    "# Remote work — reported challenges\n\n" +
    "The same surveys also surface persistent difficulties.\n\n" +
    "**Isolation.** Loneliness and reduced social connection are the most commonly\n" +
    "cited downsides; informal hallway conversation is hard to replicate online.\n\n" +
    "**Boundaries.** Without the physical separation of an office, work and\n" +
    "personal time blur; some remote workers report longer hours and difficulty\n" +
    "switching off.\n\n" +
    "**Communication.** Asynchronous, text-first communication is precise but\n" +
    "slower, and newer team members can struggle to absorb context an office\n" +
    "transmits implicitly.\n\n" +
    "**Onboarding.** Early-career employees often learn by observation; remote\n" +
    "settings make that incidental learning harder and put more weight on\n" +
    "deliberate written documentation.\n\n" +
    "Most organizations conclude that a deliberate hybrid — clear written norms\n" +
    "plus periodic in-person time — captures the benefits while limiting these\n" +
    "costs.\n",
};

/** Seed the tutorial workspace once, if it does not already exist. */
export function ensureTutorialWorkspace(): void {
  try {
    if (dbGetWorkspace(TUTORIAL_WORKSPACE_ID)) return;

    const rootPath = path.join(PATHS.home, "tutorial-workspace");
    fs.mkdirSync(rootPath, { recursive: true });
    for (const [name, content] of Object.entries(SAMPLE_FILES)) {
      const file = path.join(rootPath, name);
      if (!fs.existsSync(file)) fs.writeFileSync(file, content, "utf-8");
    }
    ensureAriadneFolder(rootPath);

    const workspace: Workspace = {
      id: TUTORIAL_WORKSPACE_ID,
      name: "Tutorial workspace",
      rootPath,
      include: DEFAULT_INCLUDE,
      exclude: DEFAULT_EXCLUDE,
      createdAt: new Date().toISOString(),
      lastScanAt: null,
      fileCount: 0,
      createdBy: null,
      createdByName: null,
      visibility: "public",
    };
    dbInsertWorkspace(workspace);
    logger.info({ rootPath }, "Seeded the built-in tutorial workspace");
  } catch (err) {
    logger.warn({ err }, "Failed to seed the tutorial workspace");
  }
}
