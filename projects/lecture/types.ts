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

/* ------------------------------------------------------------------ *
 * Exam — a generated test plus a coverage audit (MW2). The two are
 * produced on different model tiers: items on the workhorse (F), the
 * audit on the strong model (F+), since auditing the whole exam against
 * the corpus is the reasoning-heavy step.
 * ------------------------------------------------------------------ */

export type ExamItemType = "객관식" | "단답" | "서술";
export type ExamDifficulty = "기초" | "심화" | "응용";

export interface ExamItem {
  type: ExamItemType;
  question: string;
  /** Options for 객관식 items; absent for 단답/서술. */
  choices?: string[];
  /** Correct answer, or a model-answer outline for 서술. */
  answer: string;
  difficulty: ExamDifficulty;
  /** The single concept this item tests — links it to the coverage map. */
  concept: string;
}

export interface Exam {
  title: string;
  items: ExamItem[];
}

/** One concept the materials teach, and whether the exam tests it. */
export interface CoverageConcept {
  concept: string;
  tested: boolean;
  itemCount: number;
}

/** The strong-tier audit of an exam against the materials it came from. */
export interface CoverageReport {
  concepts: CoverageConcept[];
  /** Items testing something the materials don't actually cover (미설명 개념). */
  untaught: { question: string; reason: string }[];
  summary: string;
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
