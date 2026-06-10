import type { ProjectServerModule } from "@ariadne/shared";
import * as t from "./template.js";

/** Decisions log — PRDs + ADRs + open questions in one folder, with a
 *  weekly-digest schedule and an agent-staged ADR action. */
export const project: ProjectServerModule = {
  name: "decisions",
  starter: {
    id: "decisions",
    category: "decisions",
    files: {
      "README.md": t.DECISIONS_README,
      "prd/workspace-search.md": t.PRD_SAMPLE,
      "decisions/ADR-001-sqlite.md": t.ADR_001,
      "decisions/ADR-002-tree-sitter.md": t.ADR_002,
      "open-questions.md": t.OPEN_QUESTIONS,
    },
    surface: t.SURFACE_TSX,
    actions: t.ACTIONS_YAML,
  },
};
