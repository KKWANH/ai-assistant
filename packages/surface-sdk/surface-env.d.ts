// @ariadne/surface — ambient type contract for workspace surfaces.
//
// This file is the canonical, self-contained type declaration for the
// `@ariadne/surface` module that custom surfaces import. It is copied into
// each workspace's `.ariadne/surface-env.d.ts` (by writeSurface) so a builder
// editing `.ariadne/surface.tsx` in their own editor gets autocomplete and
// type-checking for the SDK — even though the sandboxed workspace has no
// node_modules.
//
// Self-contained on purpose: the Ariadne SDK (useAriadne + charts) is typed
// precisely, while React hooks and JSX are declared loosely so this file needs
// no `@types/react`. Keep in sync with apps/server/src/surface/runtime.tsx
// (the implementation esbuild actually bundles at build time).
//
// GENERATED CONTRACT — do not edit the copy inside a workspace; edit
// packages/surface-sdk/surface-env.d.ts and it re-seeds on next surface save.

declare module "@ariadne/surface" {
  // ── React surface (loose, self-contained) ───────────────────────────────
  // The runtime re-exports React + these hooks so your bundle shares the
  // host's React instance. Import them from "@ariadne/surface", not "react".
  export const React: any;
  export function useState<S>(initial: S | (() => S)): [S, (value: S | ((prev: S) => S)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: ReadonlyArray<unknown>): void;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: ReadonlyArray<unknown>): T;
  export function useRef<T>(initial: T): { current: T };
  export function useMemo<T>(factory: () => T, deps: ReadonlyArray<unknown>): T;

  // ── Data types ───────────────────────────────────────────────────────────
  export interface SurfaceFile {
    path: string;
    size: number;
    extension: string;
    estimatedTokens: number;
  }

  export interface CsvData {
    headers: string[];
    /** Every cell is a string — coerce numbers yourself. */
    rows: Record<string, string>[];
  }

  export interface Quote {
    symbol: string;
    inputSymbol?: string;
    resolvedSymbol?: string;
    price: number;
    currency: string;
    market?: string;
    source?: string;
    fiftyTwoWeekHigh?: number;
    fiftyTwoWeekLow?: number;
    regularMarketVolume?: number;
    regularMarketDayHigh?: number;
    regularMarketDayLow?: number;
    previousClose?: number;
  }

  export interface QuoteError {
    inputSymbol: string;
    resolvedSymbol: string;
    reason: string;
  }

  export interface StageFileResult {
    runId: string;
    added: number;
    removed: number;
  }

  export interface AriadneTheme {
    mode: "dark" | "light";
  }

  export interface QuoteCalendar {
    symbol: string;
    resolvedSymbol: string;
    earningsDate?: string;
    earningsType?: "actual" | "estimate";
    exDividendDate?: string;
    dividendRate?: number;
    dividendYield?: number;
  }

  export interface NewsItem {
    uuid: string;
    title: string;
    publisher: string;
    link: string;
    publishedAt: string;
    thumbnail?: string;
    relatedTickers?: string[];
  }

  // ── SDK ──────────────────────────────────────────────────────────────────
  export interface AriadneSDK {
    /** Whole-workspace file list (path + size + token estimate). */
    listFiles(): Promise<SurfaceFile[]>;
    readText(path: string): Promise<string>;
    /** CSV → { headers, rows }. Cells are strings; coerce numbers yourself. */
    readCsv(path: string): Promise<CsvData>;
    listTemplates(): Promise<Array<{ id: string; name: string }>>;
    listRuns(): Promise<unknown[]>;
    runTemplate(id: string, input: Record<string, string>): Promise<unknown>;
    /** Stage a data-file edit for review (does NOT write to disk). Deep-link
     *  the user to /runs/:runId/diff to apply. */
    stageFile(path: string, content: string): Promise<StageFileResult>;
    getRun(runId: string): Promise<unknown>;
    /** Best-effort quotes; missing symbols are silently dropped. */
    getQuotes(symbols: string[]): Promise<Quote[]>;
    /** Quotes + the per-symbol failures (for an 'unquotable' badge). */
    getQuotesDetailed(symbols: string[]): Promise<{ quotes: Quote[]; errors: QuoteError[] }>;
    /** FX rates: units of `base` per 1 unit of each currency. */
    getFxRates(base: string, currencies: string[]): Promise<Record<string, number>>;
    getQuoteHistory(symbol: string, range?: string, interval?: string): Promise<Array<{ date: string; close: number }>>;
    getQuoteCalendars(symbols: string[]): Promise<QuoteCalendar[]>;
    getQuoteNews(symbol: string, max?: number): Promise<NewsItem[]>;
    getDividendHistory(symbol: string, range?: string): Promise<Array<{ date: string; amount: number }>>;
    /** Current theme mode. Colours come from CSS custom properties. */
    theme: AriadneTheme;
  }

  /** Stable SDK object (same reference every render). Call methods from
   *  effects, not during render. */
  export function useAriadne(): AriadneSDK;

  // ── Chart components ───────────────────────────────────────────────────────
  // All take `data: Array<{ label, value }>`. Pass CSS-var colour strings
  // (e.g. "rgb(var(--info))"), never hex.
  export interface LineChartProps {
    data: Array<{ label: string; value: number }>;
    width?: number;
    height?: number;
    title?: string;
    color?: string;
    /** Second, dimmer/dashed series — same x-labels & length as `data`. */
    compare?: Array<{ label: string; value: number }>;
    seriesLabels?: [string, string];
  }
  export interface BarChartProps {
    data: Array<{ label: string; value: number }>;
    width?: number;
    height?: number;
    title?: string;
    /** Negative values auto-render in the destructive colour. */
    color?: string;
  }
  export interface PieChartProps {
    data: Array<{ label: string; value: number }>;
    width?: number;
    height?: number;
    title?: string;
  }
  export function LineChart(props: LineChartProps): any;
  export function BarChart(props: BarChartProps): any;
  export function PieChart(props: PieChartProps): any;
}

// ── Loose JSX so a bare workspace (no @types/react) still type-checks ──────────
declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
  type Element = any;
}

// The build compiles JSX with the automatic runtime (esbuild jsx:automatic),
// which imports from "react/jsx-runtime". esbuild resolves the real module at
// build time; this stub lets the editor type-check automatic-JSX surfaces
// without node_modules.
declare module "react/jsx-runtime" {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}
declare module "react/jsx-dev-runtime" {
  export const jsxDEV: any;
  export const Fragment: any;
}
