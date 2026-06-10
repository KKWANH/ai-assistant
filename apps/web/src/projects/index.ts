/**
 * Web-side project registry.
 *
 * Statically imports every example project's web contribution from
 * `projects/<name>/`. The create dialog builds its cards from this list, so
 * core doesn't hardcode any vertical's card — see `projects/README.md`.
 */
import type { LucideIcon } from "lucide-react";
import { Wallet, BookOpen, ChefHat, Code2, ClipboardList, Microscope, FileText } from "lucide-react";
import type { ProjectWebModule, ProjectStarterCard } from "@ariadne/shared";
import { project as budget } from "@projects/budget/web";
import { project as reading } from "@projects/reading/web";
import { project as chefbook } from "@projects/chefbook/web";
import { project as code } from "@projects/code/web";
import { project as decisions } from "@projects/decisions/web";
import { project as papers } from "@projects/papers/web";

export const WEB_PROJECTS: ProjectWebModule[] = [
  budget,
  reading,
  chefbook,
  code,
  decisions,
  papers,
];

/** Lucide icons projects may name (string keeps lucide out of shared). */
const ICONS: Record<string, LucideIcon> = {
  Wallet,
  BookOpen,
  ChefHat,
  Code2,
  ClipboardList,
  Microscope,
};

export function resolveProjectIcon(name: string): LucideIcon {
  return ICONS[name] ?? FileText;
}

/** Every project-contributed create-dialog card. */
export function projectStarterCards(): ProjectStarterCard[] {
  return WEB_PROJECTS.map((p) => p.starterCard).filter(
    (c): c is ProjectStarterCard => !!c,
  );
}
