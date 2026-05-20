/**
 * applyTheme — derives CSS custom properties from THEME_TOKENS (shared).
 *
 * This is the SINGLE source for theme colours in the web app.
 * Called on boot and on every theme toggle so the app and the custom-surface
 * iframe use identical values.
 */
import { THEME_TOKENS, type ThemeMode } from "@ariadne/shared";

export function applyTheme(mode: ThemeMode): void {
  const tokens = THEME_TOKENS[mode];
  const root = document.documentElement;

  // Write every token as --<name>: <r g b>;
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(`--${key}`, value);
  }

  // Also toggle the .light class so any legacy CSS-class selectors still work
  root.classList.toggle("light", mode === "light");
}
