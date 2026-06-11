/**
 * Image search — finds REAL images with citable sources, for lecture slides
 * and research. Built art-history-first (the motivating user teaches art):
 * the sources below return actual artworks at high resolution with creator,
 * date, and license metadata, so a slide can attribute what it shows.
 *
 * Sources (all keyless, public APIs):
 *   1. Wikimedia Commons        — broadest; precise on named works/artists
 *   2. Art Institute of Chicago  — museum-grade, rich metadata
 *   3. Cleveland Museum of Art   — Open Access (CC0), strong on non-Western too
 * (The Met was dropped — it now blocks programmatic access behind a bot WAF.)
 *
 * Each source is queried in parallel and failures degrade to fewer results
 * rather than an error — one slow museum API can't sink the others. Within
 * each source results are re-ranked by query-term overlap (so loose keyword
 * matches sink), then interleaved for source diversity and de-duped by URL.
 * Korean (and other non-Latin) queries are translated to English art terms
 * upstream — see the /images/search route — since these catalogs index in
 * English.
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
    searchAic(q, perSource, signal),
    searchCleveland(q, perSource, signal),
  ]);
  const names = ["Wikimedia Commons", "Art Institute of Chicago", "Cleveland Museum of Art"];
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

  // Relevance re-rank inside each source: score by how many query terms (≥3
  // chars) appear in title + creator, so loose keyword hits (e.g. the PAINTING
  // "American Gothic" for "gothic cathedral") sink below precise ones. Stable
  // sort keeps the source's own order within equal scores.
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  if (terms.length > 0) {
    const score = (r: ImageResult): number => {
      const hay = `${r.title} ${r.creator ?? ""}`.toLowerCase();
      return terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
    };
    for (const list of lists) {
      const scored = list.map((r, i) => ({ r, s: score(r), i }));
      scored.sort((a, b) => b.s - a.s || a.i - b.i);
      list.splice(0, list.length, ...scored.map((x) => x.r));
    }
  }

  // Interleave (one from each source in turn) so the top of the list is
  // diverse rather than 6 from one source then 6 from the next, and de-dupe.
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

// Note: The Met Open Access API was dropped — it now sits behind a bot-
// detection WAF that 403s all programmatic access (verified in isolation),
// and bypassing bot-detection is off-limits. Cleveland (CC0) replaces its
// museum-grade coverage.

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

// ---------------------------------------------------------------------------
// Cleveland Museum of Art — Open Access (keyless, CC0)
// ---------------------------------------------------------------------------

async function searchCleveland(query: string, limit: number, signal?: AbortSignal): Promise<ImageResult[]> {
  const url =
    "https://openaccess-api.clevelandart.org/api/artworks/" +
    `?q=${encodeURIComponent(query)}&has_image=1&limit=${limit.toString()}` +
    "&fields=id,title,creators,creation_date,images,url,share_license_status";
  const res = await fetch(url, {
    headers: { "User-Agent": "Ariadne/1.0 (lecture-prep image search)" },
    signal: fetchSignal(signal),
  });
  if (!res.ok) throw new Error(`Cleveland ${res.status}`);
  const data = (await res.json()) as { data?: ClevelandArt[] };
  const out: ImageResult[] = [];
  for (const a of data.data ?? []) {
    const web = a.images?.web?.url;
    const print = a.images?.print?.url;
    const img = web ?? print;
    if (!img) continue;
    out.push({
      title: a.title || "Untitled",
      thumbUrl: web ?? img,
      imageUrl: print ?? img,
      sourceUrl: a.url || "https://www.clevelandart.org",
      source: "Cleveland Museum of Art",
      creator: a.creators?.[0]?.description || undefined,
      date: a.creation_date || undefined,
      license: a.share_license_status === "CC0" ? "Public Domain (CC0)" : a.share_license_status || undefined,
    });
  }
  return out;
}

interface ClevelandArt {
  id?: number;
  title?: string;
  creators?: { description?: string }[];
  creation_date?: string;
  url?: string;
  share_license_status?: string;
  images?: { web?: { url?: string }; print?: { url?: string } };
}
