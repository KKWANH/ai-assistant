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

import React, { useState, useEffect, useCallback, useRef } from "react";

export { React, useState, useEffect, useCallback, useRef };
export { useState as useStateAlias, useEffect as useEffectAlias };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CsvData {
  headers: string[];
  rows: Record<string, string>[];
}

export interface Quote {
  symbol: string;
  price: number;
  currency: string;
}

export interface AriadneTheme {
  /** "dark" or "light" — colours come from CSS custom properties. */
  mode: "dark" | "light";
}

export interface AriadneSDK {
  listFiles(): Promise<string[]>;
  readText(path: string): Promise<string>;
  readCsv(path: string): Promise<CsvData>;
  listTemplates(): Promise<Array<{ id: string; name: string }>>;
  listRuns(): Promise<unknown[]>;
  runTemplate(id: string, input: Record<string, string>): Promise<unknown>;
  getRun(runId: string): Promise<unknown>;
  /** Live stock/crypto quotes for the given symbols (best-effort; may be partial). */
  getQuotes(symbols: string[]): Promise<Quote[]>;
  /** Live FX rates relative to `base` — units of base per 1 unit of each currency. */
  getFxRates(base: string, currencies: string[]): Promise<Record<string, number>>;
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
    listFiles: () => callHost<string[]>("listFiles", []),
    readText: (p: string) => callHost<string>("readText", [p]),
    readCsv: (p: string) => callHost<CsvData>("readCsv", [p]),
    listTemplates: () => callHost<Array<{ id: string; name: string }>>("listTemplates", []),
    listRuns: () => callHost<unknown[]>("listRuns", []),
    runTemplate: (id: string, input: Record<string, string>) => callHost<unknown>("runTemplate", [id, input]),
    getRun: (runId: string) => callHost<unknown>("getRun", [runId]),
    getQuotes: (symbols: string[]) => callHost<Quote[]>("getQuotes", [symbols]),
    getFxRates: (base: string, currencies: string[]) =>
      callHost<Record<string, number>>("getFxRates", [base, currencies]),
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

  // Legend geometry — centre two entries in a row below the title.
  const SWATCH = 16;
  const entryW = (s: string) => SWATCH + 6 + s.length * 5.6;
  const legendGap = 20;
  const legendW = entryW(primaryLabel) + legendGap + entryW(compareLabel);
  const legendX = (width - legendW) / 2;
  const legendY = 30;
  const compareEntryX = legendX + entryW(primaryLabel) + legendGap;

  return (
    <svg width={width} height={height} style={{ fontFamily: "sans-serif", overflow: "visible" }}>
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
