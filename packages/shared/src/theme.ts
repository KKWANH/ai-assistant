/**
 * THEME_TOKENS — the single source of truth for Ariadne's theme colours.
 *
 * Values are space-separated RGB triples (consumed as `rgb(var(--token))`).
 * Both the web app's token CSS and the custom-surface iframe host derive
 * their CSS custom properties from this object, so the surface and the main
 * app share one identical theme system.
 *
 * Light mode is intentionally a warm, low-chroma off-white (not pure white)
 * for a calmer, eye-friendly inner UI.
 */

export type ThemeMode = "dark" | "light";

export type ThemeTokens = Record<string, string>;

export const THEME_TOKENS: Record<ThemeMode, ThemeTokens> = {
  dark: {
    background: "14 14 16",
    foreground: "228 228 231",
    "surface-1": "20 20 24",
    "surface-2": "26 26 31",
    "surface-3": "33 33 39",
    card: "24 24 29",
    "card-foreground": "228 228 231",
    muted: "39 39 46",
    "muted-foreground": "138 138 150",
    border: "39 39 46",
    "border-strong": "63 63 74",
    ring: "99 102 241",
    accent: "99 102 241",
    "accent-foreground": "255 255 255",
    success: "34 197 94",
    "success-foreground": "240 253 244",
    warning: "234 179 8",
    "warning-foreground": "254 252 232",
    destructive: "239 68 68",
    "destructive-foreground": "254 242 242",
    info: "59 130 246",
    "info-foreground": "239 246 255",
    sidebar: "17 17 21",
    "sidebar-foreground": "212 212 216",
    "sidebar-border": "33 33 39",
    topbar: "17 17 21",
    "topbar-foreground": "228 228 231",
    "topbar-border": "33 33 39",
    inspector: "20 20 24",
    "inspector-border": "33 33 39",
  },
  light: {
    background: "243 241 237",
    foreground: "28 28 31",
    "surface-1": "248 246 242",
    "surface-2": "239 238 233",
    "surface-3": "232 231 226",
    card: "248 246 242",
    "card-foreground": "28 28 31",
    muted: "234 233 228",
    "muted-foreground": "110 110 120",
    border: "223 222 217",
    "border-strong": "196 195 189",
    ring: "99 102 241",
    accent: "99 102 241",
    "accent-foreground": "255 255 255",
    success: "22 163 74",
    "success-foreground": "240 253 244",
    warning: "202 138 4",
    "warning-foreground": "254 252 232",
    destructive: "220 38 38",
    "destructive-foreground": "254 242 242",
    info: "37 99 235",
    "info-foreground": "239 246 255",
    sidebar: "238 236 231",
    "sidebar-foreground": "39 39 42",
    "sidebar-border": "223 222 217",
    topbar: "248 246 242",
    "topbar-foreground": "28 28 31",
    "topbar-border": "223 222 217",
    inspector: "243 241 237",
    "inspector-border": "223 222 217",
  },
};

/** Render a theme's tokens as `--name: r g b;` CSS declarations. */
export function themeTokensToCss(mode: ThemeMode): string {
  return Object.entries(THEME_TOKENS[mode])
    .map(([k, v]) => `--${k}: ${v};`)
    .join(" ");
}
