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

// ── LineChart ──────────────────────────────────────────────────────────────

export interface LineChartProps {
  data: Array<{ label: string; value: number }>;
  width?: number;
  height?: number;
  title?: string;
  /** Override line colour — should be a CSS colour string using var(--token). */
  color?: string;
}

export function LineChart({ data, width = 480, height = 240, title, color }: LineChartProps) {
  const lineColor = color ?? CV.accent;
  const textColor = CV.foreground;
  const mutedColor = CV.mutedFg;
  const gridColor = CV.border;

  if (!data.length) return <svg width={width} height={height} />;

  const PAD = { top: title ? 32 : 16, right: 16, bottom: 32, left: 48 };
  const W = width - PAD.left - PAD.right;
  const H = height - PAD.top - PAD.bottom;

  const values = data.map((d) => d.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  const x = (i: number) => (i / (data.length - 1)) * W;
  const y = (v: number) => H - ((v - minV) / range) * H;

  const points = data.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");

  return (
    <svg width={width} height={height} style={{ fontFamily: "sans-serif", overflow: "visible" }}>
      {title && (
        <text x={width / 2} y={14} textAnchor="middle" fontSize={13} fontWeight={600} fill={textColor}>
          {title}
        </text>
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
                {v.toFixed(1)}
              </text>
            </g>
          );
        })}
        {/* X-axis labels */}
        {data.map((d, i) => (
          <text
            key={i}
            x={x(i)}
            y={H + 16}
            textAnchor="middle"
            fontSize={10}
            fill={mutedColor}
          >
            {d.label.length > 6 ? `${d.label.slice(0, 5)}…` : d.label}
          </text>
        ))}
        {/* Line */}
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
  const textColor = CV.foreground;
  const mutedColor = CV.mutedFg;
  const gridColor = CV.border;

  if (!data.length) return <svg width={width} height={height} />;

  const PAD = { top: title ? 32 : 16, right: 16, bottom: 40, left: 48 };
  const W = width - PAD.left - PAD.right;
  const H = height - PAD.top - PAD.bottom;

  const maxV = Math.max(...data.map((d) => d.value), 0);
  const barW = Math.max(4, W / data.length - 4);

  return (
    <svg width={width} height={height} style={{ fontFamily: "sans-serif", overflow: "visible" }}>
      {title && (
        <text x={width / 2} y={14} textAnchor="middle" fontSize={13} fontWeight={600} fill={textColor}>
          {title}
        </text>
      )}
      <g transform={`translate(${PAD.left},${PAD.top})`}>
        {/* Y gridlines */}
        {[0, 0.5, 1].map((t) => {
          const v = t * maxV;
          const yp = H - (maxV > 0 ? (v / maxV) * H : 0);
          return (
            <g key={t}>
              <line x1={0} y1={yp} x2={W} y2={yp} stroke={gridColor} strokeDasharray="4 2" />
              <text x={-6} y={yp + 4} textAnchor="end" fontSize={10} fill={mutedColor}>
                {v.toFixed(1)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const bh = maxV > 0 ? (d.value / maxV) * H : 0;
          const bx = (i / data.length) * W + 2;
          const by = H - bh;
          return (
            <g key={i}>
              <rect x={bx} y={by} width={barW} height={bh} fill={barColor} rx={2} opacity={0.85} />
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
        <line x1={0} y1={H} x2={W} y2={H} stroke={gridColor} />
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
