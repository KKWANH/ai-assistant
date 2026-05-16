import React from "react";

export function AttachmentList({ attachments, onPreview }) {
  if (!attachments.length) return null;
  function statusLabel(item) {
    if (item.extraction_status === "failed") return "Read failed";
    if (item.extraction_status === "success") return "Text extracted";
    if (item.delivery === "Sent as vision input") return "Sent as image input";
    if (item.delivery === "Sent as text context") return "Used as text";
    return item.delivery || "Attached to chat";
  }
  return (
    <div className="attachment-list">
      {attachments.map((item) => {
        const table = item.table_preview || {};
        const columns = Array.isArray(table.columns) ? table.columns : [];
        const rows = Array.isArray(table.rows) ? table.rows : [];
        if (columns.length && rows.length) {
          return (
            <div key={item.url} className="attachment-card table-attachment">
              <div className="attachment-card-head">
                <strong>{item.filename}</strong>
                <small>{table.row_count || rows.length} rows · {table.column_count || columns.length} columns · {table.parser || "table"}</small>
              </div>
              <div className="mini-table-wrap">
                <table>
                  <thead><tr>{columns.slice(0, 6).map((column) => <th key={column}>{column}</th>)}</tr></thead>
                  <tbody>
                    {rows.slice(0, 5).map((row, index) => (
                      <tr key={`${item.url}-${index}`}>
                        {columns.slice(0, 6).map((column) => <td key={column}>{String(row?.[column] ?? "")}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <a href={item.url} target="_blank" rel="noreferrer">Open original</a>
            </div>
          );
        }
        return item.is_image || item.is_pdf ? (
          <button key={item.url} className="attachment-card image" type="button" onClick={() => onPreview(item)}>
            {item.is_image ? <img src={item.url} alt={item.filename} /> : <span className="pdf-thumb" data-pdf-preview>PDF</span>}
            <span>{item.filename}</span>
            <small className={item.extraction_status === "failed" ? "status-failed" : ""}>{statusLabel(item)}</small>
            {item.extraction_status === "failed" && item.extraction_error && <em>{item.extraction_error}</em>}
          </button>
        ) : (
          <a key={item.url} className="attachment-card" href={item.url} target="_blank" rel="noreferrer">
            {item.filename}
            <small className={item.extraction_status === "failed" ? "status-failed" : ""}>{statusLabel(item)}</small>
            {item.extraction_status === "failed" && item.extraction_error && <em>{item.extraction_error}</em>}
          </a>
        );
      })}
    </div>
  );
}
