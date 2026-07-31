/**
 * Readable lecture URLs.
 *
 * The canonical form was
 *   /workspaces/8541611e-eb48-4ce3-a5df-a9d3ef2afae1/lecture/c/2026-2%20조형예술론2/w/0주차%20강의설계
 * — a UUID nobody can read, plus %20 for every space. Shared links were
 * unreadable and awkward to paste. The short form is
 *   /lecture/강의-준비/2026-2-조형예술론2/0주차-강의설계
 *
 * Resolution is entirely CLIENT-side: the workspace list is already loaded, so
 * a slug can be matched against it without a server column, a migration, or
 * touching the dozens of routes that take a workspace id. The old URLs keep
 * working — both shapes render the same components.
 */
import { useParams } from "react-router-dom";
import type { Workspace } from "@ariadne/shared";
import { useWorkspaces } from "@ariadne/web/src/lib/queries";

/** Name → URL segment. Spaces become hyphens; Hangul is left alone (browsers
 *  display it as-is, and percent-encoding it is what made the URL unreadable).
 *  Slashes would split the path, so they collapse to a hyphen too. */
export function slugify(name: string): string {
  return name.trim().replace(/[/\\]+/g, "-").replace(/\s+/g, "-");
}

/** Does this URL segment refer to that name? Accepts the slug and the literal
 *  name, so links written either way (including old ones) still resolve. */
function matches(segment: string, name: string): boolean {
  const s = decodeURIComponent(segment);
  return s === name || s === slugify(name);
}

/** Find a name in a list from its URL segment. */
export function resolveName(segment: string | undefined, names: string[]): string | undefined {
  if (!segment) return undefined;
  return names.find((n) => matches(segment, n));
}

/** The workspace a lecture URL refers to — by id (old form) or slug (short). */
export function resolveWorkspace(
  workspaces: Workspace[] | undefined,
  idOrSlug: string | undefined,
): Workspace | undefined {
  if (!idOrSlug || !workspaces) return undefined;
  const decoded = decodeURIComponent(idOrSlug);
  return (
    workspaces.find((w) => w.id === decoded) ??
    workspaces.find((w) => slugify(w.name) === decoded || w.name === decoded)
  );
}

/**
 * The workspace id + raw course/week segments for either URL shape.
 * `ready` is false only while the workspace list is still loading, so a page
 * can tell "not loaded yet" from "no such workspace".
 */
export function useLectureParams(): {
  workspaceId: string;
  courseSegment?: string;
  weekSegment?: string;
  ready: boolean;
} {
  // Old: /workspaces/:id/lecture/c/:course/w/:week — short: /lecture/:ws/:course/:week
  const { id, ws, course, week } = useParams<{
    id?: string;
    ws?: string;
    course?: string;
    week?: string;
  }>();
  const { data: workspaces, isLoading } = useWorkspaces();
  if (id) return { workspaceId: id, courseSegment: course, weekSegment: week, ready: true };
  const found = resolveWorkspace(workspaces, ws);
  return {
    workspaceId: found?.id ?? "",
    courseSegment: course,
    weekSegment: week,
    ready: !isLoading,
  };
}

/* ── Link builders — every in-app link uses the short, readable form ────── */

export const lectureHomePath = (wsName: string): string => `/lecture/${slugify(wsName)}`;

export const coursePath = (wsName: string, course: string): string =>
  `/lecture/${slugify(wsName)}/${slugify(course)}`;

export const weekPath = (wsName: string, course: string, week: string): string =>
  `/lecture/${slugify(wsName)}/${slugify(course)}/${slugify(week)}`;
