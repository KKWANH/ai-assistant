/**
 * Market-data routes — live stock quotes and FX rates for surfaces.
 *
 * GET /api/market/quotes?symbols=AAPL,005930.KS,BTC-USD
 * GET /api/market/fx?base=USD&symbols=EUR,KRW
 *
 * Upstream (Yahoo) failures degrade to an empty/partial result — these never
 * return 5xx, so a surface can treat live data as best-effort and fall back to
 * its CSV values. Only malformed input returns 400.
 */

import type { FastifyInstance } from "fastify";
import { getQuotes, getQuotesDetailed, getFxRates, normalizeSymbol, getQuoteHistory, getQuoteCalendars } from "../services/marketData.js";

const MAX_SYMBOLS = 60;

function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);
}

export async function marketDataRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { symbols?: string; detailed?: string } }>("/market/quotes", async (req, reply) => {
    const symbols = parseList(req.query.symbols);
    if (symbols.length === 0) {
      return reply.status(400).send({ error: "symbols query param is required" });
    }
    // detailed=1 returns { quotes, errors } — used by surfaces that want
    // to show per-position 'unquotable' badges instead of silently
    // blanking failed symbols. Default shape stays backwards-compatible.
    if (req.query.detailed === "1") {
      const result = await getQuotesDetailed(symbols).catch(() => ({ quotes: [], errors: [] }));
      return reply.send(result);
    }
    const quotes = await getQuotes(symbols).catch(() => []);
    return reply.send({ quotes });
  });

  // GET /api/market/normalize?symbol=005930  → { input: "005930", resolved: "005930.KS" }
  // Lets surfaces preview what a user-written ticker would resolve to
  // before adding it (handy for the watchlist add flow).
  app.get<{ Querystring: { symbol?: string } }>("/market/normalize", async (req, reply) => {
    const raw = (req.query.symbol ?? "").trim();
    if (!raw) return reply.status(400).send({ error: "symbol query param is required" });
    return reply.send({ input: raw.toUpperCase(), resolved: normalizeSymbol(raw) });
  });

  // AQ — historical close prices for a single symbol. Used by the
  // surface's benchmark overlay (^KS200, ^GSPC, etc.) on the value-trend
  // chart. Returns { symbol, points: [{date, close}, ...] }.
  app.get<{ Querystring: { symbol?: string; range?: string; interval?: string } }>("/market/history", async (req, reply) => {
    const raw = (req.query.symbol ?? "").trim();
    if (!raw) return reply.status(400).send({ error: "symbol query param is required" });
    const range = (req.query.range ?? "1y").trim();
    const interval = (req.query.interval ?? "1d").trim();
    try {
      const points = await getQuoteHistory(raw, range, interval);
      return reply.send({ symbol: raw, resolved: normalizeSymbol(raw), points });
    } catch (e) {
      return reply.send({ symbol: raw, resolved: normalizeSymbol(raw), points: [], error: String((e as Error)?.message ?? e) });
    }
  });

  // AR — Calendar events (earnings + ex-div) for one or more symbols.
  app.get<{ Querystring: { symbols?: string } }>("/market/calendar", async (req, reply) => {
    const symbols = parseList(req.query.symbols);
    if (symbols.length === 0) return reply.status(400).send({ error: "symbols query param is required" });
    const calendars = await getQuoteCalendars(symbols).catch(() => []);
    return reply.send({ calendars });
  });

  app.get<{ Querystring: { base?: string; symbols?: string } }>("/market/fx", async (req, reply) => {
    const base = (req.query.base ?? "USD").trim() || "USD";
    const currencies = parseList(req.query.symbols);
    if (currencies.length === 0) {
      return reply.status(400).send({ error: "symbols query param is required" });
    }
    const rates = await getFxRates(base, currencies).catch(() => ({}));
    return reply.send({ base, rates });
  });
}
