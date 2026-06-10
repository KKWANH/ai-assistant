import type { ProjectServerModule } from "@ariadne/shared";
import * as t from "./template.js";

/** Reading library — track books/articles with status, ratings, and a
 *  reading-pace chart, from a single library.csv. */
export const project: ProjectServerModule = {
  name: "reading",
  starter: {
    id: "reading",
    category: "research",
    files: { "library.csv": t.LIBRARY_CSV },
    surface: t.SURFACE_TSX,
  },
};
