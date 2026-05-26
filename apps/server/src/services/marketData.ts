/**
 * Market-data service — live stock quotes and FX rates via the Yahoo Finance
 * v8 chart endpoint (no API key required).
 *
 * Yahoo's v8 chart endpoint is UNOFFICIAL and has no SLA: it can rate-limit,
 * block, or change shape. Callers must treat live data as best-effort — each
 * symbol is fetched in isolation (Promise.allSettled), failures are reported
 * back per-symbol (no longer silently dropped — surfaces show which positions
 * are unquotable), and successful results are cached for a few minutes to
 * keep outbound call volume low.
 *
 * Symbol normalization (AH): users write '005930' or 'AAPL' in their CSV.
 * normalizeSymbol() routes to the right exchange before hitting Yahoo:
 *   - 6-digit numeric → KR (`005930` → `005930.KS`)
 *   - All-caps 2-5 char alpha → US (`AAPL` stays as-is)
 *   - Letter.suffix → as-is (`SAP.DE`, `BRK-B`, `BRK.B` → `BRK-B`)
 *   - Anything else passes through (paper assets / FX pairs handled
 *     by getFxRates path)
 */

import logger from "../logger.js";

// Yahoo provides two equivalent v8 chart endpoints, query1 and query2.
// They occasionally fail independently (one rate-limits while the other
// is fine). We try query1 first, then transparently fall back to query2
// before declaring the symbol unresolved.
const YAHOO_CHART_HOSTS = [
  "https://query1.finance.yahoo.com/v8/finance/chart/",
  "https://query2.finance.yahoo.com/v8/finance/chart/",
];
const UA = "Mozilla/5.0 (compatible; Ariadne/1.0; +https://github.com/ariadne)";
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface Quote {
  symbol: string;
  /** What the user passed in — preserves their original spelling. */
  inputSymbol?: string;
  /** What we actually queried (after normalization). */
  resolvedSymbol?: string;
  price: number;
  currency: string;
  /** Exchange / market identifier from Yahoo's meta block, when present. */
  market?: string;
  /** Provider that resolved this quote. Always 'yahoo' today; an alternate
   *  provider would set its own name and `getQuotesDetailed()` returns it
   *  alongside the value. */
  source?: string;
  /** AO — Yahoo v8 chart's meta block ships these for free when the
   *  underlying instrument has them. Cheap to surface (no extra HTTP) and
   *  lets the detail page render a "live snapshot" panel when the user
   *  hasn't written a thesis or news file yet. */
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  regularMarketVolume?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  previousClose?: number;
}

/** Per-symbol error returned by `getQuotesDetailed()` so surfaces can show
 *  which positions couldn't be priced. */
export interface QuoteError {
  inputSymbol: string;
  resolvedSymbol: string;
  reason: string;
}

interface CacheEntry {
  value: Quote;
  expires: number;
}

// Keyed by Yahoo symbol (uppercased) or "FX:<cur>>;<base>". Only successful
// fetches are cached — caching a failure would freeze a transient blip.
const cache = new Map<string, CacheEntry>();

// ─────────────────────────────────────────────────────────────────────────
// Symbol normalization — routes user-written tickers to the right Yahoo
// suffix per exchange. Conservative: only resolves cases we're confident
// about; anything ambiguous passes through unchanged so the user can
// override via the `quote_symbol` CSV column.
// ─────────────────────────────────────────────────────────────────────────

const KR_6DIGIT = /^\d{6}$/;
const US_BASIC  = /^[A-Z]{1,5}$/;           // AAPL, MSFT, F, V, BRK
const HAS_SUFFIX = /\.[A-Z]{1,3}$/;         // .KS .KQ .AS .DE .L .PA .T .HK
const BRK_DOT = /^([A-Z]+)\.([AB])$/;       // BRK.A → BRK-A, BRK.B → BRK-B (Yahoo wants hyphen)

/** Normalize a user-written ticker to the form Yahoo Finance expects.
 *  Returns the resolved symbol unchanged if no rule applies. */
export function normalizeSymbol(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (!s) return s;
  // 1. KR codes: 6 digits → .KS by default. .KQ (KOSDAQ) is the same length
  //    but Yahoo accepts .KS for both for many KOSDAQ tickers — if your
  //    KOSDAQ stock 404s, override with the explicit `<digits>.KQ` in the
  //    CSV's quote_symbol column. (Heuristic-safe default: .KS.)
  if (KR_6DIGIT.test(s)) return `${s}.KS`;
  // 2. Berkshire-class share suffix: Yahoo uses hyphen, users often write dot.
  const brk = s.match(BRK_DOT);
  if (brk) return `${brk[1]!}-${brk[2]!}`;
  // 3. Anything with an exchange suffix already (SAP.DE, ASML.AS, BRK-B,
  //    VUSA.AS, SXRZ.DE) passes through.
  if (HAS_SUFFIX.test(s)) return s;
  // 4. Crypto / FX pairs (BTC-USD, USDKRW=X) pass through.
  if (s.includes("-") || s.includes("=X")) return s;
  // 5. US basic tickers (AAPL, MSFT, …) pass through.
  if (US_BASIC.test(s)) return s;
  // 6. Anything else — preserve as-is and let Yahoo answer.
  return s;
}

/** Fetch a single symbol's latest price from a single Yahoo v8 host. */
async function fetchYahooQuoteFrom(host: string, symbol: string): Promise<Quote> {
  const url = `${host}${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${host} ${symbol}: HTTP ${res.status}`);

  const data = (await res.json()) as {
    chart?: { result?: Array<{ meta?: {
      regularMarketPrice?: number; currency?: string;
      fullExchangeName?: string; exchangeName?: string;
      fiftyTwoWeekHigh?: number; fiftyTwoWeekLow?: number;
      regularMarketVolume?: number;
      regularMarketDayHigh?: number; regularMarketDayLow?: number;
      previousClose?: number; chartPreviousClose?: number;
    } }> };
  };
  const meta = data.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (typeof price !== "number" || !isFinite(price) || price <= 0) {
    throw new Error(`${host} ${symbol}: no usable price`);
  }
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && isFinite(v) && v > 0 ? v : undefined;
  return {
    symbol,
    resolvedSymbol: symbol,
    price,
    currency: (meta?.currency ?? "").toUpperCase(),
    market: meta?.fullExchangeName ?? meta?.exchangeName ?? undefined,
    source: "yahoo",
    fiftyTwoWeekHigh: num(meta?.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: num(meta?.fiftyTwoWeekLow),
    regularMarketVolume: num(meta?.regularMarketVolume),
    regularMarketDayHigh: num(meta?.regularMarketDayHigh),
    regularMarketDayLow: num(meta?.regularMarketDayLow),
    previousClose: num(meta?.previousClose ?? meta?.chartPreviousClose),
  };
}

/** Fetch with transparent host failover (query1 → query2). Errors from
 *  the last attempt propagate; the surface sees them via the detailed
 *  error API. */
async function fetchYahooQuote(symbol: string): Promise<Quote> {
  let lastErr: unknown = new Error(`no Yahoo hosts configured for ${symbol}`);
  for (const host of YAHOO_CHART_HOSTS) {
    try {
      return await fetchYahooQuoteFrom(host, symbol);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Resolve quotes for the given symbols. Cached. Per-symbol failures
 * are silently dropped from the returned array (legacy API). For a
 * version that reports which symbols failed + why, use
 * `getQuotesDetailed()`.
 */
export async function getQuotes(symbols: string[]): Promise<Quote[]> {
  const { quotes } = await getQuotesDetailed(symbols);
  return quotes;
}

/**
 * Detailed version of getQuotes(): returns the successful quotes AND a
 * per-symbol error list for failures, so the surface can show which
 * positions are currently unquotable (vs silently blanking them).
 * Also surfaces the `resolvedSymbol` so the user can see what Yahoo
 * actually got asked — useful when their CSV ticker mismatches.
 */
export async function getQuotesDetailed(
  symbols: string[],
): Promise<{ quotes: Quote[]; errors: QuoteError[] }> {
  // Normalize once; remember the mapping so we can echo the user's
  // input back even when we queried with a different symbol.
  const mapped = symbols
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ input: s.toUpperCase(), resolved: normalizeSymbol(s) }));
  const dedup = new Map<string, { input: string; resolved: string }>();
  for (const m of mapped) {
    if (!dedup.has(m.resolved)) dedup.set(m.resolved, m);
  }

  const now = Date.now();
  const quotes: Quote[] = [];
  const errors: QuoteError[] = [];
  const toFetch: Array<{ input: string; resolved: string }> = [];

  for (const m of dedup.values()) {
    const hit = cache.get(m.resolved);
    if (hit && hit.expires > now) {
      quotes.push({ ...hit.value, inputSymbol: m.input });
    } else {
      toFetch.push(m);
    }
  }

  if (toFetch.length > 0) {
    const settled = await Promise.allSettled(
      toFetch.map((m) => fetchYahooQuote(m.resolved)),
    );
    settled.forEach((r, i) => {
      const m = toFetch[i]!;
      if (r.status === "fulfilled") {
        cache.set(m.resolved, { value: r.value, expires: now + CACHE_TTL_MS });
        quotes.push({ ...r.value, inputSymbol: m.input });
      } else {
        const reason = String(r.reason);
        logger.warn({ symbol: m.resolved, input: m.input, err: reason }, "market quote fetch failed");
        errors.push({ inputSymbol: m.input, resolvedSymbol: m.resolved, reason });
      }
    });
  }
  return { quotes, errors };
}

// ─────────────────────────────────────────────────────────────────────────
// AQ — Historical price series for benchmark overlay & technical analysis.
// ─────────────────────────────────────────────────────────────────────────

export interface PricePoint { date: string; close: number; }

const HISTORY_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — historical data changes slowly
interface HistoryCacheEntry { points: PricePoint[]; expires: number; }
const historyCache = new Map<string, HistoryCacheEntry>();

const VALID_RANGES = new Set(["1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"]);

async function fetchYahooHistoryFrom(host: string, symbol: string, range: string, interval: string): Promise<PricePoint[]> {
  const url = `${host}${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`${host} ${symbol}: HTTP ${res.status}`);
  const data = (await res.json()) as {
    chart?: { result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }> };
  };
  const r = data.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const closes = r?.indicators?.quote?.[0]?.close ?? [];
  const points: PricePoint[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    const c = closes[i];
    if (typeof t === "number" && typeof c === "number" && isFinite(c) && c > 0) {
      points.push({ date: new Date(t * 1000).toISOString().slice(0, 10), close: c });
    }
  }
  if (points.length === 0) throw new Error(`${host} ${symbol}: no history`);
  return points;
}

/** Historical close prices for a symbol over a Yahoo-supported range.
 *  Cached for 30 min. Per-request defaults: 1y daily. */
export async function getQuoteHistory(
  symbol: string,
  range: string = "1y",
  interval: string = "1d",
): Promise<PricePoint[]> {
  const resolved = normalizeSymbol(symbol);
  const safeRange = VALID_RANGES.has(range) ? range : "1y";
  const key = `H:${resolved}:${safeRange}:${interval}`;
  const now = Date.now();
  const hit = historyCache.get(key);
  if (hit && hit.expires > now) return hit.points;

  let lastErr: unknown = new Error(`no Yahoo hosts configured for ${resolved}`);
  for (const host of YAHOO_CHART_HOSTS) {
    try {
      const points = await fetchYahooHistoryFrom(host, resolved, safeRange, interval);
      historyCache.set(key, { points, expires: now + HISTORY_CACHE_TTL_MS });
      return points;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
