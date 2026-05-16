import React from "react";

export function ChartViewer({ artifact }: { artifact: { content?: string } }) {
  const spec = parseChartSpec(artifact.content);
  const series = Array.isArray(spec.series) ? spec.series.slice(0, 10) : [];
  const max = Math.max(1, ...series.map((item) => Number(item.value) || 0));
  return (
    <div className="chart-viewer">
      <strong>{spec.title || "Chart"}</strong>
      {series.length === 0 ? <p className="muted">No chart series found.</p> : series.map((item) => (
        <div className="chart-bar-row" key={item.label}>
          <span>{item.label}</span>
          <i style={{ width: `${Math.max(4, ((Number(item.value) || 0) / max) * 100)}%` }} />
          <b>{Number(item.value || 0).toFixed(2)}</b>
        </div>
      ))}
    </div>
  );
}

function parseChartSpec(content = ""): { title?: string; series?: Array<{ label: string; value: number }> } {
  try {
    return JSON.parse(content || "{}");
  } catch {
    return {};
  }
}
