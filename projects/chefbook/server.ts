import type { ProjectServerModule } from "@ariadne/shared";
import * as t from "./template.js";

/** Chefbook — a kitchen tracker: ingredients with expiry, tools, and a
 *  calorie-tagged recipe book, from three CSVs. */
export const project: ProjectServerModule = {
  name: "chefbook",
  starter: {
    id: "chefbook",
    category: "cooking",
    files: {
      "ingredients.csv": t.INGREDIENTS_CSV,
      "tools.csv": t.TOOLS_CSV,
      "recipes.csv": t.RECIPES_CSV,
    },
    surface: t.SURFACE_TSX,
  },
};
