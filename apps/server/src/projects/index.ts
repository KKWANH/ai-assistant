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
 * (Projects import core the other way, via the `@ariadne/server` workspace
 * package, which tsx does resolve.)
 */
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { ProjectServerModule, ProjectStarter, Template } from "@ariadne/shared";
import { project as budget } from "../../../../projects/budget/server.js";
import { project as reading } from "../../../../projects/reading/server.js";
import { project as chefbook } from "../../../../projects/chefbook/server.js";
import { project as code } from "../../../../projects/code/server.js";
import { project as decisions } from "../../../../projects/decisions/server.js";
import { project as papers } from "../../../../projects/papers/server.js";
import { project as lecture } from "../../../../projects/lecture/server.js";
import { project as writing } from "../../../../projects/writing/server.js";

export const PROJECTS: ProjectServerModule[] = [
  budget,
  reading,
  chefbook,
  code,
  decisions,
  papers,
  lecture,
  writing,
];

/** All project-contributed starters, keyed by id, for the create flow. */
export function projectStarters(): Record<string, ProjectStarter> {
  const out: Record<string, ProjectStarter> = {};
  for (const p of PROJECTS) if (p.starter) out[p.starter.id] = p.starter;
  return out;
}

/** Every project-contributed run template, merged into core's list at boot. */
export function projectTemplates(): Template[] {
  return PROJECTS.flatMap((p) => p.templates ?? []);
}

/** Mount every project's Fastify routes generically — each project that has
 *  routes carries them on its module (project.routes); core never names a
 *  vertical. (`routes` is typed `unknown` in the framework-agnostic contract;
 *  we cast to a Fastify plugin at this boundary.) */
export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  for (const p of PROJECTS) {
    if (p.routes) await app.register(p.routes as FastifyPluginAsync);
  }
}
