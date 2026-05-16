import React, { useState } from "react";
import { MarkdownRenderer } from "../markdown/MarkdownRenderer";
import { COPY } from "../../shared/copy/copy";
import { looksLikePastedTable } from "../../lib/table";
import type { ArtifactRecord } from "../../shared/contracts/workbench";

type TableWorkbenchPanelProps = {
  open: boolean;
  file?: File | null;
  rows: string[][];
  running?: boolean;
  onClose: () => void;
  onChooseFile: () => void;
  onSetText?: (text: string) => void;
  onDropFile?: (files: File[]) => void;
  onRun: () => void;
  copy?: typeof COPY;
};

export function TableWorkbenchPanel({ open, file, rows, running = false, onClose, onChooseFile, onSetText, onDropFile, onRun, copy = COPY }: TableWorkbenchPanelProps) {
  const [text, setText] = useState("");
  const tableCopy = copy.table || COPY.table;
  if (!open) return null;
  function drop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    const dropped = Array.from(event.dataTransfer?.files || []);
    if (dropped.length) onDropFile?.(dropped);
  }
  function paste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const value = event.clipboardData?.getData("text/plain") || "";
    if (!value.trim()) return;
    event.preventDefault();
    setText(value);
    onSetText?.(value);
  }
  return (
    <section className="table-workbench" onDragOver={(event) => event.preventDefault()} onDrop={drop}>
      <div className="section-row">
        <div className="panel-title-stack"><p className="eyebrow">{tableCopy.eyebrow}</p><h2>{tableCopy.title}</h2></div>
        <button type="button" onClick={onClose}>{tableCopy.close}</button>
      </div>
      <div className="table-drop-zone">
        <strong>{file ? file.name : tableCopy.emptyDrop}</strong>
        <span>{tableCopy.pastedHint}</span>
        <div className="table-actions">
          <button type="button" onClick={onChooseFile}>{tableCopy.chooseFile}</button>
          <button type="button" onClick={onRun} disabled={!file || running}>{running ? tableCopy.analyzing : tableCopy.analyze}</button>
        </div>
      </div>
      <textarea
        className="table-paste-box"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          if (looksLikePastedTable(event.target.value)) onSetText?.(event.target.value);
        }}
        onPaste={paste}
        placeholder={tableCopy.pastePlaceholder}
      />
      {rows.length > 0 ? <TablePreview rows={rows} /> : <div className="empty-action-state"><p className="muted">{tableCopy.noPreview}</p><span>{tableCopy.noPreviewHint}</span></div>}
    </section>
  );
}

function TablePreview({ rows }: { rows: string[][] }) {
  return (
    <div className="artifact-table-wrap live-table-preview">
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

export function HomeArtifactContent({ artifact }: { artifact: ArtifactRecord & { kind?: string; content?: string } }) {
  const kind = artifact.type || artifact.kind;
  const content = artifact.content || "";
  if (kind === "csv") {
    const rows = content.trim().split(/\r?\n/).slice(0, 80).map((line: string) => line.split(","));
    return (
      <div className="artifact-table-wrap">
        <table className="artifact-table"><tbody>{rows.map((row, rowIndex) => <tr key={`${rowIndex}-${row.join("|")}`}>{row.map((cell, cellIndex) => rowIndex === 0 ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>
      </div>
    );
  }
  if (kind === "json") {
    return <pre>{formatJson(content)}</pre>;
  }
  if (kind === "md" || kind === "markdown") return <MarkdownRenderer>{content}</MarkdownRenderer>;
  return <pre>{content}</pre>;
}

function formatJson(content: string) {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}
