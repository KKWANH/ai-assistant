import type { Template } from "@ariadne/shared";

/**
 * The lecture-brief run template — owned by the lecture project and contributed
 * to core's "create & run" list through the project registry (server.ts →
 * registry → registerProjectTemplates at boot). Core's BUILTIN_TEMPLATES no
 * longer carries it.
 *
 * NOTE (pre-existing, preserved): category is "research", not "lecture", so it
 * surfaces in research-category workspaces — NOT the lecture-category
 * workspaces the lecture starter creates. That mismatch predates this move and
 * is kept as-is to keep the refactor behavior-preserving; whether the brief
 * should be gated to category "lecture" instead is a product call.
 */
export const lectureBriefTemplate: Template = {
  id: "lecture-brief",
  name: "강의 브리프",
  description: "강의 노트와 자료를 근거로, 출처가 연결된 강의 준비 브리프를 생성합니다.",
  builtin: true,
  category: "research",
  inputs: [
    {
      key: "topic",
      type: "string",
      label: "강의 주제",
      required: true,
      placeholder: "예: 뉴미디어 조각과 장소 특정성",
    },
    {
      key: "duration",
      type: "string",
      label: "강의 시간",
      required: false,
      default: "90분",
      placeholder: "예: 60분",
    },
    {
      key: "audience",
      type: "string",
      label: "대상",
      required: false,
      default: "학부생",
      placeholder: "예: 대학원 세미나",
    },
  ],
  outputContract: {
    sections: [
      "요약",
      "학습 목표",
      "핵심 개념",
      "강의 흐름",
      "근거 있는 주장",
      "근거 없는 주장",
      "누락된 정보",
      "다음 할 일",
    ],
  },
  evidenceRequired: true,
  unsupportedClaimsRequired: true,
  rerunDiffRequired: true,
  promptHint:
    "Structure the output as a lecture plan. Identify concepts that lack source support. Write the brief in Korean.",
};
