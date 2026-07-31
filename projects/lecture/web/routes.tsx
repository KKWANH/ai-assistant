/**
 * Lecture-prep web routes, contributed to the app router via the registry
 * (apps/web/src/projects/index.ts spreads these into <Routes>, inside AppShell —
 * so these pages keep the normal chrome). Components are lazy so the lecture
 * bundle only loads when a lecture project is opened.
 *
 * Three levels, because a semester is three levels deep:
 *   /lecture/:ws                    → the courses
 *   /lecture/:ws/:course            → one course's weeks
 *   /lecture/:ws/:course/:week      → ONE WEEK — its chats, materials, outputs
 * The week page is the unit the work actually happens in; without it there was
 * nowhere to hang a week's existing conversations or its generated files.
 *
 * Each level is registered TWICE: the short readable form above (used by every
 * in-app link and by anything you'd paste to someone) and the original
 * `/workspaces/:id/lecture/c/:course/w/:week`, so links already shared — and
 * the workspace shell's own "screen" tab, which lives under /workspaces/:id —
 * keep working. See lectureRoute.ts for how a slug resolves to a workspace.
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
  // Short, readable — what the app links to.
  { path: "/lecture/:ws", element: <LectureView /> },
  { path: "/lecture/:ws/:course", element: <CourseView /> },
  { path: "/lecture/:ws/:course/:week", element: <WeekView /> },
  // Original — kept so previously shared links still resolve.
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
