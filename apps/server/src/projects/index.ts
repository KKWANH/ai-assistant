/**
 * Server-side project registry.
 *
 * Statically imports every example project's server contribution from
 * `projects/<name>/`. Core iterates this list instead of hardcoding any
 * vertical — see `projects/README.md`. Removing a project here (and its
 * folder) leaves core building.
 *
 * Imports are relative (not the `@projects` alias): the alias is for the
 * web/vite + tsc, but the server runs under tsx, which resolves bare
 * specifiers via node_modules — and `projects/` is not a workspace package.
 */
import type { ProjectServerModule, ProjectStarter } from "@ariadne/shared";
import { project as budget } from "../../../../projects/budget/server.js";
import { project as reading } from "../../../../projects/reading/server.js";
import { project as chefbook } from "../../../../projects/chefbook/server.js";
import { project as code } from "../../../../projects/code/server.js";
import { project as decisions } from "../../../../projects/decisions/server.js";
import { project as papers } from "../../../../projects/papers/server.js";

export const PROJECTS: ProjectServerModule[] = [
  budget,
  reading,
  chefbook,
  code,
  decisions,
  papers,
];

/** All project-contributed starters, keyed by id, for the create flow. */
export function projectStarters(): Record<string, ProjectStarter> {
  const out: Record<string, ProjectStarter> = {};
  for (const p of PROJECTS) if (p.starter) out[p.starter.id] = p.starter;
  return out;
}
