import type { ProjectServerModule } from "@ariadne/shared";
import * as t from "./template.js";

/** Budget tracker — an example workspace: an income/expense dashboard with
 *  cashflow + savings-rate charts, driven by a single budget.csv. */
export const project: ProjectServerModule = {
  name: "budget",
  starter: {
    id: "budget",
    category: "finance",
    files: { "budget.csv": t.BUDGET_CSV },
    surface: t.SURFACE_TSX,
  },
};
