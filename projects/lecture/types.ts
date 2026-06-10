/**
 * Lecture-prep types. These used to live in @ariadne/shared; they moved here
 * with the rest of the lecture vertical so core carries no lecture-specific
 * shapes. Both the server (deck/script/folder code) and the web (LectureView,
 * DeckPreview) import from here.
 */

export interface DeckSlide {
  title: string;
  bullets: string[];
  notes?: string;
  /** English image-search terms for one supporting image (or empty). */
  imageQuery?: string;
  /** Full-resolution URL of an image the lecturer picked for this slide —
   *  embedded into the .pptx on rebuild. */
  imageUrl?: string;
  /** Attribution shown under a picked image (source · creator). */
  imageCredit?: string;
}

export interface Deck {
  title: string;
  subtitle?: string;
  slides: DeckSlide[];
}

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
  /** The course's fixed thread + teaching style + student level. Injected
   *  into every deck generated for this course so they stay consistent. */
  memo: string;
}
export interface LectureStructure {
  courses: LectureCourse[];
}
