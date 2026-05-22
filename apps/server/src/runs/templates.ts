import type { Template } from "@ariadne/shared";

export const BUILTIN_TEMPLATES: Template[] = [
  {
    id: "research-brief",
    name: "리서치 브리프",
    description:
      "로컬 폴더의 메모·논문·자료를 근거로, 출처가 연결된 리서치 브리프를 생성합니다.",
    builtin: true,
    inputs: [
      {
        key: "topic",
        type: "string",
        label: "리서치 주제",
        required: true,
        placeholder: "예: 현대미술의 장소 특정성",
      },
      {
        key: "audience",
        type: "string",
        label: "대상 독자",
        required: false,
        default: "일반 학술 독자",
        placeholder: "예: 학부생",
      },
      {
        key: "goal",
        type: "text",
        label: "목표 또는 질문",
        required: false,
        placeholder: "이 브리프가 답하거나 보여야 할 것은 무엇인가요?",
      },
    ],
    outputContract: {
      sections: [
        "요약",
        "핵심 발견",
        "근거 있는 주장",
        "위험·불확실성",
        "근거 없는 주장",
        "누락된 정보",
        "다음 할 일",
        "사용한 출처",
      ],
    },
    evidenceRequired: true,
    unsupportedClaimsRequired: true,
    rerunDiffRequired: true,
    promptHint:
      "Focus on accuracy and source grounding. Flag any claim that cannot be directly tied to a selected file. Write the brief in Korean.",
  },

  {
    id: "lecture-brief",
    name: "강의 브리프",
    description: "강의 노트와 자료를 근거로, 출처가 연결된 강의 준비 브리프를 생성합니다.",
    builtin: true,
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
  },

  {
    id: "investment-decision-memo",
    name: "투자 결정 메모",
    description:
      "리서치 노트·재무 자료·시장 데이터를 근거로, 구조화된 투자 결정 메모를 생성합니다.",
    builtin: true,
    inputs: [
      {
        key: "subject",
        type: "string",
        label: "투자 대상",
        required: true,
        placeholder: "예: X사 시리즈 B 라운드",
      },
      {
        key: "thesis",
        type: "text",
        label: "투자 논거",
        required: false,
        placeholder: "이 투자가 좋은 기회인 이유는 무엇인가요?",
      },
      {
        key: "horizon",
        type: "string",
        label: "투자 기간",
        required: false,
        default: "3~5년",
        placeholder: "예: 12개월",
      },
    ],
    outputContract: {
      sections: [
        "핵심 요약",
        "기회 개요",
        "근거 있는 강점",
        "위험·약점",
        "근거 없는 가정",
        "누락된 데이터",
        "결정 권고",
        "사용한 출처",
      ],
    },
    evidenceRequired: true,
    unsupportedClaimsRequired: true,
    rerunDiffRequired: true,
    promptHint:
      "Use conservative language for claims not directly supported by the selected files. Separate opinion from evidence. Write the memo in Korean.",
  },

  {
    id: "job-search-review",
    name: "구직 활동 점검",
    description:
      "로컬 폴더의 메모를 바탕으로 지원 현황·직무 적합도·아웃리치 진행 상황을 요약하고 평가합니다.",
    builtin: true,
    inputs: [
      {
        key: "goal",
        type: "string",
        label: "구직 목표",
        required: true,
        placeholder: "예: 핀테크 시니어 프로덕트 매니저 직무",
      },
      {
        key: "period",
        type: "string",
        label: "점검 기간",
        required: false,
        default: "최근 30일",
        placeholder: "예: 2026년 1분기",
      },
    ],
    outputContract: {
      sections: [
        "요약",
        "지원 현황",
        "주요 기회",
        "패턴·공백",
        "근거 없는 주장",
        "다음 할 일",
        "사용한 출처",
      ],
    },
    evidenceRequired: true,
    unsupportedClaimsRequired: false,
    rerunDiffRequired: true,
    promptHint:
      "Be factual about application status. Do not infer outcomes not recorded in the notes. Write the review in Korean.",
  },

  {
    id: "source-audit",
    name: "출처 점검",
    description:
      "파일 묶음의 출처 품질, 누락 영역, 인용 완전성을 점검합니다.",
    builtin: true,
    inputs: [
      {
        key: "scope",
        type: "string",
        label: "점검 범위",
        required: true,
        placeholder: "예: /research/papers/ 의 모든 자료",
      },
      {
        key: "criteria",
        type: "text",
        label: "품질 기준",
        required: false,
        placeholder: "예: 동료 심사 완료, 2015년 이후, 1차 자료 우선",
      },
    ],
    outputContract: {
      sections: [
        "요약",
        "출처 목록",
        "범위 평가",
        "취약한 출처",
        "누락된 출처 유형",
        "근거 없는 주장",
        "권고 사항",
      ],
    },
    evidenceRequired: true,
    unsupportedClaimsRequired: true,
    rerunDiffRequired: false,
    promptHint:
      "Focus on coverage and credibility. List files that lack proper attribution. Write the audit in Korean.",
  },
];

export function getTemplate(id: string): Template | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}
