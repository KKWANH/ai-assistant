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
import { safeResolveUnderRoot } from "../security/pathGuard.js";

export interface UploadMeta {
  name: string;
  mediaType: string;
  kind: "image" | "file";
  size: number;
  /** Account that uploaded this, so the read route can enforce ownership.
   *  Optional for backward compatibility with uploads saved before this field
   *  existed (those are treated as ownerless / readable by any signed-in user). */
  accountId?: string;
}

const uploadsDir = (): string => path.join(PATHS.home, "uploads");

function ensureUploadsDir(): void {
  fs.mkdirSync(uploadsDir(), { recursive: true });
}

/**
 * Resolve an upload's data path, refusing any id that would escape the uploads
 * dir. `uploadId` reaches here straight from a URL param (GET /api/uploads/:id),
 * so a `..`-laced id would otherwise let path.join walk the filesystem. Returns
 * null on escape; the sidecar `.json` lives next to the returned path.
 */
export function resolveUploadPath(uploadId: string): string | null {
  return safeResolveUnderRoot(uploadsDir(), uploadId);
}

export function saveUpload(
  uploadId: string,
  name: string,
  mediaType: string,
  dataBase64: string,
  accountId?: string | null
): UploadMeta {
  ensureUploadsDir();

  const dataPath = resolveUploadPath(uploadId);
  if (!dataPath) throw new Error(`Unsafe uploadId rejected: ${uploadId}`);

  const raw = Buffer.from(dataBase64, "base64");
  const kind: "image" | "file" = mediaType.startsWith("image/") ? "image" : "file";
  const meta: UploadMeta = { name, mediaType, kind, size: raw.length };
  if (accountId) meta.accountId = accountId;

  fs.writeFileSync(dataPath, raw);
  fs.writeFileSync(`${dataPath}.json`, JSON.stringify(meta));

  return meta;
}

export function readUpload(uploadId: string): { data: Buffer; meta: UploadMeta } | null {
  const dataPath = resolveUploadPath(uploadId);
  if (!dataPath) return null;
  const metaPath = `${dataPath}.json`;

  if (!fs.existsSync(dataPath) || !fs.existsSync(metaPath)) return null;

  try {
    const data = fs.readFileSync(dataPath);
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as UploadMeta;
    return { data, meta };
  } catch {
    return null;
  }
}
