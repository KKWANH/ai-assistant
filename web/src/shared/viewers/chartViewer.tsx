import React from "react";
import type { ViewerArtifact } from "./registry";

type ChartKind = "bar" | "line" | "pie";

type ChartDatum = {
  label: string;
  value: number;
};

type ChartSpec = {
  version?: 1;
  title?: string;
  kind?: ChartKind;
  mark?: ChartKind | { type?: ChartKind };
  data: ChartDatum[];
  encoding?: {
    x?: string | { field?: string };
    y?: string | { field?: string };
    color?: string | { field?: string };
  };
  xLabel?: string;
  yLabel?: string;
};

type ChartArtifact = ViewerArtifact & {
  content?: string;
};

export function ChartViewer({ artifact }: { artifact: ChartArtifact }) {
  const spec = parseChartSpec(artifact.content);
  if (!spec) {
    return (
      <div className="empty-action-state">
        <p className="muted">Chart artifact must contain a valid bar, line, or pie chart spec.</p>
      </div>
    );
  }
  return (
    <div className="chart-viewer">
      <div>
        <strong>{spec.title || "Chart"}</strong>
        <p className="muted">{spec.kind} chart · {spec.data.length} points</p>
      </div>
      {spec.kind === "line" ? <LineChart spec={spec} /> : null}
      {spec.kind === "bar" ? <BarChart spec={spec} /> : null}
      {spec.kind === "pie" ? <PieChart spec={spec} /> : null}
    </div>
  );
}

export function validateChartArtifact(artifact: ViewerArtifact): artifact is ChartArtifact {
  return parseChartSpec(artifact.content) !== null;
}

function BarChart({ spec }: { spec: ChartSpec }) {
  const max = Math.max(1, ...spec.data.map((item) => item.value));
  return (
    <div className="chart-bars">
      {spec.data.slice(0, 24).map((item) => (
        <div className="chart-bar-row" key={item.label}>
          <span>{item.label}</span>
          <i style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }} />
          <b>{formatValue(item.value)}</b>
        </div>
      ))}
    </div>
  );
}

function LineChart({ spec }: { spec: ChartSpec }) {
  const points = normalizePoints(spec.data);
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  return (
    <svg className="chart-svg" viewBox="0 0 320 160" role="img" aria-label={spec.title || "Line chart"}>
      <polyline points={polyline} fill="none" stroke="currentColor" strokeWidth="3" />
      {points.map((point) => <circle key={`${point.x}-${point.y}`} cx={point.x} cy={point.y} r="3" />)}
    </svg>
  );
}

function PieChart({ spec }: { spec: ChartSpec }) {
  const total = spec.data.reduce((sum, item) => sum + Math.max(0, item.value), 0) || 1;
  const slices = spec.data.slice(0, 12).map((item, index) => ({
    item,
    offset: spec.data.slice(0, index + 1).reduce((sum, slice) => sum + (Math.max(0, slice.value) / total), 0),
    percent: Math.max(0, item.value) / total,
  }));
  return (
    <div className="chart-pie-list">
      {slices.map(({ item, offset, percent }) => (
        <span key={item.label}>
          <i style={{ background: colorFor(offset) }} />
          <b>{item.label}</b>
          <small>{(percent * 100).toFixed(1)}%</small>
        </span>
      ))}
    </div>
  );
}

function normalizePoints(data: ChartDatum[]) {
  const max = Math.max(1, ...data.map((item) => item.value));
  const width = 300;
  const height = 130;
  const step = data.length <= 1 ? 0 : width / (data.length - 1);
  return data.map((item, index) => ({
    x: 10 + (step * index),
    y: 145 - ((Math.max(0, item.value) / max) * height),
  }));
}

function parseChartSpec(content?: string): ChartSpec | null {
  try {
    const parsed = JSON.parse(content || "{}") as unknown;
    if (!isChartSpec(parsed)) return null;
    return normalizeChartSpec(parsed);
  } catch {
    return null;
  }
}

function isChartSpec(value: unknown): value is ChartSpec {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { kind?: unknown; mark?: unknown; data?: unknown; encoding?: unknown };
  const mark = typeof candidate.mark === "object" && candidate.mark ? (candidate.mark as { type?: unknown }).type : candidate.mark;
  if (candidate.kind !== "bar" && candidate.kind !== "line" && candidate.kind !== "pie" && mark !== "bar" && mark !== "line" && mark !== "pie") return false;
  if (!Array.isArray(candidate.data)) return false;
  return candidate.data.length === 0 || candidate.data.every((item) => item && typeof item === "object");
}

function normalizeChartSpec(spec: ChartSpec): ChartSpec {
  const mark = typeof spec.mark === "object" && spec.mark ? spec.mark.type : spec.mark;
  const kind = spec.kind || mark || "bar";
  const xField = fieldName(spec.encoding?.x) || "label";
  const yField = fieldName(spec.encoding?.y) || "value";
  return {
    ...spec,
    kind,
    data: spec.data.slice(0, 200).map((item) => {
      const source = item as ChartDatum & Record<string, unknown>;
      return {
        label: String(source.label ?? source[xField] ?? ""),
        value: Number(source.value ?? source[yField] ?? 0),
      };
    }).filter((item) => item.label && Number.isFinite(item.value)),
  };
}

function fieldName(value: string | { field?: string } | undefined) {
  return typeof value === "string" ? value : value?.field;
}

function formatValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function colorFor(offset: number) {
  const hue = Math.round((offset * 260 + 180) % 360);
  return `hsl(${hue} 72% 62%)`;
}
