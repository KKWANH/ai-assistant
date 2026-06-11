/**
 * Lecture project i18n — the copy the lecture starter card and the
 * lecture-brief template label need, owned by the project rather than core.
 *
 * The web i18n registry (apps/web/src/projects/i18n.ts) merges this into the
 * core dictionaries at load, so core's en.ts / ko.ts carry no lecture-specific
 * strings. Pure data with no imports — it stays out of the i18n provider's
 * import graph (which would otherwise cycle: provider → registry → view →
 * provider).
 */
export const lectureMessages: { en: Record<string, string>; ko: Record<string, string> } = {
  en: {
    "workspace.lecturePrep": "Lecture prep",
    "workspace.dialog.starterLecture": "Lecture prep",
    "workspace.dialog.starterLectureDesc":
      "A semester organized as courses → weeks → materials. Opens to the lecture view: research, generate slide decks (.pptx) and scripts (.docx), find sourced images.",
    "template.lecture-brief.name": "Lecture brief",
    "template.lecture-brief.description":
      "Turn lecture notes + materials into a sources-linked study brief.",
  },
  ko: {
    "workspace.lecturePrep": "강의 준비",
    "workspace.dialog.starterLecture": "강의 준비",
    "workspace.dialog.starterLectureDesc":
      "한 학기를 과목 → 주차 → 자료로 정리. 열면 강의 준비 화면 — 리서치, 슬라이드(.pptx)·대본(.docx) 생성, 출처 포함 이미지 검색.",
    "template.lecture-brief.name": "강의 브리핑",
    "template.lecture-brief.description":
      "강의 노트와 자료를 근거로, 출처 연결된 강의 준비 브리핑 생성.",
  },
};
