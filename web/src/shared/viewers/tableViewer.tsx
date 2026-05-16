import React, { useMemo, useState } from "react";
import Papa from "papaparse";

type TableArtifact = {
  content?: string;
  path?: string;
};

type ColumnSummary = {
  name: string;
  type: "number" | "date" | "boolean" | "text" | "empty";
  missing: number;
  min?: number;
  max?: number;
  mean?: number;
};

type SortState = {
  column: string;
  direction: "asc" | "desc";
} | null;

export function TableViewer({ artifact }: { artifact: TableArtifact }) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const parsed = useMemo(() => parseTable(artifact.content || "", artifact.path || ""), [artifact.content, artifact.path]);
  const visibleRows = useMemo(() => filterAndSortRows(parsed.rows, filter, sort), [parsed.rows, filter, sort]);
  const previewRows = visibleRows.slice(0, 120);

  if (!parsed.headers.length) {
    return (
      <div className="empty-action-state">
        <p className="muted">No table rows to preview.</p>
      </div>
    );
  }

  function cycleSort(column: string) {
    setSort((current) => {
      if (!current || current.column !== column) return { column, direction: "asc" };
      if (current.direction === "asc") return { column, direction: "desc" };
      return null;
    });
  }

  function copyVisibleRows() {
    const csv = Papa.unparse(previewRows, { columns: parsed.headers });
    void navigator.clipboard?.writeText(csv);
  }

  return (
    <div className="table-viewer">
      <div className="table-viewer-toolbar">
        <div>
          <strong>{parsed.rowCount.toLocaleString()} rows</strong>
          <span className="muted"> · {parsed.headers.length.toLocaleString()} columns · {parsed.missingValues.toLocaleString()} missing values</span>
        </div>
        <div className="table-viewer-actions">
          <input
            aria-label="Filter table"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter rows"
          />
          <button type="button" className="ghost-button" onClick={copyVisibleRows}>Copy visible CSV</button>
        </div>
      </div>
      <div className="table-summary-grid">
        {parsed.summary.slice(0, 8).map((column) => (
          <span key={column.name} title={summaryTitle(column)}>
            <b>{column.name}</b>
            <small>{column.type} · missing {column.missing}</small>
          </span>
        ))}
      </div>
      <div className="artifact-table-wrap">
        <table className="artifact-table">
          <thead>
            <tr>
              {parsed.headers.map((header) => (
                <th key={header}>
                  <button type="button" className="table-sort-button" onClick={() => cycleSort(header)}>
                    {header}{sort?.column === header ? ` ${sort.direction === "asc" ? "↑" : "↓"}` : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, rowIndex) => (
              <tr key={`${rowIndex}-${parsed.headers.map((header) => String(row[header] ?? "")).join("|")}`}>
                {parsed.headers.map((header) => <td key={header}>{String(row[header] ?? "")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visibleRows.length > previewRows.length ? (
        <p className="muted">Showing first {previewRows.length} matching rows.</p>
      ) : null}
    </div>
  );
}

function parseTable(content: string, path: string) {
  const delimiter = path.toLowerCase().endsWith(".tsv") ? "\t" : "";
  const result = Papa.parse<Record<string, string>>(content, {
    delimiter,
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });
  const rows = result.data.filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
  const headers = result.meta.fields?.filter(Boolean) || inferHeaders(rows);
  const summary = headers.map((header) => summarizeColumn(header, rows));
  return {
    headers,
    rows,
    rowCount: rows.length,
    missingValues: summary.reduce((total, column) => total + column.missing, 0),
    summary,
  };
}

function inferHeaders(rows: Array<Record<string, string>>) {
  return Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
}

function summarizeColumn(name: string, rows: Array<Record<string, string>>): ColumnSummary {
  const values = rows.map((row) => String(row[name] ?? "").trim());
  const present = values.filter((value) => value !== "");
  const numbers = present.map(Number).filter((value) => Number.isFinite(value));
  const type = inferType(present, numbers);
  const base: ColumnSummary = { name, type, missing: values.length - present.length };
  if (type === "number" && numbers.length) {
    const total = numbers.reduce((sum, value) => sum + value, 0);
    return { ...base, min: Math.min(...numbers), max: Math.max(...numbers), mean: total / numbers.length };
  }
  return base;
}

function inferType(values: string[], numbers: number[]): ColumnSummary["type"] {
  if (!values.length) return "empty";
  if (numbers.length === values.length) return "number";
  if (values.every((value) => /^(true|false|yes|no)$/i.test(value))) return "boolean";
  if (values.every((value) => !Number.isNaN(Date.parse(value)))) return "date";
  return "text";
}

function filterAndSortRows(rows: Array<Record<string, string>>, filter: string, sort: SortState) {
  const lower = filter.trim().toLowerCase();
  const filtered = lower
    ? rows.filter((row) => Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(lower)))
    : rows;
  if (!sort) return filtered;
  return [...filtered].sort((left, right) => compareValues(left[sort.column], right[sort.column], sort.direction));
}

function compareValues(left: string | undefined, right: string | undefined, direction: "asc" | "desc") {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const result = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    ? leftNumber - rightNumber
    : String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true, sensitivity: "base" });
  return direction === "asc" ? result : -result;
}

function summaryTitle(column: ColumnSummary) {
  if (column.type !== "number") return `${column.name}: ${column.type}`;
  return `${column.name}: min ${formatNumber(column.min)}, max ${formatNumber(column.max)}, mean ${formatNumber(column.mean)}`;
}

function formatNumber(value?: number) {
  return typeof value === "number" ? value.toFixed(2) : "n/a";
}
