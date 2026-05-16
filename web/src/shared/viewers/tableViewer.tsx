import React from "react";

export function TableViewer({ artifact }: { artifact: { content?: string } }) {
  const rows = String(artifact.content || "").trim().split(/\r?\n/).slice(0, 80).map((line) => line.split(","));
  if (!rows.length || !rows[0]?.[0]) return <div className="empty-action-state"><p className="muted">No table rows to preview.</p></div>;
  return (
    <div className="artifact-table-wrap">
      <table className="artifact-table">
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${rowIndex}-${row.join("|")}`}>
              {row.map((cell, cellIndex) => rowIndex === 0 ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
