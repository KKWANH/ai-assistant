import type { ProjectServerModule } from "@ariadne/shared";
import * as t from "./template.js";

/** Research papers — a personal paper library: notes + .bib + a reading
 *  queue, with an inbound-citation count and dangling-citation audit. */
export const project: ProjectServerModule = {
  name: "papers",
  starter: {
    id: "papers",
    category: "research",
    files: {
      "README.md": t.PAPERS_README,
      "papers/notes/Smith24-rag-survey.md": t.NOTES_SMITH24,
      "papers/notes/Park23-hybrid-retrieval.md": t.NOTES_PARK23,
      "papers/notes/Lee24-graph-rag.md": t.NOTES_LEE24,
      "references.bib": t.REFERENCES_BIB,
      "reading-queue.md": t.READING_QUEUE,
    },
    surface: t.SURFACE_TSX,
    actions: t.ACTIONS_YAML,
  },
};
