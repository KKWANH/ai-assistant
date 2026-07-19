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

// Each dark preset = several soft radial colour GLOWS (top-left hero + top-right
// accent + a lower glow) fading to transparent over a near-black base. Layering
// glows over a base — rather than one opaque hero gradient that paints the whole
// canvas near-black past its midpoint — keeps real colour VARIATION in every
// region (including the lower half, where the composer + content cards sit), so
// translucent glass surfaces there pick up a tint instead of reading flat. Smooth
// glows only, no hard-edged "orbs". The lower glow is what lets the floating
// composer and the (now more translucent) cards hold colour.
export const WALLPAPERS: Wallpaper[] = [
  { key: "midnight", label: "미드나잇", css: "radial-gradient(92% 78% at 12% -8%, rgb(74 58 140), transparent 55%), radial-gradient(76% 66% at 90% 2%, rgb(100 42 114), transparent 50%), radial-gradient(120% 85% at 66% 116%, rgb(30 52 120), transparent 56%), rgb(8 8 15)", cssLight: "radial-gradient(92% 78% at 12% -8%, rgb(223 218 249), transparent 62%), radial-gradient(76% 66% at 90% 2%, rgb(242 223 246), transparent 58%), radial-gradient(120% 85% at 66% 116%, rgb(220 228 250), transparent 62%), rgb(250 250 252)", swatch: "linear-gradient(135deg, rgb(84 60 148), rgb(9 9 16))" },
  { key: "graphite", label: "그래파이트", css: "radial-gradient(92% 78% at 12% -8%, rgb(70 70 84), transparent 55%), radial-gradient(76% 66% at 90% 2%, rgb(54 58 74), transparent 50%), radial-gradient(120% 85% at 66% 116%, rgb(46 50 64), transparent 56%), rgb(8 8 11)", cssLight: "radial-gradient(92% 78% at 12% -8%, rgb(230 230 236), transparent 62%), radial-gradient(76% 66% at 90% 2%, rgb(232 234 240), transparent 58%), radial-gradient(120% 85% at 66% 116%, rgb(228 230 236), transparent 62%), rgb(250 250 251)", swatch: "linear-gradient(135deg, rgb(64 64 78), rgb(9 9 11))" },
  { key: "ocean", label: "오션", css: "radial-gradient(92% 78% at 12% -8%, rgb(26 98 150), transparent 55%), radial-gradient(76% 66% at 90% 2%, rgb(20 112 118), transparent 50%), radial-gradient(120% 85% at 66% 116%, rgb(16 62 110), transparent 56%), rgb(4 10 20)", cssLight: "radial-gradient(92% 78% at 12% -8%, rgb(212 234 249), transparent 62%), radial-gradient(76% 66% at 90% 2%, rgb(216 244 246), transparent 58%), radial-gradient(120% 85% at 66% 116%, rgb(214 232 250), transparent 62%), rgb(248 251 253)", swatch: "linear-gradient(135deg, rgb(24 100 138), rgb(4 12 26))" },
  { key: "violet", label: "바이올렛", css: "radial-gradient(92% 78% at 12% -8%, rgb(98 46 150), transparent 55%), radial-gradient(76% 66% at 90% 2%, rgb(142 46 110), transparent 50%), radial-gradient(120% 85% at 66% 116%, rgb(56 38 130), transparent 56%), rgb(10 6 20)", cssLight: "radial-gradient(92% 78% at 12% -8%, rgb(236 224 250), transparent 62%), radial-gradient(76% 66% at 90% 2%, rgb(248 226 242), transparent 58%), radial-gradient(120% 85% at 66% 116%, rgb(228 224 250), transparent 62%), rgb(251 249 253)", swatch: "linear-gradient(135deg, rgb(112 48 156), rgb(12 6 24))" },
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
