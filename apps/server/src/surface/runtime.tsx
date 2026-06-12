/**
 * @ariadne/surface — runtime module for user-authored workspace surfaces.
 *
 * This module is aliased to `@ariadne/surface` during the esbuild bundling step
 * so that `.ariadne/surface.tsx` can `import { useAriadne, LineChart, ... } from "@ariadne/surface"`.
 *
 * It re-exports React hooks for convenience, provides the `useAriadne()` SDK hook
 * (postMessage bridge to the Ariadne host app), and ships self-contained SVG chart
 * components that require no external chart library.
 *
 * All colours are expressed as CSS custom properties (--background, --foreground, etc.)
 * injected by surfaceHost.ts — NO hardcoded hex values.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * postMessage SDK protocol
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * iframe → parent:
 *   window.parent.postMessage(
 *     { source: "ariadne-surface", reqId: string, method: string, args: unknown[] },
 *     "*"
 *   )
 *
 * parent → iframe:
 *   { source: "ariadne-host", reqId: string, ok: boolean, result?: unknown, error?: string }
 *
 * Methods (surface calls, parent fulfills):
 *   listFiles()               → string[]
 *   readText(path)            → string
 *   readCsv(path)             → { headers: string[], rows: Record<string, string>[] }
 *   listTemplates()           → Array<{ id: string, name: string }>
 *   listRuns()                → Run[]
 *   runTemplate(id, input)    → Run
 *   getRun(runId)             → Run
 *   getQuotes(symbols)            → Array<{ symbol, price, currency }>
 *   getFxRates(base, currencies)  → Record<currency, rate>
 *   getTheme()                → { mode }  (colours from CSS vars)
 *
 * ──────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import ReactDOM from "react-dom/client";

export { React, useState, useEffect, useCallback, useRef, useMemo };
export { useState as useStateAlias, useEffect as useEffectAlias };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CsvData {
  headers: string[];
  rows: Record<string, string>[];
}

/** What listFiles() actually returns — the host maps the snapshot to these. */
export interface SurfaceFile {
  path: string;
  size: number;
  extension: string;
  estimatedTokens: number;
}

export interface Quote {
  symbol: string;
  /** What the user passed in — preserved across the normalizer. */
  inputSymbol?: string;
  /** What we actually queried Yahoo with. */
  resolvedSymbol?: string;
  price: number;
  currency: string;
  /** Yahoo's exchange/market identifier (KSE / KOSDAQ / NasdaqGS / …). */
  market?: string;
  /** Which provider resolved this — 'yahoo' today; future fallbacks
   *  ('alpha-vantage', 'finnhub', …) set their own name. */
  source?: string;
  /** AO — Yahoo v8 chart meta extras. Optional, populated when the
   *  underlying instrument provides them. Lets the surface render a
   *  "live snapshot" panel as a fallback for missing thesis/news files. */
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  regularMarketVolume?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  previousClose?: number;
}

/** Per-symbol error returned by getQuotesDetailed so surfaces can show
 *  which positions are currently unquotable instead of blanking them. */
export interface QuoteError {
  inputSymbol: string;
  resolvedSymbol: string;
  reason: string;
}

export interface AriadneTheme {
  /** "dark" or "light" — colours come from CSS custom properties. */
  mode: "dark" | "light";
}

export interface StageFileResult {
  runId: string;
  added: number;
  removed: number;
}

export interface AriadneSDK {
  listFiles(): Promise<SurfaceFile[]>;
  readText(path: string): Promise<string>;
  readCsv(path: string): Promise<CsvData>;
  listTemplates(): Promise<Array<{ id: string; name: string }>>;
  listRuns(): Promise<unknown[]>;
  runTemplate(id: string, input: Record<string, string>): Promise<unknown>;
  /** Run an actions.yaml action by id (e.g. a brief generator). Returns the action run. */
  runAction(actionId: string, input?: Record<string, string>): Promise<unknown>;
  /** One-shot AI completion on the workspace's active model. Compose the prompt
   *  yourself (e.g. include text you read via readText) — returns the reply. */
  ask(prompt: string): Promise<string>;
  /** Stage a data-file edit for review. Does not write to disk; the host
   *  creates a staged manifest under a new Run, returns its id so the
   *  caller can deep-link to /runs/:runId/diff for review + apply.
   *  Same shape the AI's edit_file uses. */
  stageFile(path: string, content: string): Promise<StageFileResult>;
  getRun(runId: string): Promise<unknown>;
  /** Live stock/crypto quotes for the given symbols (best-effort; may be partial).
   *  Per-symbol failures are silently dropped — use getQuotesDetailed() if
   *  you need to know which symbols failed and why. */
  getQuotes(symbols: string[]): Promise<Quote[]>;
  /** Detailed variant: returns { quotes, errors } so the caller can
   *  render an 'unquotable' badge on the positions whose symbols
   *  Yahoo (and any fallback provider) couldn't price. */
  getQuotesDetailed(symbols: string[]): Promise<{ quotes: Quote[]; errors: QuoteError[] }>;
  /** Live FX rates relative to `base` — units of base per 1 unit of each currency. */
  getFxRates(base: string, currencies: string[]): Promise<Record<string, number>>;
  /** AQ — Historical close prices for a single symbol. Used for benchmark
   *  overlay (^KS200, ^GSPC) and per-position charts beyond the static
   *  CSV history. range: '1mo'|'3mo'|'6mo'|'1y'|'2y'|'5y'|'10y'|'ytd'|'max'. */
  getQuoteHistory(symbol: string, range?: string, interval?: string): Promise<Array<{ date: string; close: number }>>;
  /** AR — Calendar events (earnings date + ex-dividend date + dividend
   *  rate/yield) for the given symbols. Per-symbol failures are dropped. */
  getQuoteCalendars(symbols: string[]): Promise<Array<{
    symbol: string; resolvedSymbol: string;
    earningsDate?: string; earningsType?: "actual" | "estimate";
    exDividendDate?: string;
    dividendRate?: number; dividendYield?: number;
  }>>;
  /** AS — Recent news headlines for a single symbol. Yahoo v1 finance
   *  search; cache 1h server-side. */
  getQuoteNews(symbol: string, max?: number): Promise<Array<{
    uuid: string; title: string; publisher: string; link: string;
    publishedAt: string; thumbnail?: string; relatedTickers?: string[];
  }>>;
  /** AS — Dividend history for Total-Return computation. Date + amount
   *  per dividend payment. range: defaults to '5y'. */
  getDividendHistory(symbol: string, range?: string): Promise<Array<{ date: string; amount: number }>>;
  /** Returns the current theme mode. Colours come from CSS custom properties. */
  theme: AriadneTheme;
}

// ---------------------------------------------------------------------------
// Detect theme mode from window.__ariadneTheme (injected by surfaceHost.ts)
// ---------------------------------------------------------------------------

function detectTheme(): AriadneTheme {
  const w = typeof window !== "undefined"
    ? (window as { __ariadneTheme?: { mode?: string } })
    : null;
  const mode = w?.__ariadneTheme?.mode;
  return { mode: mode === "light" ? "light" : "dark" };
}

// ---------------------------------------------------------------------------
// useAriadne() — postMessage bridge
// ---------------------------------------------------------------------------

let _reqCounter = 0;

function genReqId(): string {
  _reqCounter += 1;
  return `req-${Date.now().toString(36)}-${_reqCounter.toString(36)}`;
}

function callHost<T>(method: string, args: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const reqId = genReqId();

    function onMessage(event: MessageEvent) {
      const data = event.data as { source?: string; reqId?: string; ok?: boolean; result?: unknown; error?: string };
      if (data?.source !== "ariadne-host" || data.reqId !== reqId) return;
      window.removeEventListener("message", onMessage);
      if (data.ok) {
        resolve(data.result as T);
      } else {
        reject(new Error(data.error ?? "Unknown error from host"));
      }
    }

    window.addEventListener("message", onMessage);
    window.parent.postMessage({ source: "ariadne-surface", reqId, method, args }, "*");
  });
}

/**
 * Returns an SDK object with methods that communicate with the Ariadne host
 * via postMessage, plus a `theme` object with the current mode.
 * Stable reference — does not change between renders.
 * Colours come from CSS custom properties injected into :root by surfaceHost.ts.
 */
export function useAriadne(): AriadneSDK {
  const sdk = useRef<AriadneSDK>({
    listFiles: () => callHost<SurfaceFile[]>("listFiles", []),
    readText: (p: string) => callHost<string>("readText", [p]),
    readCsv: (p: string) => callHost<CsvData>("readCsv", [p]),
    listTemplates: () => callHost<Array<{ id: string; name: string }>>("listTemplates", []),
    listRuns: () => callHost<unknown[]>("listRuns", []),
    runTemplate: (id: string, input: Record<string, string>) => callHost<unknown>("runTemplate", [id, input]),
    runAction: (actionId: string, input?: Record<string, string>) => callHost<unknown>("runAction", [actionId, input ?? {}]),
    ask: (prompt: string) => callHost<string>("ask", [prompt]),
    stageFile: (p: string, content: string) =>
      callHost<StageFileResult>("stageFile", [p, content]),
    getRun: (runId: string) => callHost<unknown>("getRun", [runId]),
    getQuotes: (symbols: string[]) => callHost<Quote[]>("getQuotes", [symbols]),
    getQuotesDetailed: (symbols: string[]) =>
      callHost<{ quotes: Quote[]; errors: QuoteError[] }>("getQuotesDetailed", [symbols]),
    getFxRates: (base: string, currencies: string[]) =>
      callHost<Record<string, number>>("getFxRates", [base, currencies]),
    getQuoteHistory: (symbol: string, range?: string, interval?: string) =>
      callHost<Array<{ date: string; close: number }>>("getQuoteHistory", [symbol, range ?? "1y", interval ?? "1d"]),
    getQuoteCalendars: (symbols: string[]) =>
      callHost<Array<{ symbol: string; resolvedSymbol: string; earningsDate?: string; earningsType?: "actual" | "estimate"; exDividendDate?: string; dividendRate?: number; dividendYield?: number }>>("getQuoteCalendars", [symbols]),
    getQuoteNews: (symbol: string, max?: number) =>
      callHost<Array<{ uuid: string; title: string; publisher: string; link: string; publishedAt: string; thumbnail?: string; relatedTickers?: string[] }>>("getQuoteNews", [symbol, max ?? 8]),
    getDividendHistory: (symbol: string, range?: string) =>
      callHost<Array<{ date: string; amount: number }>>("getDividendHistory", [symbol, range ?? "5y"]),
    theme: detectTheme(),
  });
  return sdk.current;
}

// ---------------------------------------------------------------------------
// CSS-var colour helpers — all chart colours come from theme tokens
// ---------------------------------------------------------------------------

const CV = {
  foreground: "rgb(var(--foreground))",
  mutedFg: "rgb(var(--muted-foreground))",
  border: "rgb(var(--border))",
  accent: "rgb(var(--accent))",
  card: "rgb(var(--card))",
};

// Shared palette for multi-series / pie segments
// Uses accent as first colour then CSS-defined complementary hues via opacity variants
const PALETTE = [
  "rgb(var(--accent))",
  "rgb(var(--info))",
  "rgb(var(--warning))",
  "rgb(var(--success))",
  "rgb(var(--destructive))",
  "rgb(var(--ring))",
  "rgb(var(--info))",
  "rgb(var(--success))",
  "rgb(var(--warning))",
  "rgb(var(--accent))",
];

/**
 * Compact axis-label formatter: 136314 → "136.3k", 2_400_000 → "2.4M".
 * Keeps small integers exact and rounds fractional values to one decimal so
 * finance-scale charts stay readable.
 */
function compactNum(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(1) + "k";
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(1);
}

// ── LineChart ──────────────────────────────────────────────────────────────

export interface LineChartProps {
  data: Array<{ label: string; value: number }>;
  width?: number;
  height?: number;
  title?: string;
  /** Override line colour — should be a CSS colour string using var(--token). */
  color?: string;
  /**
   * Optional second series, drawn as a dimmer dashed line behind `data`. Use it
   * for a baseline / what-if comparison (e.g. portfolio value with currency
   * moves removed). It should share x-labels and length with `data`; the y-scale
   * spans both series so the gap between the two lines is meaningful.
   */
  compare?: Array<{ label: string; value: number }>;
  /** Legend labels for the [primary, compare] series — shown when `compare` is set. */
  seriesLabels?: [string, string];
}

export function LineChart({ data, width = 480, height = 240, title, color, compare, seriesLabels }: LineChartProps) {
  const lineColor = color ?? CV.accent;
  const textColor = CV.foreground;
  const mutedColor = CV.mutedFg;
  const gridColor = CV.border;

  // AS — hover tracking. Index of the data point closest to cursor x.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data.length) return <svg width={width} height={height} />;

  const cmp = compare && compare.length === data.length ? compare : null;
  const [primaryLabel, compareLabel] = seriesLabels ?? ["Actual", "Baseline"];

  const PAD = { top: cmp ? 46 : title ? 32 : 16, right: 16, bottom: 32, left: 48 };
  const W = width - PAD.left - PAD.right;
  const H = height - PAD.top - PAD.bottom;

  const values = cmp
    ? data.map((d) => d.value).concat(cmp.map((d) => d.value))
    : data.map((d) => d.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  const x = (i: number) => (i / (data.length - 1)) * W;
  const y = (v: number) => H - ((v - minV) / range) * H;

  const points = data.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const comparePoints = cmp
    ? cmp.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ")
    : "";

  // AS — index lookup from svg-local mouse x. Snap to nearest data point.
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const localX = e.clientX - rect.left - PAD.left;
    if (localX < 0 || localX > W) { setHoverIdx(null); return; }
    const idx = Math.round((localX / W) * (data.length - 1));
    if (idx >= 0 && idx < data.length) setHoverIdx(idx);
  };

  // Legend geometry — centre two entries in a row below the title.
  const SWATCH = 16;
  const entryW = (s: string) => SWATCH + 6 + s.length * 5.6;
  const legendGap = 20;
  const legendW = entryW(primaryLabel) + legendGap + entryW(compareLabel);
  const legendX = (width - legendW) / 2;
  const legendY = 30;
  const compareEntryX = legendX + entryW(primaryLabel) + legendGap;

  return (
    <svg
      width={width}
      height={height}
      style={{ fontFamily: "sans-serif", overflow: "visible" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      {title && (
        <text x={width / 2} y={14} textAnchor="middle" fontSize={13} fontWeight={600} fill={textColor}>
          {title}
        </text>
      )}
      {cmp && (
        <g>
          <line x1={legendX} y1={legendY - 3} x2={legendX + SWATCH} y2={legendY - 3} stroke={lineColor} strokeWidth={2.5} />
          <text x={legendX + SWATCH + 6} y={legendY} fontSize={10} fill={mutedColor}>
            {primaryLabel}
          </text>
          <line
            x1={compareEntryX}
            y1={legendY - 3}
            x2={compareEntryX + SWATCH}
            y2={legendY - 3}
            stroke={mutedColor}
            strokeWidth={2}
            strokeDasharray="5 3"
          />
          <text x={compareEntryX + SWATCH + 6} y={legendY} fontSize={10} fill={mutedColor}>
            {compareLabel}
          </text>
        </g>
      )}
      <g transform={`translate(${PAD.left},${PAD.top})`}>
        {/* Y-axis */}
        <line x1={0} y1={0} x2={0} y2={H} stroke={gridColor} />
        {[0, 0.5, 1].map((t) => {
          const v = minV + t * range;
          const yp = y(v);
          return (
            <g key={t}>
              <line x1={0} y1={yp} x2={W} y2={yp} stroke={gridColor} strokeDasharray="4 2" />
              <text x={-6} y={yp + 4} textAnchor="end" fontSize={10} fill={mutedColor}>
                {compactNum(v)}
              </text>
            </g>
          );
        })}
        {/* X-axis labels */}
        {data.map((d, i) => (
          <text key={i} x={x(i)} y={H + 16} textAnchor="middle" fontSize={10} fill={mutedColor}>
            {d.label.length > 6 ? `${d.label.slice(0, 5)}…` : d.label}
          </text>
        ))}
        {/* Compare line — drawn first so the primary series sits on top */}
        {cmp && (
          <polyline
            points={comparePoints}
            fill="none"
            stroke={mutedColor}
            strokeWidth={2}
            strokeDasharray="5 3"
            strokeLinejoin="round"
            opacity={0.8}
          />
        )}
        {/* Primary line */}
        <polyline points={points} fill="none" stroke={lineColor} strokeWidth={2} strokeLinejoin="round" />
        {/* Dots */}
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.value)} r={3} fill={lineColor} />
        ))}
        {/* AS — hover crosshair + tooltip. SVG-only so the surface
            iframe doesn't need extra DOM nodes outside the chart. */}
        {hoverIdx != null && data[hoverIdx] && (
          <g>
            <line x1={x(hoverIdx)} y1={0} x2={x(hoverIdx)} y2={H} stroke={mutedColor} strokeDasharray="3 3" />
            <circle cx={x(hoverIdx)} cy={y(data[hoverIdx]!.value)} r={5} fill={lineColor} stroke="rgb(var(--background))" strokeWidth={2} />
            {cmp && cmp[hoverIdx] && (
              <circle cx={x(hoverIdx)} cy={y(cmp[hoverIdx]!.value)} r={5} fill={mutedColor} stroke="rgb(var(--background))" strokeWidth={2} />
            )}
            {(() => {
              const point = data[hoverIdx]!;
              const cmpPoint = cmp ? cmp[hoverIdx] : null;
              // Tooltip box positioned to right of the cursor unless close
              // to the right edge — then flip left.
              const boxW = cmp ? 160 : 120;
              const boxH = cmp ? 50 : 34;
              const xp = x(hoverIdx);
              const yp = y(point.value);
              const boxX = xp + 8 + boxW > W ? xp - boxW - 8 : xp + 8;
              const boxY = Math.max(0, Math.min(H - boxH, yp - boxH / 2));
              return (
                <g pointerEvents="none">
                  <rect x={boxX} y={boxY} width={boxW} height={boxH} rx={4} fill="rgb(var(--card))" stroke={gridColor} />
                  <text x={boxX + 8} y={boxY + 14} fontSize={10} fontWeight={600} fill={textColor}>{point.label}</text>
                  <text x={boxX + 8} y={boxY + 28} fontSize={10} fill={lineColor}>
                    {primaryLabel}: {compactNum(point.value)}
                  </text>
                  {cmpPoint && (
                    <text x={boxX + 8} y={boxY + 42} fontSize={10} fill={mutedColor}>
                      {compareLabel}: {compactNum(cmpPoint.value)}
                    </text>
                  )}
                </g>
              );
            })()}
          </g>
        )}
      </g>
    </svg>
  );
}

// ── BarChart ───────────────────────────────────────────────────────────────

export interface BarChartProps {
  data: Array<{ label: string; value: number }>;
  width?: number;
  height?: number;
  title?: string;
  /** Override bar colour — should be a CSS colour string using var(--token). */
  color?: string;
}

export function BarChart({ data, width = 480, height = 240, title, color }: BarChartProps) {
  const barColor = color ?? CV.accent;
  const negColor = "rgb(var(--destructive))";
  const textColor = CV.foreground;
  const mutedColor = CV.mutedFg;
  const gridColor = CV.border;

  if (!data.length) return <svg width={width} height={height} />;

  const PAD = { top: title ? 32 : 16, right: 16, bottom: 40, left: 52 };
  const W = width - PAD.left - PAD.right;
  const H = height - PAD.top - PAD.bottom;

  // Scale spans min..max so negative values render below a zero baseline.
  const values = data.map((d) => d.value);
  const maxV = Math.max(...values, 0);
  const minV = Math.min(...values, 0);
  const range = maxV - minV || 1;
  const y = (v: number) => H - ((v - minV) / range) * H;
  const zeroY = y(0);
  const barW = Math.max(4, W / data.length - 4);

  // Ticks: show the zero line explicitly only when values cross it.
  const ticks = minV < 0 ? [maxV, 0, minV] : [maxV, maxV / 2, 0];

  return (
    <svg width={width} height={height} style={{ fontFamily: "sans-serif", overflow: "visible" }}>
      {title && (
        <text x={width / 2} y={14} textAnchor="middle" fontSize={13} fontWeight={600} fill={textColor}>
          {title}
        </text>
      )}
      <g transform={`translate(${PAD.left},${PAD.top})`}>
        {/* Y gridlines */}
        {ticks.map((v, i) => {
          const yp = y(v);
          return (
            <g key={i}>
              <line x1={0} y1={yp} x2={W} y2={yp} stroke={gridColor} strokeDasharray="4 2" />
              <text x={-6} y={yp + 4} textAnchor="end" fontSize={10} fill={mutedColor}>
                {compactNum(v)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const vy = y(d.value);
          const top = Math.min(vy, zeroY);
          const bh = Math.abs(vy - zeroY);
          const bx = (i / data.length) * W + 2;
          return (
            <g key={i}>
              <rect
                x={bx}
                y={top}
                width={barW}
                height={Math.max(bh, 0)}
                fill={d.value < 0 ? negColor : barColor}
                rx={2}
                opacity={0.85}
              />
              <text
                x={bx + barW / 2}
                y={H + 14}
                textAnchor="middle"
                fontSize={10}
                fill={mutedColor}
              >
                {d.label.length > 6 ? `${d.label.slice(0, 5)}…` : d.label}
              </text>
            </g>
          );
        })}
        {/* Zero baseline */}
        <line x1={0} y1={zeroY} x2={W} y2={zeroY} stroke={gridColor} />
      </g>
    </svg>
  );
}

// ── PieChart ───────────────────────────────────────────────────────────────

export interface PieChartProps {
  data: Array<{ label: string; value: number }>;
  width?: number;
  height?: number;
  title?: string;
}

interface SliceDescriptor {
  path: string;
  color: string;
  label: string;
  pct: number;
  lx: number;
  ly: number;
}

function buildSlices(
  data: Array<{ label: string; value: number }>,
  cx: number,
  cy: number,
  r: number
): SliceDescriptor[] {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return [];
  let angle = -Math.PI / 2;
  return data.map((d, i) => {
    const sweep = (d.value / total) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    angle += sweep;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    const midAngle = angle - sweep / 2;
    const lr = r * 1.25;
    return {
      path: `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`,
      color: PALETTE[i % PALETTE.length] ?? CV.accent,
      label: d.label,
      pct: Math.round((d.value / total) * 100),
      lx: cx + lr * Math.cos(midAngle),
      ly: cy + lr * Math.sin(midAngle),
    };
  });
}

export function PieChart({ data, width = 320, height = 280, title }: PieChartProps) {
  const textColor = CV.foreground;
  const bgColor = "rgb(var(--background))";

  if (!data.length) return <svg width={width} height={height} />;

  const cx = width / 2;
  const cy = title ? height / 2 + 16 : height / 2;
  const r = Math.min(cx, cy - (title ? 16 : 0)) * 0.65;

  const slices = buildSlices(data, cx, cy, r);

  return (
    <svg width={width} height={height} style={{ fontFamily: "sans-serif", overflow: "visible" }}>
      {title && (
        <text x={cx} y={18} textAnchor="middle" fontSize={13} fontWeight={600} fill={textColor}>
          {title}
        </text>
      )}
      {slices.map((s) => (
        <path key={s.label} d={s.path} fill={s.color} stroke={bgColor} strokeWidth={1.5} opacity={0.9} />
      ))}
      {slices.map((s) =>
        s.pct >= 5 ? (
          <text key={s.label} x={s.lx} y={s.ly} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill={textColor}>
            {s.label} {s.pct}%
          </text>
        ) : null
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// UI kit (BK) — themed building blocks so a surface composes a clean layout
// without hand-rolling every element. Self-contained like the charts: colours
// are CSS custom properties (theme-aware), layout is inline flex/grid, no
// external stylesheet. Additive — existing surfaces are unaffected.
// ---------------------------------------------------------------------------

export interface CardProps {
  title?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export function Card({ title, children, style }: CardProps) {
  return (
    <div style={{ border: `1px solid ${CV.border}`, borderRadius: 12, background: CV.card, padding: 16, ...style }}>
      {title && <div style={{ fontSize: 13, fontWeight: 600, color: CV.foreground, marginBottom: 10 }}>{title}</div>}
      {children}
    </div>
  );
}

export interface StatProps {
  label: string;
  value: string | number;
  /** Signed percentage delta — coloured green/red with an arrow when set. */
  delta?: number;
}
export function Stat({ label, value, delta }: StatProps) {
  const deltaColor = delta == null ? CV.mutedFg : delta >= 0 ? "rgb(var(--success))" : "rgb(var(--destructive))";
  return (
    <div>
      <div style={{ fontSize: 11, color: CV.mutedFg, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: CV.foreground, lineHeight: 1.2 }}>{value}</div>
      {delta != null && (
        <div style={{ fontSize: 12, color: deltaColor, marginTop: 2 }}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(2)}%
        </div>
      )}
    </div>
  );
}

export interface ButtonProps {
  label: string;
  onClick?: () => void;
  variant?: "primary" | "ghost";
  disabled?: boolean;
}
export function Button({ label, onClick, variant = "primary", disabled }: ButtonProps) {
  const primary = variant === "primary";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        font: "inherit", fontSize: 13, fontWeight: 500, padding: "7px 14px", borderRadius: 8,
        cursor: disabled ? "default" : "pointer",
        border: primary ? "none" : `1px solid ${CV.border}`,
        background: primary ? CV.accent : "transparent",
        color: primary ? "rgb(var(--accent-foreground))" : CV.foreground,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

export interface BadgeProps {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}
export function Badge({ label, tone = "neutral" }: BadgeProps) {
  const token =
    tone === "success" ? "--success"
    : tone === "warning" ? "--warning"
    : tone === "danger" ? "--destructive"
    : tone === "info" ? "--info"
    : "--muted-foreground";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 500,
      padding: "2px 8px", borderRadius: 999, color: `rgb(var(${token}))`,
      background: `color-mix(in srgb, rgb(var(${token})) 14%, transparent)`,
    }}>
      {label}
    </span>
  );
}

export interface GridProps {
  cols?: number;
  gap?: number;
  children?: React.ReactNode;
}
export function Grid({ cols = 2, gap = 12, children }: GridProps) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crash isolation (BJ1)
// ---------------------------------------------------------------------------
// Without this, a surface that throws at render time unmounts React and leaves
// a blank iframe with no signal to the host. `mountSurface` wraps the surface
// in an error boundary (themed in-iframe fallback for render crashes) and
// installs window handlers for the throws React can't catch — module-eval,
// event handlers, rejected promises. All three report to the host so
// SurfaceView can show a real error instead of nothing.

/** Tell the host a surface-level error happened. One-way notification (no
 *  reqId) — distinct from the SDK request/response channel. */
function reportSurfaceError(kind: "render" | "runtime" | "promise", message: string, stack?: string): void {
  try {
    window.parent.postMessage(
      { source: "ariadne-surface", type: "surface-error", kind, message, stack },
      "*",
    );
  } catch {
    /* parent unreachable — nothing more we can do from inside the sandbox */
  }
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class SurfaceErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }
  componentDidCatch(error: Error): void {
    reportSurfaceError("render", error.message, error.stack);
  }
  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ padding: 24, fontFamily: "ui-sans-serif, system-ui, sans-serif", color: "rgb(var(--foreground))" }}>
        <div style={{ maxWidth: 560, margin: "0 auto", border: "1px solid rgb(var(--destructive))", borderRadius: 12, padding: 20, background: "color-mix(in srgb, rgb(var(--destructive)) 6%, transparent)" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>This surface failed to render</div>
          <div style={{ fontSize: 12, color: "rgb(var(--muted-foreground))", marginBottom: 12 }}>
            Your surface code threw while rendering. Fix it in the Edit screen, then Build again.
          </div>
          <pre style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "rgb(var(--destructive))", background: "rgb(var(--card))", borderRadius: 6, padding: "8px 10px", margin: 0, maxHeight: 240, overflow: "auto" }}>
            {error.message}{error.stack ? `\n\n${error.stack}` : ""}
          </pre>
        </div>
      </div>
    );
  }
}

/**
 * Current SDK API version (BJ6). Bump on a BREAKING change to the
 * @ariadne/surface contract (e.g. a changed return shape). A surface may
 * `export const apiVersion = N` to record what it was built against; the host
 * then warns — non-fatally — if that differs from this, instead of letting a
 * shape mismatch fail silently.
 */
export const API_VERSION = 1;

/** Non-fatal notice to the host (e.g. version skew). Same one-way channel as
 *  reportSurfaceError, distinct `type`. */
function reportSurfaceWarning(message: string): void {
  try {
    window.parent.postMessage(
      { source: "ariadne-surface", type: "surface-warning", message },
      "*",
    );
  } catch {
    /* parent unreachable */
  }
}

/**
 * Mount a surface component with crash isolation + host error reporting.
 * The build shim calls this instead of touching ReactDOM directly, so every
 * surface gets the same safety net. `opts.apiVersion` is the surface's declared
 * target version (if any) — a mismatch with API_VERSION warns the host.
 */
export function mountSurface(
  Component: React.ComponentType,
  opts?: { rootId?: string; apiVersion?: number },
): void {
  const rootId = opts?.rootId ?? "surface-root";
  if (typeof window !== "undefined") {
    window.addEventListener("error", (e: ErrorEvent) => {
      reportSurfaceError("runtime", e.message, e.error?.stack);
    });
    window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string; stack?: string } | undefined;
      reportSurfaceError("promise", r?.message ?? String(e.reason), r?.stack);
    });
    // BJ6 — surface targets a different SDK major than the host is running.
    if (opts?.apiVersion != null && opts.apiVersion !== API_VERSION) {
      reportSurfaceWarning(
        `This surface targets SDK API v${opts.apiVersion}, but the host runs v${API_VERSION}. ` +
        `Some @ariadne/surface calls may behave differently — rebuild against the current SDK.`,
      );
    }
  }
  const root = document.getElementById(rootId);
  if (!root) return;
  ReactDOM.createRoot(root).render(
    React.createElement(SurfaceErrorBoundary, null, React.createElement(Component)),
  );
}
