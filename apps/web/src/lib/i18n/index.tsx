/**
 * Lightweight i18n layer for Ariadne.
 *
 * Usage:
 *   const { t, locale, setLocale } = useT();
 *   t("chat.empty.title")           → translated string
 *   t("runs.step", { step: 1, total: 3 }) → "Step 1 of 3"
 *
 * Adding a new language:
 *   1. Create `<lang>.ts` in this directory with Record<TranslationKey, string>.
 *   2. Add the locale to LOCALES below.
 *   3. Add the dictionary import to DICTIONARIES below.
 */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import type { TranslationKey } from "./en";
import en from "./en";
import ko from "./ko";

// ── Supported locales ─────────────────────────────────────────────────────────
export const LOCALES = ["en", "ko"] as const;
export type Locale = (typeof LOCALES)[number];

const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = {
  en,
  ko,
};

const STORAGE_KEY = "ariadne.locale";

// ── Interpolation helper ──────────────────────────────────────────────────────
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const val = params[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

// ── Context ───────────────────────────────────────────────────────────────────
interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => Promise<void>;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// ── API call (defined here to avoid circular import with api.ts) ──────────────
async function updateLocaleOnServer(locale: Locale): Promise<void> {
  const res = await fetch("/api/account/locale", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────
export interface I18nProviderProps {
  children: ReactNode;
  initialLocale?: string;
}

export function I18nProvider({ children, initialLocale }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    // Priority: prop from server → localStorage → "ko" (Korean is the default).
    const fromProp = initialLocale as Locale | undefined;
    const fromStorage = localStorage.getItem(STORAGE_KEY) as Locale | undefined;
    const candidate = fromProp ?? fromStorage;
    return candidate && LOCALES.includes(candidate as Locale)
      ? (candidate as Locale)
      : "ko";
  });

  // Mirror initial locale to localStorage on first render
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale);
  }, [locale]);

  const setLocale = async (next: Locale): Promise<void> => {
    setLocaleState(next);
    localStorage.setItem(STORAGE_KEY, next);
    await updateLocaleOnServer(next);
  };

  const t = (key: TranslationKey, params?: Record<string, string | number>): string => {
    const dict = DICTIONARIES[locale];
    const raw = dict[key] ?? DICTIONARIES.en[key] ?? key;
    return interpolate(raw, params);
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useT(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useT() must be used inside <I18nProvider>");
  }
  return ctx;
}

export type { TranslationKey };
