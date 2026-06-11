/**
 * Project registry interfaces.
 *
 * Example verticals (budget, lecture, …) live in `projects/<name>/` and plug
 * into core through these interfaces — core iterates a static registry rather
 * than hardcoding any vertical. See `projects/README.md` for the architecture.
 *
 * Data-only on purpose so it can live in the framework-agnostic shared
 * package; the server registry extends `ProjectServerModule` with Fastify
 * route hooks, and the web registry extends `ProjectWebModule` with React
 * routes — each on its own side.
 */
import type { Template } from "./types.js";

/** A workspace template a project contributes to the create flow. */
export interface ProjectStarter {
  /** create-flow id, e.g. "budget". */
  id: string;
  /** Scopes which templates the workspace surfaces; e.g. "finance". */
  category: string | null;
  /** Files written into the new workspace (relative path → contents). */
  files?: Record<string, string>;
  /** The custom screen source (surface.tsx). */
  surface?: string;
  /** actions.yaml contents, if any. */
  actions?: string;
}

/** Server-side contribution of an example project. */
export interface ProjectServerModule {
  name: string;
  starter?: ProjectStarter;
  /** Run templates this project adds to the "create & run" list. Merged into
   *  the available templates at boot — see registerProjectTemplates. */
  templates?: Template[];
}

/** The create-dialog card a project contributes. */
export interface ProjectStarterCard {
  id: string;
  /** Lucide icon NAME, resolved on the web side (keeps lucide out of shared). */
  icon: string;
  labelKey: string;
  descKey: string;
}

/** Web-side contribution of an example project. */
export interface ProjectWebModule {
  name: string;
  starterCard?: ProjectStarterCard;
  /** Where this project's workspaces open on entry — generalizes the lecture
   *  "open to /lecture" home routing. Returns a path, or null to fall through
   *  to the default overview. (Rich React routes are wired separately via the
   *  web registry's route list.) */
  resolveHome?: (ws: import("./types.js").Workspace) => string | null;
}
