export const THEME_STORAGE_KEY = "aiws-theme";
export const THEME_VERSION_STORAGE_KEY = "aiws-theme-version";
export const CURRENT_THEME_VERSION = "t3-code-2026-05";

export const themeNames = ["system", "aiws-dark", "t3-code-dark", "notion-light", "notion-dark"] as const;

export type ThemeName = (typeof themeNames)[number];

export type ThemeTokens = {
  label: string;
  colorScheme: "light" | "dark";
  description: string;
};

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && (themeNames as readonly string[]).includes(value);
}
