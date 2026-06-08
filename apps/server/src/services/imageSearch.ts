/**
 * Image search — finds REAL images with citable sources, for lecture slides
 * and research. Built art-history-first (the motivating user teaches art):
 * the sources below return actual artworks at high resolution with creator,
 * date, and license metadata, so a slide can attribute what it shows.
 *
 * Sources (all keyless, public APIs):
 *   1. Wikimedia Commons   — broadest; precise on named works/artists
 *   2. The Met (Open Access) — museum-grade, mostly public-domain
 *   3. Art Institute of Chicago — museum-grade, rich metadata
 *
 * Each source is queried in parallel and failures degrade to fewer results
 * rather than an error — one slow museum API can't sink the others. Results
 * are interleaved for source diversity and de-duplicated by image URL.
 */

import type { ImageResult } from "@ariadne/shared";
import logger from "../logger.js";

export interface ImageSearchResponse {
  results: ImageResult[];
  /** Sources that actually returned something, for transparency. */
  sources: string[];
}

const TIMEOUT_MS = 9000;

function fetchSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Strip HTML tags + collapse whitespace — Commons metadata is HTML-laden. */
function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Search for images across the art/museum sources. `perSource` caps each
 * source so the combined list stays slide-pickable. Always resolves (never
 * throws) — a failed source contributes nothing.
 */
export async function searchImages(
  query: string,
  signal?: AbortSignal,
  perSource = 6,
): Promise<ImageSearchResponse> {
  const q = query.trim();
  if (!q) return { results: [], sources: [] };

  const settled = await Promise.allSettled([
    searchCommons(q, perSource, signal),
    searchMet(q, perSource, signal),
    searchAic(q, perSource, signal),
  ]);
  const names = ["Wikimedia Commons", "The Met", "Art Institute of Chicago"];
  const lists: ImageResult[][] = [];
  const sources: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.length > 0) {
      lists.push(r.value);
      sources.push(names[i]!);
    } else if (r.status === "rejected") {
      logger.warn({ source: names[i], err: String(r.reason) }, "image source failed");
    }
  });

  // Interleave (one from each source in turn) so the top of the list is
  // diverse rather than 6 Commons hits then 6 Met hits, and de-dupe.
  const seen = new Set<string>();
  const results: ImageResult[] = [];
  for (let row = 0; row < perSource; row++) {
    for (const list of lists) {
      const item = list[row];
      if (!item) continue;
      const key = item.imageUrl;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(item);
    }
  }
  return { results, sources };
}

// ---------------------------------------------------------------------------
// Wikimedia Commons
// ---------------------------------------------------------------------------

async function searchCommons(query: string, limit: number, signal?: AbortSignal): Promise<ImageResult[]> {
  const url =
    "https://commons.wikimedia.org/w/api.php?action=query&generator=search" +
    `&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=${limit.toString()}` +
    "&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=400&format=json&origin=*";
  const res = await fetch(url, {
    headers: { "User-Agent": "Ariadne/1.0 (lecture-prep image search)" },
    signal: fetchSignal(signal),
  });
  if (!res.ok) throw new Error(`Commons ${res.status}`);
  const data = (await res.json()) as {
    query?: { pages?: Record<string, CommonsPage> };
  };
  const pages = Object.values(data.query?.pages ?? {});
  const out: ImageResult[] = [];
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info?.url) continue;
    // Commons indexes non-image files too (PDF/SVG/audio) — keep raster art.
    if (!/\.(jpe?g|png|gif|tiff?|webp)$/i.test(info.url)) continue;
    const meta = info.extmetadata ?? {};
    out.push({
      title: stripTags((p.title ?? "").replace(/^File:/, "").replace(/\.\w+$/, "")),
      thumbUrl: info.thumburl ?? info.url,
      imageUrl: info.url,
      sourceUrl: info.descriptionurl ?? info.url,
      source: "Wikimedia Commons",
      creator: meta.Artist?.value ? stripTags(meta.Artist.value) : undefined,
      date: meta.DateTimeOriginal?.value ? stripTags(meta.DateTimeOriginal.value) : undefined,
      license: meta.LicenseShortName?.value ? stripTags(meta.LicenseShortName.value) : undefined,
    });
  }
  return out;
}

interface CommonsPage {
  title?: string;
  imageinfo?: {
    url?: string;
    thumburl?: string;
    descriptionurl?: string;
    extmetadata?: Record<string, { value?: string }>;
  }[];
}

// ---------------------------------------------------------------------------
// The Met — Open Access
// ---------------------------------------------------------------------------

async function searchMet(query: string, limit: number, signal?: AbortSignal): Promise<ImageResult[]> {
  const base = "https://collectionapi.metmuseum.org/public/collection/v1";
  const sres = await fetch(`${base}/search?hasImages=true&q=${encodeURIComponent(query)}`, {
    signal: fetchSignal(signal),
  });
  if (!sres.ok) throw new Error(`Met search ${sres.status}`);
  const ids = ((await sres.json()) as { objectIDs?: number[] }).objectIDs ?? [];
  // Each object is a second round-trip, so fetch only the top few in parallel.
  const top = ids.slice(0, limit);
  const objects = await Promise.all(
    top.map((id) =>
      fetch(`${base}/objects/${id.toString()}`, { signal: fetchSignal(signal) })
        .then((r) => (r.ok ? (r.json() as Promise<MetObject>) : null))
        .catch(() => null),
    ),
  );
  const out: ImageResult[] = [];
  for (const o of objects) {
    if (!o?.primaryImageSmall) continue;
    out.push({
      title: o.title || "Untitled",
      thumbUrl: o.primaryImageSmall,
      imageUrl: o.primaryImage || o.primaryImageSmall,
      sourceUrl: o.objectURL ?? "https://www.metmuseum.org",
      source: "The Met",
      creator: o.artistDisplayName || undefined,
      date: o.objectDate || undefined,
      license: o.isPublicDomain ? "Public Domain (CC0)" : o.creditLine || undefined,
    });
  }
  return out;
}

interface MetObject {
  title?: string;
  primaryImage?: string;
  primaryImageSmall?: string;
  objectURL?: string;
  artistDisplayName?: string;
  objectDate?: string;
  isPublicDomain?: boolean;
  creditLine?: string;
}

// ---------------------------------------------------------------------------
// Art Institute of Chicago
// ---------------------------------------------------------------------------

async function searchAic(query: string, limit: number, signal?: AbortSignal): Promise<ImageResult[]> {
  const url =
    "https://api.artic.edu/api/v1/artworks/search" +
    `?q=${encodeURIComponent(query)}&limit=${limit.toString()}` +
    "&fields=id,title,image_id,artist_display,date_display,is_public_domain";
  const res = await fetch(url, {
    headers: { "User-Agent": "Ariadne/1.0 (lecture-prep image search)" },
    signal: fetchSignal(signal),
  });
  if (!res.ok) throw new Error(`AIC ${res.status}`);
  const data = (await res.json()) as {
    data?: AicArtwork[];
    config?: { iiif_url?: string };
  };
  const iiif = data.config?.iiif_url ?? "https://www.artic.edu/iiif/2";
  const out: ImageResult[] = [];
  for (const a of data.data ?? []) {
    if (!a.image_id) continue;
    out.push({
      title: a.title || "Untitled",
      thumbUrl: `${iiif}/${a.image_id}/full/200,/0/default.jpg`,
      imageUrl: `${iiif}/${a.image_id}/full/843,/0/default.jpg`,
      sourceUrl: `https://www.artic.edu/artworks/${a.id?.toString() ?? ""}`,
      source: "Art Institute of Chicago",
      creator: a.artist_display || undefined,
      date: a.date_display || undefined,
      license: a.is_public_domain ? "Public Domain (CC0)" : "© Art Institute of Chicago",
    });
  }
  return out;
}

interface AicArtwork {
  id?: number;
  title?: string;
  image_id?: string;
  artist_display?: string;
  date_display?: string;
  is_public_domain?: boolean;
}
