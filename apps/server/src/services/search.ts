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

export async function performSearch(query: string): Promise<SearchResponse> {
  const tavilyKey = process.env.TAVILY_API_KEY;
  const braveKey = process.env.BRAVE_API_KEY;

  if (tavilyKey) {
    try {
      return await searchTavily(query, tavilyKey);
    } catch {
      // fall through to next provider
    }
  }

  if (braveKey) {
    try {
      return await searchBrave(query, braveKey);
    } catch {
      // fall through to fallback
    }
  }

  try {
    return await searchDuckDuckGo(query);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      provider: "none (all search providers failed)",
      results: [],
      error: msg,
    };
  }
}

async function searchTavily(query: string, apiKey: string): Promise<SearchResponse> {
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
    signal: AbortSignal.timeout(8000),
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

async function searchBrave(query: string, apiKey: string): Promise<SearchResponse> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "8");

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(8000),
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

async function searchDuckDuckGo(query: string): Promise<SearchResponse> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Ariadne/1.0; +https://github.com/ariadne)",
      Accept: "text/html",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
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
