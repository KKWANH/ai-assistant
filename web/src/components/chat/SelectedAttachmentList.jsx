import React from "react";

export function SelectedAttachmentList({ files, previewUrl, previewUrls = [], selectedMode, onRemove }) {
  if (!files.length) return null;
  return (
    <div className="selected-file">
      {files.map((item, index) => (
        <span className="selected-file-chip" key={`${item.name}-${index}`}>
          {(previewUrls[index] || (index === 0 ? previewUrl : "")) && <img src={previewUrls[index] || previewUrl} alt={item.name} />}
          <span>{item.name}</span>
          <small>
            {selectedMode.supportsImage && item.type.startsWith("image/")
              ? "Sent as image input"
              : item.type.startsWith("image/")
                ? "Needs vision model"
                : "Read as text"}
          </small>
          <button type="button" data-remove-attachment onClick={() => onRemove(index)}>Remove</button>
        </span>
      ))}
    </div>
  );
}
