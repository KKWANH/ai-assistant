/**
 * Lecture-prep structure — reads a semester workspace as a folder tree:
 *
 *   <workspace root>/                 ← one semester (e.g. "2026-1학기")
 *     <Course>/                       ← top-level folder = a course
 *       <syllabus / course files>     ← loose files at the course root
 *       <Week>/                       ← second-level folder = a week
 *         <materials…>                ← files in the week = its materials
 *
 * The structure is "just folders" (decision A), read live from disk so it
 * reflects the current state without waiting for a re-scan. The lecture-prep
 * surface renders this; the chat/PPT/script steps fill the week folders.
 */
import fs from "node:fs";
import path from "node:path";
import { safeResolveUnderRoot } from "../security/pathGuard.js";

export interface LectureMaterial {
  name: string;
  /** Path relative to the workspace root. */
  path: string;
  ext: string;
}

export interface LectureWeek {
  name: string;
  path: string;
  materials: LectureMaterial[];
}

export interface LectureCourse {
  name: string;
  path: string;
  /** Loose files at the course root (syllabus, course memo, …). */
  files: LectureMaterial[];
  weeks: LectureWeek[];
}

export interface LectureStructure {
  courses: LectureCourse[];
}

/** Folders that are never a course (app/system dirs). */
const SKIP_DIRS = new Set([".ariadne", ".git", "node_modules", "__pycache__"]);

function isHidden(name: string): boolean {
  return name.startsWith(".");
}

function listDirs(abs: string): string[] {
  try {
    return fs
      .readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !isHidden(e.name) && !SKIP_DIRS.has(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function listFiles(abs: string, rel: string): LectureMaterial[] {
  try {
    return fs
      .readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isFile() && !isHidden(e.name))
      .map((e) => ({
        name: e.name,
        path: rel ? `${rel}/${e.name}` : e.name,
        ext: path.extname(e.name).slice(1).toLowerCase(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** Parse a semester workspace's folder tree into courses → weeks → materials. */
export function getLectureStructure(rootPath: string): LectureStructure {
  const root = path.resolve(rootPath);
  const courses: LectureCourse[] = listDirs(root).map((courseName) => {
    const courseAbs = path.join(root, courseName);
    const weeks: LectureWeek[] = listDirs(courseAbs).map((weekName) => {
      const weekRel = `${courseName}/${weekName}`;
      return {
        name: weekName,
        path: weekRel,
        materials: listFiles(path.join(courseAbs, weekName), weekRel),
      };
    });
    return {
      name: courseName,
      path: courseName,
      files: listFiles(courseAbs, courseName),
      weeks,
    };
  });
  return { courses };
}

/**
 * Create a course (and optionally a week inside it) under the workspace root.
 * Confined under the root via safeResolveUnderRoot. Drops a `.gitkeep` so the
 * empty folder survives and is visible. Returns the created relative path.
 */
export function scaffoldLectureFolder(
  rootPath: string,
  course: string,
  week?: string,
): { path: string } {
  const rel = week ? `${sanitize(course)}/${sanitize(week)}` : sanitize(course);
  const abs = safeResolveUnderRoot(path.resolve(rootPath), rel);
  if (!abs) throw new Error("Unsafe folder name");
  fs.mkdirSync(abs, { recursive: true });
  // Keep the folder non-empty so it persists and shows up.
  const keep = path.join(abs, ".gitkeep");
  if (!fs.existsSync(keep)) fs.writeFileSync(keep, "");
  return { path: rel };
}

/** A folder name segment is one path part — strip separators + edge dots. */
function sanitize(name: string): string {
  const cleaned = name.replace(/[/\\]/g, " ").replace(/^\.+|\.+$/g, "").trim();
  if (!cleaned) throw new Error("Empty folder name");
  return cleaned;
}
