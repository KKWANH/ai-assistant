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
  resolveHome: (ws) => (ws.category === "lecture" ? `/workspaces/${ws.id}/lecture` : null),
};
