/**
 * Inline-base64 upload helpers.
 *
 * Raw bytes are saved at:   <PATHS.home>/uploads/<uploadId>
 * Sidecar metadata at:      <PATHS.home>/uploads/<uploadId>.json
 *
 * kind = "image" when mediaType starts with "image/", else "file".
 */

import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config.js";

export interface UploadMeta {
  name: string;
  mediaType: string;
  kind: "image" | "file";
  size: number;
}

const uploadsDir = (): string => path.join(PATHS.home, "uploads");

function ensureUploadsDir(): void {
  fs.mkdirSync(uploadsDir(), { recursive: true });
}

export function saveUpload(
  uploadId: string,
  name: string,
  mediaType: string,
  dataBase64: string
): UploadMeta {
  ensureUploadsDir();

  const raw = Buffer.from(dataBase64, "base64");
  const kind: "image" | "file" = mediaType.startsWith("image/") ? "image" : "file";
  const meta: UploadMeta = { name, mediaType, kind, size: raw.length };

  fs.writeFileSync(path.join(uploadsDir(), uploadId), raw);
  fs.writeFileSync(
    path.join(uploadsDir(), `${uploadId}.json`),
    JSON.stringify(meta)
  );

  return meta;
}

export function readUpload(uploadId: string): { data: Buffer; meta: UploadMeta } | null {
  const dataPath = path.join(uploadsDir(), uploadId);
  const metaPath = path.join(uploadsDir(), `${uploadId}.json`);

  if (!fs.existsSync(dataPath) || !fs.existsSync(metaPath)) return null;

  try {
    const data = fs.readFileSync(dataPath);
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as UploadMeta;
    return { data, meta };
  } catch {
    return null;
  }
}
