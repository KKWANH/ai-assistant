import { useEffect, useMemo, useState } from "react";
import { fileNeedsVisionModel } from "../lib/modelModes.jsx";

export function useAttachments() {
  const [files, setFiles] = useState([]);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewUrls, setPreviewUrls] = useState([]);
  const primaryFile = files[0] || null;

  useEffect(() => {
    const urls = files.map((file) => file?.type?.startsWith("image/") ? URL.createObjectURL(file) : "");
    setPreviewUrls(urls);
    setPreviewUrl(urls[0] || "");
    return () => urls.forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }, [files]);

  const addFiles = (nextFiles) => {
    const list = Array.from(nextFiles || []).filter(Boolean);
    if (list.length) setFiles((current) => [...current, ...list]);
    return list;
  };

  const removeFile = (index) => {
    setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const clearFiles = () => setFiles([]);

  const hasVisionOnlyFiles = (mode, models) => files.some((item) => fileNeedsVisionModel(item, mode, models));

  return useMemo(() => ({
    files,
    primaryFile,
    previewUrl,
    previewUrls,
    addFiles,
    removeFile,
    clearFiles,
    hasVisionOnlyFiles,
    setFiles,
  }), [files, primaryFile, previewUrl, previewUrls]);
}
