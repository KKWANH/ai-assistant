/**
 * Lecture-prep web routes, contributed to the app router via the registry
 * (apps/web/src/projects/index.ts spreads these into <Routes>, inside AppShell —
 * so these pages keep the normal chrome). Components are lazy so the lecture
 * bundle only loads when a lecture project is opened.
 *
 * Three levels, because a semester is three levels deep:
 *   /lecture                        → the courses
 *   /lecture/c/:course              → one course's weeks
 *   /lecture/c/:course/w/:week      → ONE WEEK — its chats, materials, outputs
 * The week page is the unit the work actually happens in; without it there was
 * nowhere to hang a week's existing conversations or its generated files.
 * Course/week names are path segments (encodeURIComponent'd), and the `c`/`w`
 * markers keep a course named "w" from colliding with the week segment.
 */
import { lazy } from "react";
import type { ReactElement } from "react";
import type { Workspace } from "@ariadne/shared";

const LectureView = lazy(() =>
  import("./LectureView").then((m) => ({ default: m.LectureView })),
);
const CourseView = lazy(() => import("./CourseView").then((m) => ({ default: m.CourseView })));
const WeekView = lazy(() => import("./WeekView").then((m) => ({ default: m.WeekView })));

export const lectureRoutes = [
  { path: "/workspaces/:id/lecture", element: <LectureView /> },
  { path: "/workspaces/:id/lecture/c/:course", element: <CourseView /> },
  { path: "/workspaces/:id/lecture/c/:course/w/:week", element: <WeekView /> },
];

/** The lecture home, rendered INSIDE the workspace shell (the screen tab) rather
 *  than only as a separate full-page route — so a lecture workspace gets the same
 *  chrome (chats / data / edit) as every other workspace. LectureView reads the
 *  id from the route (`/workspaces/:id`), which the shell is already under. */
export function lectureHome(ws: Workspace): ReactElement | null {
  return ws.category === "lecture" ? <LectureView /> : null;
}
