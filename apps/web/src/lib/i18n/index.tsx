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
import { PROJECT_MESSAGES } from "../../projects/i18n";

// ── Supported locales ─────────────────────────────────────────────────────────
export const LOCALES = ["en", "ko"] as const;
export type Locale = (typeof LOCALES)[number];

// English ships in the entry chunk — it's the fallback every t() call resolves
// against. Every other locale's dictionary (ko is ~95 KB of source) is code-split
// and fetched on demand: at boot for the active locale, and on switch. A session
// in one language never downloads the others', trimming the entry bundle.
const LOCALE_LOADERS: Partial<Record<Locale, () => Promise<{ default: Record<string, string> }>>> = {
  ko: () => import("./ko"),
};

// Each dictionary is merged with every example project's owned strings (see
// ../../projects/i18n). Non-English entries are filled in lazily by ensureLocale.
const DICTIONARIES: Partial<Record<Locale, Record<string, string>>> = {
  en: { ...en, ...PROJECT_MESSAGES.en },
};

/** Load (once) a locale's dictionary so t() can resolve it synchronously.
 *  English is always present; a locale with no loader resolves immediately. */
export async function ensureLocale(locale: Locale): Promise<void> {
  if (DICTIONARIES[locale]) return;
  const loader = LOCALE_LOADERS[locale];
  if (!loader) return;
  const mod = await loader();
  const projectMsgs = (PROJECT_MESSAGES as Record<string, Record<string, string>>)[locale] ?? {};
  DICTIONARIES[locale] = { ...mod.default, ...projectMsgs };
}

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
    // Priority: prop from server → localStorage → "en" (English is the default).
    const fromProp = initialLocale as Locale | undefined;
    const fromStorage = localStorage.getItem(STORAGE_KEY) as Locale | undefined;
    const candidate = fromProp ?? fromStorage;
    return candidate && LOCALES.includes(candidate as Locale)
      ? (candidate as Locale)
      : "en";
  });

  // Bumps when a lazily-loaded dictionary arrives, forcing t() to re-resolve.
  const [, setDictVersion] = useState(0);

  // Mirror the locale to localStorage, and make sure its dictionary is loaded.
  // English is always present, so if the active locale wasn't preloaded at boot
  // t() falls back to English until this resolves, then re-renders with the real
  // strings. (main.tsx preloads the boot locale, so this is a no-op there.)
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale);
    if (DICTIONARIES[locale]) return;
    let cancelled = false;
    void ensureLocale(locale).then(() => {
      if (!cancelled) setDictVersion((v) => v + 1);
    });
    return () => { cancelled = true; };
  }, [locale]);

  const setLocale = async (next: Locale): Promise<void> => {
    await ensureLocale(next); // load before switching so there's no fallback flash
    setLocaleState(next);
    localStorage.setItem(STORAGE_KEY, next);
    await updateLocaleOnServer(next);
  };

  const t = (key: TranslationKey, params?: Record<string, string | number>): string => {
    const dict = DICTIONARIES[locale] ?? DICTIONARIES.en!;
    const raw = dict[key] ?? DICTIONARIES.en![key] ?? key;
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
