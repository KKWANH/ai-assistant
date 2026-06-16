import type { ProjectWebModule } from "@ariadne/shared";

export const project: ProjectWebModule = {
  name: "budget",
  starterCard: {
    id: "budget",
    icon: "Wallet",
    labelKey: "workspace.dialog.starterBudget",
    descKey: "workspace.dialog.starterBudgetDesc",
  },
  // Per-project chat starters — what a finance/asset chat is usually for.
  chatStarters: (ws) =>
    ws.category === "finance"
      ? [
          { label: "자산 요약", prompt: "내 포트폴리오와 자산 현황을 요약해줘." },
          { label: "자산 배분 점검", prompt: "현재 자산 배분이 적절한지 점검해줘." },
          { label: "수익률 분석", prompt: "최근 수익률과 손익을 분석해줘." },
          { label: "지출 점검", prompt: "이번 달 지출을 점검하고 줄일 곳을 찾아줘." },
        ]
      : null,
};
