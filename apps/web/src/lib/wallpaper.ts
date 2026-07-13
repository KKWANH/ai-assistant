/**
 * Wallpaper presets — the "background/theme" the glass nav layer frosts
 * against. Glass has nothing to refract over a flat opaque canvas, so a subtle
 * ambient gradient behind the shell is what makes the sidebar / top bar / composer
 * read as glass (and pick up a tint). All presets are dark (the app is dark-first;
 * the default is a near-black midnight). In LIGHT mode we clear the override so
 * body falls back to its theme-safe token gradient — a dark wallpaper under a
 * light theme would clash.
 *
 * Applied by writing `--wallpaper` on :root; body is `background: var(--wallpaper, …)`.
 */
export interface Wallpaper {
  key: string;
  label: string;
  css: string;
  /** Swatch shown in the picker (a small representative fill). */
  swatch: string;
}

export const WALLPAPERS: Wallpaper[] = [
  { key: "midnight", label: "미드나잇", css: "radial-gradient(130% 120% at 12% -12%, rgb(30 31 48), rgb(9 9 13) 58%)", swatch: "linear-gradient(135deg, rgb(30 31 48), rgb(9 9 13))" },
  { key: "graphite", label: "그래파이트", css: "radial-gradient(130% 120% at 12% -12%, rgb(36 36 42), rgb(9 9 11) 60%)", swatch: "linear-gradient(135deg, rgb(36 36 42), rgb(9 9 11))" },
  { key: "ocean", label: "오션", css: "radial-gradient(130% 120% at 12% -12%, rgb(12 44 70), rgb(4 9 18) 60%)", swatch: "linear-gradient(135deg, rgb(14 52 82), rgb(4 9 18))" },
  { key: "violet", label: "바이올렛", css: "radial-gradient(130% 120% at 12% -12%, rgb(42 20 70), rgb(10 6 20) 60%)", swatch: "linear-gradient(135deg, rgb(48 22 80), rgb(10 6 20))" },
  { key: "aurora", label: "오로라", css: "linear-gradient(135deg, rgb(10 40 54), rgb(22 20 60) 52%, rgb(44 20 62))", swatch: "linear-gradient(135deg, rgb(12 46 62), rgb(24 22 66) 50%, rgb(48 22 66))" },
  { key: "black", label: "순수 블랙", css: "#000000", swatch: "#000000" },
];

export const DEFAULT_WALLPAPER = "midnight";

/** Set (or in light mode, clear) the `--wallpaper` override on :root. */
export function applyWallpaper(key: string, theme: "dark" | "light"): void {
  const root = document.documentElement.style;
  if (theme === "light") {
    root.removeProperty("--wallpaper");
    return;
  }
  const wp = WALLPAPERS.find((w) => w.key === key) ?? WALLPAPERS[0];
  if (wp) root.setProperty("--wallpaper", wp.css);
}
