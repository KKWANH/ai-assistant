/**
 * Lecture-prep web routes, contributed to the app router via the registry
 * (apps/web/src/projects/index.ts spreads these into <Routes>). The component
 * is lazy so the lecture bundle only loads when a lecture project is opened.
 */
import { lazy } from "react";

const LectureView = lazy(() =>
  import("./LectureView").then((m) => ({ default: m.LectureView })),
);

export const lectureRoutes = [
  { path: "/workspaces/:id/lecture", element: <LectureView /> },
];
