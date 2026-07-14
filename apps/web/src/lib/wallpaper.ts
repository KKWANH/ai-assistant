/**
 * Wallpaper presets — the "background/theme" the glass nav layer frosts
 * against. Glass has nothing to refract over a flat opaque canvas, so a subtle
 * ambient gradient behind the shell is what makes the sidebar / top bar / composer
 * read as glass (and pick up a tint). All presets are dark (the app is dark-first;
 * the default is a near-black midnight). Each preset also carries a pale LIGHT
 * variant (cssLight), applied when the theme is light, so a dark wallpaper never
 * clashes with a light UI.
 *
 * Applied by writing `--wallpaper` on :root; body is `background: var(--wallpaper, …)`.
 */
export interface Wallpaper {
  key: string;
  label: string;
  /** Dark-mode background. */
  css: string;
  /** Light-mode background (a pale tint of the same hue). */
  cssLight: string;
  /** Swatch shown in the picker (a small representative fill). */
  swatch: string;
}

export const WALLPAPERS: Wallpaper[] = [
  { key: "midnight", label: "미드나잇", css: "radial-gradient(130% 120% at 12% -12%, rgb(30 31 48), rgb(9 9 13) 58%)", cssLight: "radial-gradient(130% 120% at 12% -12%, rgb(233 234 246), rgb(247 247 250) 58%)", swatch: "linear-gradient(135deg, rgb(30 31 48), rgb(9 9 13))" },
  { key: "graphite", label: "그래파이트", css: "radial-gradient(130% 120% at 12% -12%, rgb(36 36 42), rgb(9 9 11) 60%)", cssLight: "radial-gradient(130% 120% at 12% -12%, rgb(238 238 241), rgb(248 248 249) 60%)", swatch: "linear-gradient(135deg, rgb(36 36 42), rgb(9 9 11))" },
  { key: "ocean", label: "오션", css: "radial-gradient(130% 120% at 12% -12%, rgb(12 44 70), rgb(4 9 18) 60%)", cssLight: "radial-gradient(130% 120% at 12% -12%, rgb(219 235 248), rgb(244 249 252) 60%)", swatch: "linear-gradient(135deg, rgb(14 52 82), rgb(4 9 18))" },
  { key: "violet", label: "바이올렛", css: "radial-gradient(130% 120% at 12% -12%, rgb(42 20 70), rgb(10 6 20) 60%)", cssLight: "radial-gradient(130% 120% at 12% -12%, rgb(238 228 250), rgb(249 246 253) 60%)", swatch: "linear-gradient(135deg, rgb(48 22 80), rgb(10 6 20))" },
  { key: "aurora", label: "오로라", css: "linear-gradient(135deg, rgb(10 40 54), rgb(22 20 60) 52%, rgb(44 20 62))", cssLight: "linear-gradient(135deg, rgb(221 240 244), rgb(232 230 250) 52%, rgb(245 231 247))", swatch: "linear-gradient(135deg, rgb(12 46 62), rgb(24 22 66) 50%, rgb(48 22 66))" },
  { key: "black", label: "순수 블랙", css: "#000000", cssLight: "#ffffff", swatch: "#000000" },
];

export const DEFAULT_WALLPAPER = "midnight";

/** Set the `--wallpaper` override on :root, using the theme-appropriate variant
 *  (a pale tint in light mode so a dark preset never clashes with a light UI). */
export function applyWallpaper(key: string, theme: "dark" | "light"): void {
  const wp = WALLPAPERS.find((w) => w.key === key) ?? WALLPAPERS[0];
  if (wp) {
    document.documentElement.style.setProperty("--wallpaper", theme === "light" ? wp.cssLight : wp.css);
  }
}
