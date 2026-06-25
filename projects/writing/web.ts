import type { ProjectWebModule } from "@ariadne/shared";

export const project: ProjectWebModule = {
  name: "writing",
  starterCard: {
    id: "writing",
    icon: "PenLine",
    labelKey: "workspace.dialog.starterWriting",
    descKey: "workspace.dialog.starterWritingDesc",
  },
  // What a writing chat is usually for — criticism, transcripts, essays.
  chatStarters: (ws) =>
    ws.category === "writing"
      ? [
          { label: "초고 다듬기", prompt: "이 글의 초고를 논리 흐름과 문장을 다듬어 고쳐줘. 주장은 유지하고 명료성·가독성만 개선해줘." },
          { label: "비평문 구조", prompt: "이 작품/주제에 대한 비평문 개요를 잡아줘 — 핵심 주장, 근거, 예상 반론과 응답, 결론." },
          { label: "강연록 정리", prompt: "이 강연 녹취/메모를 읽기 좋은 글로 정리해줘 — 군더더기 제거, 문단 구성, 핵심 강조." },
          { label: "톤 바꾸기", prompt: "이 글을 더 격식 있는 학술적 톤으로 다시 써줘. 사실과 의미는 그대로 두고 어조만 바꿔줘." },
        ]
      : null,
};
