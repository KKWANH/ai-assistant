/**
 * Lecture-prep web API client. Moved out of core api.ts with the vertical.
 * Uses the core `request` helper; types come from the lecture project's own
 * types module.
 */
import { request } from "@ariadne/web/src/lib/api";
import type { Deck, Exam, CoverageReport, LectureStructure } from "../types.js";

export const getLectureStructure = (id: string) =>
  request<LectureStructure>("GET", `/workspaces/${id}/lecture`);

export const scaffoldLectureFolder = (id: string, course: string, week?: string) =>
  request<{ path: string }>("POST", `/workspaces/${id}/lecture/folder`, { course, week });

export const generateDeck = (id: string, topic: string, course?: string, week?: string) =>
  request<{ deck: Deck; fileName: string }>("POST", `/workspaces/${id}/deck`, {
    topic,
    course,
    week,
  });

/** Generate an exam from a course/week's materials + audit its coverage. */
export const generateExam = (id: string, course?: string, week?: string, count?: number) =>
  request<{ exam: Exam; coverage: CoverageReport; fileName: string }>(
    "POST",
    `/workspaces/${id}/exam`,
    { course, week, count },
  );

export const setCourseMemo = (id: string, course: string, memo: string) =>
  request<{ ok: true }>("POST", `/workspaces/${id}/lecture/memo`, { course, memo });

export const generateScript = (id: string, deck: Deck, course?: string) =>
  request<{ fileName: string }>("POST", `/workspaces/${id}/script`, { deck, course });

/** Rebuild a deck's .pptx after picking per-slide images (embeds them). */
export const rebuildDeck = (id: string, deck: Deck) =>
  request<{ fileName: string }>("POST", `/workspaces/${id}/deck-rebuild`, { deck });

export const deckFileUrl = (id: string, fileName: string) =>
  `/api/workspaces/${id}/deck-file?name=${encodeURIComponent(fileName)}`;
