import type { ProjectServerModule } from "@ariadne/shared";
import * as t from "./template.js";

/** Code project — a tiny TypeScript project plus an edit-file demo action
 *  that exercises the safe staged-diff workflow. */
export const project: ProjectServerModule = {
  name: "code",
  starter: {
    id: "code",
    category: "code",
    files: {
      "README.md": t.README_MD,
      "package.json": t.PACKAGE_JSON,
      "src/index.ts": t.INDEX_TS,
      "src/utils.ts": t.UTILS_TS,
    },
    surface: t.SURFACE_TSX,
    actions: t.ACTIONS_YAML,
  },
};
