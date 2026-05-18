import type { ThemeName, ThemeTokens } from "./tokens";

export const themes: Record<Exclude<ThemeName, "system">, ThemeTokens> = {
  "aiws-dark": {
    label: "AIWS Dark",
    colorScheme: "dark",
    description: "기존 AIWS 정체성을 유지하되 파란 glow를 줄인 기본 테마.",
  },
  "t3-code-dark": {
    label: "T3 Code Dark",
    colorScheme: "dark",
    description: "macOS/code-agent 느낌의 조밀하고 차분한 dark 테마.",
  },
  "notion-light": {
    label: "Notion Light",
    colorScheme: "light",
    description: "문서/워크스페이스 중심의 밝고 중립적인 테마.",
  },
  "notion-dark": {
    label: "Notion Dark",
    colorScheme: "dark",
    description: "파란색을 줄이고 중립 계열을 강조한 dark 문서 테마.",
  },
};

export function resolveSystemTheme(): Exclude<ThemeName, "system"> {
  if (globalThis.matchMedia?.("(prefers-color-scheme: light)").matches) return "notion-light";
  return "t3-code-dark";
}
