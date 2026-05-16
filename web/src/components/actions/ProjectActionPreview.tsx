import React from "react";
import { actionKindLabel, type PreviewRecord } from "./projectActionRuntime";

export function ProjectActionPreview({ preview, compact = false, power = false }: { preview: PreviewRecord; compact?: boolean; power?: boolean }) {
  if (compact) {
    return (
      <div className="run-result preview-result compact-result">
        <strong>Pre-run review</strong>
        <p className="muted">{preview.description || preview.label}</p>
        {power && preview.cwd && <code>{preview.cwd}</code>}
        {preview.prompt && <pre>{preview.prompt.slice(0, 1200)}</pre>}
      </div>
    );
  }

  return (
    <div className="run-result preview-result">
      <strong>Pre-run review</strong>
      <dl>
        <div><dt>App</dt><dd>{preview.label}</dd></div>
        <div><dt>Kind</dt><dd>{actionKindLabel(preview.kind)}</dd></div>
        <div><dt>Permission</dt><dd>{preview.permission}</dd></div>
        {preview.cwd && <div><dt>Location</dt><dd><code>{preview.cwd}</code></dd></div>}
        {preview.command_line && <div><dt>Command</dt><dd><code>{preview.command_line}</code></dd></div>}
        {preview.script && <div><dt>Script</dt><dd><code>{preview.script}</code></dd></div>}
      </dl>
      {(preview.expected_input_files || []).length > 0 && <p className="muted">Input files: {(preview.expected_input_files || []).slice(0, 5).join(", ")}</p>}
      {(preview.expected_output_files || []).length > 0 && <p className="muted">Output files: {(preview.expected_output_files || []).slice(0, 5).join(", ")}</p>}
      {preview.prompt && <pre>{preview.prompt.slice(0, 1600)}</pre>}
    </div>
  );
}
