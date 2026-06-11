import type { ProjectServerModule } from "@ariadne/shared";
import { lectureBriefTemplate } from "./server/templates.js";

/** Lecture prep — an example project (not a core feature) demonstrating the
 *  platform: a semester organized as courses → weeks → materials, with deck
 *  (.pptx) + script (.docx) generation and sourced image search. Its routes
 *  are registered via the registry (see apps/server/src/projects/index.ts);
 *  its rich view + immersive home come from web.ts. */
export const project: ProjectServerModule = {
  name: "lecture",
  // A starter with no files to scaffold — a lecture project starts empty and
  // the lecturer fills it with course/week folders. The category routes its
  // create-flow + opens it to the lecture view (see web.ts resolveHome).
  starter: { id: "lecture", category: "lecture" },
  // The lecture-brief run template (the create-&-run brief generator), merged
  // into core's template list at boot via the registry.
  templates: [lectureBriefTemplate],
};

export { lectureRoutes } from "./server/routes.js";
