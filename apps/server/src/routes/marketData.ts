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
import { getQuotes, getFxRates } from "../services/marketData.js";

const MAX_SYMBOLS = 60;

function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);
}

export async function marketDataRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { symbols?: string } }>("/market/quotes", async (req, reply) => {
    const symbols = parseList(req.query.symbols);
    if (symbols.length === 0) {
      return reply.status(400).send({ error: "symbols query param is required" });
    }
    const quotes = await getQuotes(symbols).catch(() => []);
    return reply.send({ quotes });
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
