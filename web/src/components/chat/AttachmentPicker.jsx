import React from "react";
import { ATTACHMENT_ACCEPT } from "../../lib/modelModes.jsx";

export function AttachmentPicker({ inputRef, label = "Attach file", onFiles, className = "attach-key" }) {
  return (
    <label className={className} title="Attach file">
      {label}
      <input
        ref={inputRef}
        data-attachment-input
        type="file"
        multiple
        onChange={(event) => onFiles(Array.from(event.target.files || []))}
        accept={ATTACHMENT_ACCEPT}
      />
    </label>
  );
}
