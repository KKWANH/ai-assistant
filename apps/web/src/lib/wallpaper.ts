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

// Each dark preset is a MULTI-STOP, multi-hue gradient (bright saturated corner
// → mid tone → near-black) so the glass, blurring it, shows real colour
// VARIATION across its surface — that variation is what reads as "glassy" (a
// flat single tone blurs to a flat panel). A second, offset conic-ish accent
// glow adds cross-surface change without floating "orbs".
export const WALLPAPERS: Wallpaper[] = [
  { key: "midnight", label: "미드나잇", css: "radial-gradient(120% 130% at 14% -8%, rgb(46 42 86), rgb(22 24 52) 40%, rgb(6 7 14) 80%), radial-gradient(90% 90% at 92% 8%, rgb(58 30 74), transparent 55%)", cssLight: "radial-gradient(120% 130% at 14% -8%, rgb(226 226 246), rgb(238 238 248) 50%, rgb(250 250 252) 85%)", swatch: "linear-gradient(135deg, rgb(52 40 92), rgb(9 9 14))" },
  { key: "graphite", label: "그래파이트", css: "radial-gradient(120% 130% at 14% -8%, rgb(54 54 66), rgb(26 26 34) 46%, rgb(8 8 11) 84%), radial-gradient(90% 90% at 92% 8%, rgb(40 44 58), transparent 55%)", cssLight: "radial-gradient(120% 130% at 14% -8%, rgb(236 236 240), rgb(244 244 247) 50%, rgb(250 250 251) 85%)", swatch: "linear-gradient(135deg, rgb(56 56 68), rgb(9 9 11))" },
  { key: "ocean", label: "오션", css: "radial-gradient(120% 130% at 14% -8%, rgb(20 78 122), rgb(10 40 72) 42%, rgb(3 9 20) 82%), radial-gradient(90% 90% at 92% 8%, rgb(18 92 96), transparent 55%)", cssLight: "radial-gradient(120% 130% at 14% -8%, rgb(214 234 248), rgb(236 245 251) 50%, rgb(248 251 253) 85%)", swatch: "linear-gradient(135deg, rgb(22 92 120), rgb(4 12 26))" },
  { key: "violet", label: "바이올렛", css: "radial-gradient(120% 130% at 14% -8%, rgb(78 36 122), rgb(42 22 74) 42%, rgb(9 6 20) 82%), radial-gradient(90% 90% at 92% 8%, rgb(122 40 96), transparent 55%)", cssLight: "radial-gradient(120% 130% at 14% -8%, rgb(238 226 250), rgb(246 240 252) 50%, rgb(251 249 253) 85%)", swatch: "linear-gradient(135deg, rgb(96 44 132), rgb(12 6 24))" },
  { key: "aurora", label: "오로라", css: "linear-gradient(135deg, rgb(14 70 86) 0%, rgb(30 34 96) 42%, rgb(78 28 96) 78%, rgb(30 16 40) 100%)", cssLight: "linear-gradient(135deg, rgb(216 240 244), rgb(230 230 250) 45%, rgb(247 230 246))", swatch: "linear-gradient(135deg, rgb(16 78 92), rgb(34 32 100) 50%, rgb(92 34 104))" },
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
