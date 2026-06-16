/**
 * Lecture-prep web routes, contributed to the app router via the registry
 * (apps/web/src/projects/index.ts spreads these into <Routes>). The component
 * is lazy so the lecture bundle only loads when a lecture project is opened.
 */
import { lazy } from "react";
import type { ReactElement } from "react";
import type { Workspace } from "@ariadne/shared";

const LectureView = lazy(() =>
  import("./LectureView").then((m) => ({ default: m.LectureView })),
);

export const lectureRoutes = [
  { path: "/workspaces/:id/lecture", element: <LectureView /> },
];

/** The lecture home, rendered INSIDE the workspace shell (the screen tab) rather
 *  than only as a separate full-page route — so a lecture workspace gets the same
 *  chrome (chats / data / edit) as every other workspace. LectureView reads the
 *  id from the route (`/workspaces/:id`), which the shell is already under. */
export function lectureHome(ws: Workspace): ReactElement | null {
  return ws.category === "lecture" ? <LectureView /> : null;
}
