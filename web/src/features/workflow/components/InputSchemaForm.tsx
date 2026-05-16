import React from "react";
import type { InputSchemaField } from "../../../entities/workflow-app/types";
import type { WorkflowRunInputValues } from "../../../shared/contracts/workflow";

export function InputSchemaForm({
  fields,
  values,
  onChange,
}: {
  fields: InputSchemaField[];
  values: WorkflowRunInputValues;
  onChange: (id: string, value: WorkflowRunInputValues[string]) => void;
}) {
  return (
    <div className="workflow-input-schema">
      {fields.map((field) => (
        <label key={field.id}>
          <span>{field.label}{field.required ? " *" : ""}</span>
          {field.type === "file" ? (
            <input type="file" accept={(field.accept || []).join(",")} onChange={(event) => onChange(field.id, event.target.files?.[0] || null)} />
          ) : field.type === "select" ? (
            <select value={String(values[field.id] ?? "")} onChange={(event) => onChange(field.id, event.target.value)}>
              <option value="">Select</option>
              {(field.options || []).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          ) : field.type === "boolean" ? (
            <input type="checkbox" checked={Boolean(values[field.id])} onChange={(event) => onChange(field.id, event.target.checked)} />
          ) : field.type === "number" ? (
            <input type="number" value={String(values[field.id] ?? "")} placeholder={field.placeholder || ""} onChange={(event) => onChange(field.id, Number(event.target.value))} />
          ) : field.type === "resource" ? (
            <input value={String(values[field.id] ?? field.source?.alias ?? "")} placeholder={field.placeholder || field.source?.alias || ""} onChange={(event) => onChange(field.id, event.target.value)} />
          ) : (
            <input value={String(values[field.id] ?? "")} placeholder={field.placeholder || ""} onChange={(event) => onChange(field.id, event.target.value)} />
          )}
          {field.help && <small>{field.help}</small>}
        </label>
      ))}
    </div>
  );
}
