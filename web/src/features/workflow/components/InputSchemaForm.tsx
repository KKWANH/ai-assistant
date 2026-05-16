import React from "react";
import type { InputSchemaField } from "../../../entities/workflow-app/types";

export function InputSchemaForm({ fields }: { fields: InputSchemaField[] }) {
  return (
    <div className="workflow-input-schema">
      {fields.map((field) => (
        <label key={field.id}>
          <span>{field.label}{field.required ? " *" : ""}</span>
          {field.type === "file" ? (
            <input type="file" accept={(field.accept || []).join(",")} disabled />
          ) : field.type === "select" ? (
            <select disabled>{(field.options || []).map((item) => <option key={item.value}>{item.label}</option>)}</select>
          ) : field.type === "boolean" ? (
            <input type="checkbox" disabled />
          ) : (
            <input placeholder={field.placeholder || ""} disabled />
          )}
          {field.help && <small>{field.help}</small>}
        </label>
      ))}
    </div>
  );
}
