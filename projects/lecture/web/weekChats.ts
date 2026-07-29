/**
 * A week's conversations.
 *
 * A chat belongs to a week through the core `scope` key (`lecture:<course>/<week>`)
 * — so a week page can OPEN what already exists instead of spawning a new chat on
 * every click, which is what produced duplicate (and empty) threads before.
 *
 * Chats created before `scope` existed carry none. They're matched by the title
 * convention the old view wrote (`<course> · <week>`) — read-only, so existing
 * conversations still surface on their week without rewriting anyone's data.
 */
import { useMemo } from "react";
import type { Chat } from "@ariadne/shared";
import { useChats } from "@ariadne/web/src/lib/queries";

/** The scope key a week's chats carry. Opaque to core. */
export const weekScope = (course: string, week: string) => `lecture:${course}/${week}`;

/** The title the pre-scope view used — the legacy match, and still the title we
 *  give new chats so the sidebar reads the same. */
export const weekTitle = (course: string, week: string) => `${course} · ${week}`;

/** Does this chat belong to the given week (by scope, or legacy title)? */
function belongsToWeek(c: Chat, workspaceId: string, course: string, week: string): boolean {
  if (c.workspaceId !== workspaceId) return false;
  if (c.scope) return c.scope === weekScope(course, week);
  return c.title === weekTitle(course, week);
}

/** This week's chats, newest first. */
export function useWeekChats(workspaceId: string, course: string, week: string): Chat[] {
  const { data: chats } = useChats();
  return useMemo(
    () =>
      (chats ?? [])
        .filter((c) => belongsToWeek(c, workspaceId, course, week))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [chats, workspaceId, course, week],
  );
}

/** How many chats belong to each course (any of its weeks) — `{ [course]: n }`,
 *  so the index can show which courses are actually live. */
export function useCourseChatTotals(
  workspaceId: string,
  courses: string[],
): Record<string, number> {
  const { data: chats } = useChats();
  return useMemo(() => {
    const out: Record<string, number> = {};
    for (const course of courses) {
      const prefix = `${weekScope(course, "")}`; // "lecture:<course>/"
      const legacyPrefix = `${course} · `;
      out[course] = (chats ?? []).filter(
        (c) =>
          c.workspaceId === workspaceId &&
          (c.scope ? c.scope.startsWith(prefix) : c.title.startsWith(legacyPrefix)),
      ).length;
    }
    return out;
  }, [chats, workspaceId, courses]);
}

/** How many chats each week of a course has — `{ [weekName]: count }`, so the
 *  course page can show activity without one query per week. */
export function useCourseChatCounts(
  workspaceId: string,
  course: string,
  weeks: string[],
): Record<string, number> {
  const { data: chats } = useChats();
  return useMemo(() => {
    const out: Record<string, number> = {};
    for (const w of weeks) {
      out[w] = (chats ?? []).filter((c) => belongsToWeek(c, workspaceId, course, w)).length;
    }
    return out;
  }, [chats, workspaceId, course, weeks]);
}
