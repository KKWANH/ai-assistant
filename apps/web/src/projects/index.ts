/**
 * Web-side project registry.
 *
 * Statically imports every example project's web contribution from
 * `projects/<name>/`. The create dialog builds its cards from this list, the
 * router spreads PROJECT_ROUTES, and the sidebar asks resolveProjectHome where
 * a workspace opens — so core doesn't hardcode any vertical. See
 * `projects/README.md`.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Wallet, BookOpen, ChefHat, Code2, ClipboardList, Microscope, GraduationCap, FileText } from "lucide-react";
import type { ProjectWebModule, ProjectStarterCard, Workspace } from "@ariadne/shared";
import { project as budget } from "@projects/budget/web";
import { project as reading } from "@projects/reading/web";
import { project as chefbook } from "@projects/chefbook/web";
import { project as code } from "@projects/code/web";
import { project as decisions } from "@projects/decisions/web";
import { project as papers } from "@projects/papers/web";
import { project as lecture } from "@projects/lecture/web";
import { lectureRoutes } from "@projects/lecture/web/routes";

export const WEB_PROJECTS: ProjectWebModule[] = [
  budget,
  reading,
  chefbook,
  code,
  decisions,
  papers,
  lecture,
];

/** Lucide icons projects may name (string keeps lucide out of shared). */
const ICONS: Record<string, LucideIcon> = {
  Wallet,
  BookOpen,
  ChefHat,
  Code2,
  ClipboardList,
  Microscope,
  GraduationCap,
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

/** Where a workspace opens on entry, if a project claims it (else null). */
export function resolveProjectHome(ws: Workspace): string | null {
  for (const p of WEB_PROJECTS) {
    const home = p.resolveHome?.(ws);
    if (home) return home;
  }
  return null;
}

/** Project-contributed React routes, spread into the app router. */
export const PROJECT_ROUTES: { path: string; element: ReactNode }[] = [...lectureRoutes];
