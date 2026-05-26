/**
 * Surface utilities — formatters, FX conversion, region heuristics.
 * Pure functions only — no React imports, no SDK calls.
 */

export function fmtMoney(amount: number | undefined | null, currency: string): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  const abs = Math.abs(amount);
  let s: string;
  if (currency === "KRW") {
    if (abs >= 1_000_000_000) s = (amount / 1_000_000_000).toFixed(2) + "B";
    else if (abs >= 1_000_000) s = (amount / 1_000_000).toFixed(2) + "M";
    else if (abs >= 1_000) s = (amount / 1_000).toFixed(0) + "K";
    else s = amount.toFixed(0);
    return "₩" + s;
  }
  if (currency === "USD") return "$" + amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (currency === "EUR") return "€" + amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (currency === "JPY") return "¥" + amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return amount.toLocaleString() + " " + currency;
}

export function fmtPct(p: number): string {
  if (Number.isNaN(p)) return "—";
  const sign = p >= 0 ? "+" : "";
  return sign + p.toFixed(2) + "%";
}

export function daysBetween(iso: string, ref: Date = new Date()): number {
  const d = new Date(iso);
  return Math.floor((ref.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export function daysUntil(iso: string, ref: Date = new Date()): number {
  return -daysBetween(iso, ref);
}

/** FX conversion: amount in `from` → base. fxMap is { USD: 0.00075, EUR: 0.00072, KRW: 1 }
 *  (each entry = how many base-units 1 unit of `from` equals).
 *  AM defensive: undefined / NaN amounts → 0. Better than propagating NaN
 *  through derived totals (the previous behaviour caused the whole
 *  positions table to render '—' because every fmtMoney(NaN) collapsed). */
export function toBase(amount: number, from: string, fxMap: Record<string, number>): number {
  if (!Number.isFinite(amount)) return 0;
  const rate = fxMap[from] ?? (from === "MIXED" ? 1 : 1);
  return amount * rate;
}

/** Format a possibly-undefined number safely. AN — used everywhere a
 *  CSV-derived number reaches the DOM, since malformed rows / missing
 *  columns turn into NaN and crash callers like
 *  `pos.buy_price.toLocaleString()`. */
export function fmtNum(n: number | undefined | null, opts?: { decimals?: number }): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, opts?.decimals != null
    ? { minimumFractionDigits: opts.decimals, maximumFractionDigits: opts.decimals }
    : undefined);
}

/** Region heuristic — uses Yahoo-style symbol suffixes + currency fallback. */
export function regionOf(symbol: string, currency: string): string {
  if (/^\d{6}$/.test(symbol) || /\.KS$/.test(symbol) || /\.KQ$/.test(symbol)) return "한국";
  if (/\.AS$/.test(symbol) || /\.DE$/.test(symbol) || /\.PA$/.test(symbol) || /\.L$/.test(symbol)) return "유럽";
  if (currency === "EUR") return "유럽";
  if (currency === "KRW") return "한국";
  if (currency === "USD") return "미국";
  return "기타";
}

// ─ AQ — FIFO realized P&L from transaction log ───────────────────────────
import type { Transaction, RealizedPnL, RiskMetrics, HistPoint } from "./types";

interface Lot { date: string; shares: number; price: number; fee: number; }

/** Compute per-symbol realized P&L using FIFO lot matching. Buys add to
 *  the lot queue; sells consume oldest lots first. Dividends accumulate
 *  separately. Fees are tracked but not deducted from realized (callers
 *  can compute net realized = realized - fees if they want to). */
export function computeRealized(transactions: Transaction[]): RealizedPnL[] {
  const bySym = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!t.symbol) continue;
    const arr = bySym.get(t.symbol) ?? [];
    arr.push(t);
    bySym.set(t.symbol, arr);
  }

  const out: RealizedPnL[] = [];
  for (const [symbol, txs] of bySym) {
    txs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const lots: Lot[] = [];
    let realized = 0;
    let proceeds = 0;
    let costSold = 0;
    let fees = 0;
    let dividends = 0;
    let sellCount = 0;
    let name = "";
    let currency = "";
    let firstDate = "";
    let lastDate = "";

    for (const t of txs) {
      if (t.name && !name) name = t.name;
      if (t.currency && !currency) currency = t.currency;
      if (!firstDate || t.date < firstDate) firstDate = t.date;
      if (!lastDate || t.date > lastDate) lastDate = t.date;

      const shares = Number(t.shares);
      const price = Number(t.price);
      const fee = Number(t.fee ?? 0);

      if (t.action === "buy" && Number.isFinite(shares) && Number.isFinite(price)) {
        lots.push({ date: t.date, shares, price, fee: Number.isFinite(fee) ? fee : 0 });
      } else if (t.action === "sell" && Number.isFinite(shares) && Number.isFinite(price)) {
        sellCount += 1;
        if (Number.isFinite(fee)) fees += fee;
        let remaining = shares;
        let lotCost = 0;
        while (remaining > 0 && lots.length > 0) {
          const lot = lots[0]!;
          const take = Math.min(lot.shares, remaining);
          lotCost += take * lot.price;
          lot.shares -= take;
          remaining -= take;
          if (lot.shares <= 0.0000001) lots.shift();
        }
        const sellProceeds = shares * price;
        proceeds += sellProceeds;
        costSold += lotCost;
        realized += sellProceeds - lotCost;
      } else if (t.action === "dividend") {
        // Dividends recorded as shares × price (per-share dividend) OR
        // as `price` alone (total payout). Accept either.
        const amt = Number.isFinite(price) && price > 0
          ? (Number.isFinite(shares) && shares > 0 ? shares * price : price)
          : (Number.isFinite(fee) ? fee : 0);
        if (Number.isFinite(amt)) dividends += amt;
      }
    }

    if (sellCount > 0 || dividends > 0) {
      out.push({
        symbol, name: name || symbol, currency: currency || "KRW",
        realized, proceeds, costSold, fees, dividends,
        firstDate, lastDate, sellCount,
      });
    }
  }
  out.sort((a, b) => Math.abs(b.realized) - Math.abs(a.realized));
  return out;
}

// ─ AQ — Risk metrics from monthly history.csv ────────────────────────────
// vol: annualised stdev of monthly returns × √12. Sharpe = mean / stdev
// (rf = 0). maxDrawdown: largest peak-to-trough on the value series.
export function computeRiskMetrics(history: HistPoint[], sectorWeights: Array<{ label: string; value: number }>): RiskMetrics | null {
  if (history.length < 3) return null;
  const sorted = history.slice().sort((a, b) => (a.label < b.label ? -1 : 1));
  const values = sorted.map((h) => h.value).filter((v) => Number.isFinite(v) && v > 0);
  if (values.length < 3) return null;

  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!;
    const curr = values[i]!;
    if (prev > 0) returns.push((curr - prev) / prev);
  }
  if (returns.length === 0) return null;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(returns.length - 1, 1);
  const stdev = Math.sqrt(variance);
  const volAnnual = stdev * Math.sqrt(12) * 100;
  const sharpe = stdev > 0 ? (mean * 12) / (stdev * Math.sqrt(12)) : 0;

  let peak = values[0]!;
  let maxDD = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }

  const total = sectorWeights.reduce((s, w) => s + Math.max(0, w.value), 0);
  let hhi = 0;
  if (total > 0) {
    for (const w of sectorWeights) {
      if (w.value > 0) {
        const p = w.value / total;
        hhi += p * p;
      }
    }
  }

  return {
    volPctAnnual: volAnnual,
    sharpe,
    maxDrawdownPct: maxDD * 100,
    sectorHHI: hhi,
    monthsUsed: returns.length,
  };
}

// ─ AQ — Majority-currency detection (auto-pick base) ─────────────────────
export function detectMajorityCurrency(
  rows: Array<{ market_value: number; currency: string }>,
): string | null {
  if (rows.length === 0) return null;
  const tally = new Map<string, number>();
  for (const r of rows) {
    if (!r.currency || r.currency === "MIXED") continue;
    if (!Number.isFinite(r.market_value)) continue;
    tally.set(r.currency, (tally.get(r.currency) ?? 0) + Math.abs(r.market_value));
  }
  let bestCur: string | null = null;
  let bestSum = -Infinity;
  for (const [cur, sum] of tally) {
    if (sum > bestSum) { bestSum = sum; bestCur = cur; }
  }
  return bestCur;
}

// ─ AQ — localStorage helpers (safe for iframe sandbox) ───────────────────
const LS_KEY = "ariadne:portfolio:base-currency";
export function loadBaseFromStorage(): string | null {
  try { return localStorage.getItem(LS_KEY); } catch { return null; }
}
export function saveBaseToStorage(base: string): void {
  try { localStorage.setItem(LS_KEY, base); } catch { /* */ }
}
