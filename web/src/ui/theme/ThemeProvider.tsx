import React, { createContext, useEffect, useMemo, useState } from "react";
import { CURRENT_THEME_VERSION, isThemeName, THEME_STORAGE_KEY, THEME_VERSION_STORAGE_KEY, type ThemeName } from "./tokens";
import { resolveSystemTheme } from "./themes";

type ThemeContextValue = {
  theme: ThemeName;
  resolvedTheme: Exclude<ThemeName, "system">;
  setTheme: (theme: ThemeName) => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

function storedTheme(): ThemeName {
  const version = globalThis.localStorage?.getItem(THEME_VERSION_STORAGE_KEY);
  if (version !== CURRENT_THEME_VERSION) {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, "t3-code-dark");
    globalThis.localStorage?.setItem(THEME_VERSION_STORAGE_KEY, CURRENT_THEME_VERSION);
    return "t3-code-dark";
  }
  const value = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
  return isThemeName(value) ? value : "t3-code-dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(storedTheme);
  const [systemTick, setSystemTick] = useState(0);
  const resolvedTheme = theme === "system" ? resolveSystemTheme() : theme;

  useEffect(() => {
    const query = globalThis.matchMedia?.("(prefers-color-scheme: light)");
    if (!query) return undefined;
    const listener = () => setSystemTick((value) => value + 1);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme === "system" ? "system" : resolvedTheme;
    root.dataset.resolvedTheme = resolvedTheme;
  }, [theme, resolvedTheme, systemTick]);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    resolvedTheme,
    setTheme: (nextTheme) => {
      setThemeState(nextTheme);
      globalThis.localStorage?.setItem(THEME_STORAGE_KEY, nextTheme);
      globalThis.localStorage?.setItem(THEME_VERSION_STORAGE_KEY, CURRENT_THEME_VERSION);
    },
  }), [theme, resolvedTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
