import type { ProjectServerModule } from "@ariadne/shared";

/** Writing — an example project for the user's writing work (criticism,
 *  lecture transcripts, essays). A minimal starter: it scaffolds no files (the
 *  writer brings their own drafts), sets the workspace `category` so the create
 *  flow + per-project chat starters key off it, and is NOT focus-locked so the
 *  full editor and tools stay available. The writing skills live in core's
 *  built-in skills (services/builtinSkills.ts). */
export const project: ProjectServerModule = {
  name: "writing",
  starter: { id: "writing", category: "writing", focusByDefault: false },
};
