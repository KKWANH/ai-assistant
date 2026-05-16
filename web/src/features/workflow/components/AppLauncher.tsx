import React, { useMemo, useState } from "react";
import type { WorkflowAppDefinition } from "../../../entities/workflow-app/types";
import type { WorkflowRunInputValues } from "../../../shared/contracts/workflow";
import { InputSchemaForm } from "./InputSchemaForm";

export function AppLauncher({
  app,
  running,
  error,
  onPreview,
  onRun,
}: {
  app: WorkflowAppDefinition;
  running?: boolean;
  error?: string;
  onPreview?: () => void;
  onRun?: (values: WorkflowRunInputValues) => void;
}) {
  const [values, setValues] = useState<WorkflowRunInputValues>({});
  const [confirmed, setConfirmed] = useState(false);
  const missingRequired = useMemo(
    () => app.inputSchema.filter((field) => field.required && !values[field.id]),
    [app.inputSchema, values],
  );
  const requiresConfirmation = app.runPolicy.requiresConfirmation || app.runPolicy.network !== "blocked" || app.runPolicy.cloud !== "blocked";
  const canRun = missingRequired.length === 0 && (!requiresConfirmation || confirmed);

  return (
    <article className="workflow-app-launcher">
      <div>
        <div className="action-title-row">
          <strong>{app.title}</strong>
          <span className="status-badge ready">{app.category}</span>
        </div>
        <p>{app.description}</p>
        <div className="action-badges">
          <span>{app.runPolicy.mode}</span>
          <span>{app.outputSchema.length} outputs</span>
          <span>{app.defaultViewerLayout.length} viewer slots</span>
        </div>
        <div className="workflow-policy-grid">
          <span><b>Network</b>{app.runPolicy.network}</span>
          <span><b>Cloud</b>{app.runPolicy.cloud}</span>
          <span><b>File write</b>{app.runPolicy.fileWrite}</span>
          <span><b>Confirm</b>{app.runPolicy.requiresConfirmation ? "required" : "not required"}</span>
        </div>
      </div>
      <InputSchemaForm fields={app.inputSchema} values={values} onChange={(id, value) => setValues((current) => ({ ...current, [id]: value }))} />
      <div className="workflow-output-schema">
        <strong>Expected outputs</strong>
        {app.outputSchema.map((output) => (
          <span key={output.id}>
            <code>{output.path}</code>
            <small>{output.type} · {output.viewer_id}</small>
          </span>
        ))}
      </div>
      {requiresConfirmation && (
        <label className="workflow-confirmation">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>Confirmed. Run with the network/cloud/file-write policy shown above.</span>
        </label>
      )}
      {missingRequired.length > 0 && <p className="error-text">Required input: {missingRequired.map((field) => field.label).join(", ")}</p>}
      {error && <p className="error-text">{error}</p>}
      <div className="action-buttons">
        <button type="button" onClick={onPreview}>Review inputs</button>
        <button type="button" onClick={() => onRun?.(values)} disabled={running || !canRun}>{running ? "Running" : "Run app"}</button>
      </div>
    </article>
  );
}
