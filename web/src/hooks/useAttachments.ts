import { useCallback, useEffect, useMemo, useState } from "react";
import { fileNeedsVisionModel, type ModelMode } from "../lib/modelModes";

export function useAttachments() {
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const primaryFile = files[0] || null;

  useEffect(() => {
    const urls = files.map((file) => file?.type?.startsWith("image/") ? URL.createObjectURL(file) : "");
    setPreviewUrls(urls);
    setPreviewUrl(urls[0] || "");
    return () => urls.forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }, [files]);

  const addFiles = useCallback((nextFiles?: File[] | FileList | null) => {
    const list = Array.from(nextFiles || []).filter(Boolean);
    if (list.length) setFiles((current) => [...current, ...list]);
    return list;
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }, []);

  const clearFiles = useCallback(() => setFiles([]), []);

  const hasVisionOnlyFiles = useCallback((mode: string, models?: ModelMode[]) => files.some((item) => fileNeedsVisionModel(item, mode, models)), [files]);

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
  }), [files, primaryFile, previewUrl, previewUrls, addFiles, removeFile, clearFiles, hasVisionOnlyFiles]);
}
