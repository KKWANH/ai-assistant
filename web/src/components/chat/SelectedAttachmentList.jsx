import React from "react";

export function SelectedAttachmentList({ files, previewUrl, previewUrls = [], selectedMode, onRemove, copy = {} }) {
  if (!files.length) return null;
  const labels = {
    sentImage: "Sent as image input",
    needsVision: "Needs vision model",
    readText: "Read as text",
    remove: "Remove",
    ...copy,
  };
  return (
    <div className="selected-file">
      {files.map((item, index) => (
        <span className="selected-file-chip" key={`${item.name}-${index}`}>
          {(previewUrls[index] || (index === 0 ? previewUrl : "")) && <img src={previewUrls[index] || previewUrl} alt={item.name} />}
          <span>{item.name}</span>
          <small>
            {selectedMode.supportsImage && item.type.startsWith("image/")
              ? labels.sentImage
              : item.type.startsWith("image/")
                ? labels.needsVision
                : labels.readText}
          </small>
          <button type="button" data-remove-attachment onClick={() => onRemove(index)}>{labels.remove}</button>
        </span>
      ))}
    </div>
  );
}
