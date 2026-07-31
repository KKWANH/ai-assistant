import type { ProjectWebModule } from "@ariadne/shared";

export const project: ProjectWebModule = {
  name: "lecture",
  starterCard: {
    id: "lecture",
    icon: "GraduationCap",
    labelKey: "workspace.dialog.starterLecture",
    descKey: "workspace.dialog.starterLectureDesc",
  },
  // Lecture projects open straight to their lecture view (the immersive home).
  // Short readable path (see web/lectureRoute.ts) — the sidebar is where most
  // lecture links originate, so it should hand out the shareable form.
  resolveHome: (ws) =>
    ws.category === "lecture" ? `/lecture/${ws.name.trim().replace(/[/\\]+/g, "-").replace(/\s+/g, "-")}` : null,
  // Per-project chat starters — what a lecture-prep chat is usually for.
  chatStarters: (ws) =>
    ws.category === "lecture"
      ? [
          { label: "이번 주차 요약", prompt: "이번 주차 강의 자료의 핵심을 요약해줘." },
          { label: "슬라이드 개요", prompt: "이번 주차 내용으로 강의 슬라이드 개요를 잡아줘." },
          { label: "퀴즈 만들기", prompt: "이 자료로 학생 퀴즈 10문제를 만들어줘." },
          { label: "핵심 개념 설명", prompt: "이 자료의 핵심 개념을 학생 눈높이로 설명해줘." },
        ]
      : null,
};
