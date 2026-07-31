/**
 * Lecture-prep web API client. Moved out of core api.ts with the vertical.
 * Uses the core `request` helper; types come from the lecture project's own
 * types module.
 */
import { request } from "@ariadne/web/src/lib/api";
import type { Deck, Exam, CoverageReport, DocType, GeneratedDoc, LectureStructure } from "../types.js";

export const getLectureStructure = (id: string) =>
  request<LectureStructure>("GET", `/workspaces/${id}/lecture`);

export const scaffoldLectureFolder = (id: string, course: string, week?: string) =>
  request<{ path: string }>("POST", `/workspaces/${id}/lecture/folder`, { course, week });

export const generateDeck = (id: string, topic: string, course?: string, week?: string, sources?: string[]) =>
  request<{ deck: Deck; fileName: string }>("POST", `/workspaces/${id}/deck`, {
    topic,
    course,
    week,
    sources,
  });

/** Generate an exam from a course/week's materials + audit its coverage. */
export const generateExam = (id: string, course?: string, week?: string, count?: number, sources?: string[]) =>
  request<{ exam: Exam; coverage: CoverageReport; fileName: string }>(
    "POST",
    `/workspaces/${id}/exam`,
    { course, week, count, sources },
  );

/** Generate one course deliverable (handout / worksheet / reading / syllabus). */
export const generateDoc = (id: string, type: DocType, course?: string, week?: string, sources?: string[]) =>
  request<{ doc: GeneratedDoc; fileName: string }>("POST", `/workspaces/${id}/document`, {
    type,
    course,
    week,
    sources,
  });

/** Files attached to this week's CHATS — the lecturer's real habit is to attach
 *  a PDF to the conversation, not to drop it in the week folder. */
export interface WeekAttachment {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  kind: "image" | "file";
  chatId: string;
  createdAt: string;
}
export const getWeekAttachments = (id: string, course: string, week: string) =>
  request<{ attachments: WeekAttachment[] }>(
    "GET",
    `/workspaces/${id}/lecture/week-attachments?course=${encodeURIComponent(course)}&week=${encodeURIComponent(week)}`,
  );

export const setCourseMemo = (id: string, course: string, memo: string) =>
  request<{ ok: true }>("POST", `/workspaces/${id}/lecture/memo`, { course, memo });

/** course/week file the .docx alongside the deck it belongs to (see weekRelPath). */
export const generateScript = (id: string, deck: Deck, course?: string, week?: string) =>
  request<{ fileName: string }>("POST", `/workspaces/${id}/script`, { deck, course, week });

/** Rebuild a deck's .pptx after picking per-slide images (embeds them). Passes
 *  course/week so the rebuild overwrites the deck in its week folder rather than
 *  writing a second copy at the workspace root. */
export const rebuildDeck = (id: string, deck: Deck, course?: string, week?: string) =>
  request<{ fileName: string }>("POST", `/workspaces/${id}/deck-rebuild`, { deck, course, week });

export const deckFileUrl = (id: string, fileName: string) =>
  `/api/workspaces/${id}/deck-file?name=${encodeURIComponent(fileName)}`;
