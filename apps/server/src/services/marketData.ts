/**
 * Market-data service — live stock quotes and FX rates via the Yahoo Finance
 * v8 chart endpoint (no API key required).
 *
 * Yahoo's v8 chart endpoint is UNOFFICIAL and has no SLA: it can rate-limit,
 * block, or change shape. Callers must treat live data as best-effort — each
 * symbol is fetched in isolation (Promise.allSettled), failures are dropped
 * rather than thrown, and successful results are cached for a few minutes to
 * keep outbound call volume low.
 */

import logger from "../logger.js";

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/";
const UA = "Mozilla/5.0 (compatible; Ariadne/1.0; +https://github.com/ariadne)";
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface Quote {
  symbol: string;
  price: number;
  currency: string;
}

interface CacheEntry {
  value: Quote;
  expires: number;
}

// Keyed by Yahoo symbol (uppercased) or "FX:<cur>>;<base>". Only successful
// fetches are cached — caching a failure would freeze a transient blip.
const cache = new Map<string, CacheEntry>();

/** Fetch a single symbol's latest price from the Yahoo v8 chart endpoint. */
async function fetchYahooQuote(symbol: string): Promise<Quote> {
  const url = `${YAHOO_CHART}${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);

  const data = (await res.json()) as {
    chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; currency?: string } }> };
  };
  const meta = data.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (typeof price !== "number" || !isFinite(price) || price <= 0) {
    throw new Error(`Yahoo ${symbol}: no usable price`);
  }
  return { symbol, price, currency: (meta?.currency ?? "").toUpperCase() };
}

/** Resolve quotes for the given symbols. Cached; per-symbol failures are dropped. */
export async function getQuotes(symbols: string[]): Promise<Quote[]> {
  const wanted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const now = Date.now();
  const out: Quote[] = [];
  const toFetch: string[] = [];

  for (const sym of wanted) {
    const hit = cache.get(sym);
    if (hit && hit.expires > now) out.push(hit.value);
    else toFetch.push(sym);
  }

  if (toFetch.length > 0) {
    const settled = await Promise.allSettled(toFetch.map((s) => fetchYahooQuote(s)));
    settled.forEach((r, i) => {
      const sym = toFetch[i]!;
      if (r.status === "fulfilled") {
        cache.set(sym, { value: r.value, expires: now + CACHE_TTL_MS });
        out.push(r.value);
      } else {
        logger.warn({ symbol: sym, err: String(r.reason) }, "market quote fetch failed");
      }
    });
  }
  return out;
}

/**
 * USD value of 1 unit of `cur` (USD itself → 1). Cached.
 *
 * Prefers Yahoo's `USD<CUR>=X` pair (`<CUR>` per 1 USD) inverted: that quote
 * keeps full precision even for small-value currencies like KRW, where the
 * direct `<CUR>USD=X` pair is rounded to a couple of digits by Yahoo.
 */
async function usdPerUnit(cur: string): Promise<number> {
  if (cur === "USD") return 1;
  const key = `USD:${cur}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.value.price;

  let rate: number;
  try {
    const perUsd = (await fetchYahooQuote(`USD${cur}=X`)).price;
    if (!isFinite(perUsd) || perUsd <= 0) throw new Error("bad pair");
    rate = 1 / perUsd;
  } catch {
    // Fall back to the direct pair, which already quotes USD per 1 <CUR>.
    rate = (await fetchYahooQuote(`${cur}USD=X`)).price;
    if (!isFinite(rate) || rate <= 0) throw new Error(`fx ${cur}: no rate`);
  }
  cache.set(key, { value: { symbol: key, price: rate, currency: "USD" }, expires: now + CACHE_TTL_MS });
  return rate;
}

/**
 * Resolve FX rates relative to `base` — how many units of `base` 1 unit of each
 * currency is worth (base USD → { USD: 1, EUR: 1.16, KRW: 0.00066 }). The base
 * currency itself is always 1. Currencies that fail to resolve are dropped.
 */
export async function getFxRates(
  base: string,
  currencies: string[],
): Promise<Record<string, number>> {
  const b = base.trim().toUpperCase() || "USD";
  const wanted = [...new Set(currencies.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  const out: Record<string, number> = {};

  // Anchor everything on USD, then divide by the base's USD value.
  const needed = [...new Set([b, ...wanted])];
  const usd: Record<string, number> = {};
  const settled = await Promise.allSettled(needed.map((c) => usdPerUnit(c)));
  settled.forEach((r, i) => {
    const cur = needed[i]!;
    if (r.status === "fulfilled") usd[cur] = r.value;
    else logger.warn({ currency: cur, err: String(r.reason) }, "fx rate fetch failed");
  });

  const baseUsd = usd[b];
  if (!baseUsd || baseUsd <= 0) return out; // base unresolved → no live rates

  for (const cur of wanted) {
    if (cur === b) {
      out[cur] = 1;
    } else if (usd[cur] && usd[cur]! > 0) {
      out[cur] = usd[cur]! / baseUsd;
    }
  }
  return out;
}
