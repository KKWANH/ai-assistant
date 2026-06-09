/**
 * Web search service — extracted from routes/search.ts so it can be reused
 * by the chat context builder without importing a Fastify route module.
 *
 * Provider priority:
 *   1. TAVILY_API_KEY  → Tavily Search API
 *   2. BRAVE_API_KEY   → Brave Search API
 *   3. Keyless fallback → DuckDuckGo HTML lite (parsed)
 */

import type { SearchResponse } from "@ariadne/shared";

/** Combine an optional caller signal with an 8-second network timeout. */
function fetchSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(8000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function performSearch(query: string, signal?: AbortSignal): Promise<SearchResponse> {
  const tavilyKey = process.env.TAVILY_API_KEY;
  const braveKey = process.env.BRAVE_API_KEY;

  if (tavilyKey) {
    try {
      return await searchTavily(query, tavilyKey, signal);
    } catch {
      // fall through to next provider
    }
  }

  if (braveKey) {
    try {
      return await searchBrave(query, braveKey, signal);
    } catch {
      // fall through to fallback
    }
  }

  try {
    return await searchDuckDuckGo(query, signal);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      provider: "none (all search providers failed)",
      results: [],
      error: msg,
    };
  }
}

async function searchTavily(query: string, apiKey: string, signal?: AbortSignal): Promise<SearchResponse> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: 8,
      search_depth: "basic",
      include_raw_content: false,
    }),
    signal: fetchSignal(signal),
  });

  if (!res.ok) {
    throw new Error(`Tavily API error: ${res.status}`);
  }

  const data = (await res.json()) as {
    results?: { title?: string; url?: string; content?: string }[];
  };

  return {
    provider: "tavily",
    results: (data.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.content ?? "",
    })),
  };
}

async function searchBrave(query: string, apiKey: string, signal?: AbortSignal): Promise<SearchResponse> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "8");

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: fetchSignal(signal),
  });

  if (!res.ok) {
    throw new Error(`Brave Search API error: ${res.status}`);
  }

  const data = (await res.json()) as {
    web?: { results?: { title?: string; url?: string; description?: string }[] };
  };

  return {
    provider: "brave",
    results: (data.web?.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.description ?? "",
    })),
  };
}

async function searchDuckDuckGo(query: string, signal?: AbortSignal): Promise<SearchResponse> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Ariadne/1.0; +https://github.com/ariadne)",
      Accept: "text/html",
    },
    redirect: "follow",
    signal: fetchSignal(signal),
  });

  if (!res.ok) {
    throw new Error(`DuckDuckGo request failed: ${res.status}`);
  }

  const html = await res.text();
  return {
    provider: "duckduckgo (keyless)",
    results: parseDdgHtml(html),
  };
}

function parseDdgHtml(html: string): { title: string; url: string; snippet: string }[] {
  const results: { title: string; url: string; snippet: string }[] = [];

  const linkRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const links: { url: string; title: string }[] = [];
  let m: RegExpExecArray | null;

  while ((m = linkRe.exec(html)) !== null) {
    const rawUrl = m[1] ?? "";
    const rawTitle = m[2] ?? "";

    let url = rawUrl;
    try {
      const parsed = new URL(rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl);
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) url = decodeURIComponent(uddg);
    } catch {
      // keep raw
    }

    const title = stripTags(rawTitle).trim();
    if (title && url) {
      links.push({ url, title });
    }
  }

  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) !== null) {
    snippets.push(stripTags(m[1] ?? "").trim());
  }

  for (let i = 0; i < Math.min(links.length, 8); i++) {
    const link = links[i];
    if (link) {
      results.push({
        title: link.title,
        url: link.url,
        snippet: snippets[i] ?? "",
      });
    }
  }

  return results;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Shared SSRF guard: parse a URL and return it only when it is safe to fetch
 * server-side — http(s) scheme and not a loopback/private/link-local host.
 * Returns null otherwise. Used anywhere the server fetches a caller-influenced
 * URL (page reading, slide-image embedding).
 */
export function parsePublicHttpUrl(url: string): URL | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".local") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return null;
  }
  return u;
}

/**
 * Fetch a web page and reduce it to readable text — no html-parser dependency.
 * Turns snippet-only search into page-reading search: the model can extract
 * tables, rankings, and detail it could never see from a 150-char snippet.
 * Crude (regex strip) but robust + dependency-free; best-effort, returns "" on
 * any failure. SSRF-guarded: http(s) only, never loopback/private hosts.
 */
export async function fetchUrlText(url: string, signal?: AbortSignal): Promise<string> {
  const u = parsePublicHttpUrl(url);
  if (!u) return "";
  try {
    const res = await fetch(u.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Ariadne/1.0)",
        Accept: "text/html,text/plain",
      },
      redirect: "follow",
      signal: fetchSignal(signal),
    });
    if (!res.ok) return "";
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/(html|plain)/i.test(ct)) return "";
    const raw = (await res.text()).slice(0, 800_000);
    return htmlToText(raw);
  } catch {
    return "";
  }
}

/** Strip an HTML document to readable text: drop script/style/comments, turn
 *  block-level closes into newlines, remove the remaining tags, decode common
 *  entities, collapse whitespace. Heavier than stripTags (which is for inline
 *  fragments) — this is for whole documents. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
