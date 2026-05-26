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
import type { Transaction, RealizedPnL, RiskMetrics, HistPoint, Contribution, TaxBucket, RawPosition } from "./types";

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

// ─ AR — Performance attribution ──────────────────────────────────────────
// contribution_pp = (position_weight × position_return) / 100
// Aggregated per-sector for the "어느 섹터가 alpha 만들었나" view.
export function computeContributions(
  positions: RawPosition[],
  fxMap: Record<string, number>,
): { contributions: Contribution[]; bySector: Array<{ sector: string; contributionPp: number; weightPct: number }> } {
  const totalInvested = positions.reduce((s, p) => s + toBase(p.market_value, p.currency, fxMap), 0);
  if (totalInvested <= 0) return { contributions: [], bySector: [] };
  const contributions: Contribution[] = positions
    .filter((p) => Number.isFinite(p.return_pct))
    .map((p) => {
      const baseValue = toBase(p.market_value, p.currency, fxMap);
      const weightPct = (baseValue / totalInvested) * 100;
      const returnPct = Number.isFinite(p.return_pct) ? p.return_pct : 0;
      const contributionPp = (weightPct * returnPct) / 100;
      return {
        symbol: p.symbol,
        name: p.name || p.symbol,
        sector: p.sector || "기타",
        weightPct,
        returnPct,
        contributionPp,
      };
    })
    .sort((a, b) => Math.abs(b.contributionPp) - Math.abs(a.contributionPp));

  // Sector aggregation. Sum contributions; weight is the cohort weight.
  const sectorMap = new Map<string, { contributionPp: number; weightPct: number }>();
  for (const c of contributions) {
    const cur = sectorMap.get(c.sector) ?? { contributionPp: 0, weightPct: 0 };
    cur.contributionPp += c.contributionPp;
    cur.weightPct += c.weightPct;
    sectorMap.set(c.sector, cur);
  }
  const bySector = Array.from(sectorMap.entries())
    .map(([sector, v]) => ({ sector, ...v }))
    .sort((a, b) => Math.abs(b.contributionPp) - Math.abs(a.contributionPp));
  return { contributions, bySector };
}

// ─ AR — Tax-regime YTD realized P&L ──────────────────────────────────────
// Group realized P&L by tax_regime (taken from positions/current.csv).
// Known regimes with default exemption + rate; other regimes recorded
// with no threshold (raw realized only).
//
// KR resident defaults (2026):
//   KR-haewae   해외주식 양도세 — ₩2.5M 공제, 22% (basic 20% + local 2%)
//   KR-국내주식 대주주 외 양도세 면제, 배당 15.4% (held position info only)
//   KR-ISA      ISA 비과세, 한도 별도 tracking
// BE resident:
//   BE-cgt      Capital gains — €10,000 exemption, 33% above
//   BE-Reynders Bond fund 30% on capital gains (no exemption)
//   BE-roerend  배당/이자 30% (RV)
const TAX_REGIMES: Record<string, { label: string; exemption?: number; taxRate?: number; currency: string; notes?: string }> = {
  // KR resident regimes
  "KR-haewae":  { label: "KR 해외주식 양도세",     exemption: 2_500_000, taxRate: 0.22,  currency: "KRW", notes: "연 ₩2.5M 공제, 초과분 22%" },
  "KR-std":     { label: "KR 국내주식 양도세",     exemption: undefined,  taxRate: undefined, currency: "KRW", notes: "대주주 외 비과세 (배당 15.4%)" },
  "KR-국내":     { label: "KR 국내주식 양도세",     exemption: undefined,  taxRate: undefined, currency: "KRW", notes: "대주주 외 비과세 (배당 15.4%)" },
  "KR-ISA":     { label: "KR ISA 비과세 (한도내)", exemption: undefined,  taxRate: 0,     currency: "KRW", notes: "₩200~400만 비과세 + 9.9% 분리과세 (한도 별도)" },
  // BE resident regimes
  "BE-cgt":             { label: "BE 양도세",            exemption: 10_000,     taxRate: 0.33,  currency: "EUR", notes: "연 €1만 공제, 초과분 33%" },
  "BE-foreign-broker":  { label: "BE 외국 브로커 양도세", exemption: 10_000,     taxRate: 0.33,  currency: "EUR", notes: "Revolut/BUX 등 — €1만 공제, 초과분 33% + TOB" },
  "BE-Reynders":        { label: "BE Reynders세",        exemption: undefined,  taxRate: 0.30,  currency: "EUR", notes: "채권 펀드 자본이득 30%, 공제 없음" },
  "BE-roerend":         { label: "BE 동산세 (배당·이자)", exemption: undefined,  taxRate: 0.30,  currency: "EUR", notes: "배당 / 이자 30%" },
};

export function computeTaxBuckets(
  transactions: Transaction[],
  positions: RawPosition[],
): TaxBucket[] {
  const ytdCutoff = `${new Date().getFullYear()}-01-01`;
  const ytdTx = transactions.filter((t) => t.date >= ytdCutoff);
  // Build lookup: symbol → tax_regime + currency from positions.
  const regimeBySymbol = new Map<string, { regime: string; currency: string }>();
  for (const p of positions) {
    if (p.symbol) regimeBySymbol.set(p.symbol, { regime: p.tax_regime || "기타", currency: p.currency || "KRW" });
  }

  // Compute realized via FIFO per symbol, but only count YTD sells.
  const symRealized = computeRealized(ytdTx);
  const byRegime = new Map<string, { realized: number; dividends: number; positions: Set<string>; currency: string }>();
  for (const r of symRealized) {
    const meta = regimeBySymbol.get(r.symbol) ?? { regime: "기타", currency: r.currency };
    const cur = byRegime.get(meta.regime) ?? { realized: 0, dividends: 0, positions: new Set(), currency: meta.currency };
    cur.realized += r.realized;
    cur.dividends += r.dividends;
    cur.positions.add(r.symbol);
    byRegime.set(meta.regime, cur);
  }

  const out: TaxBucket[] = [];
  for (const [regime, v] of byRegime) {
    const meta = TAX_REGIMES[regime];
    out.push({
      regime,
      label: meta?.label ?? regime,
      realizedYTD: v.realized,
      realizedCurrency: meta?.currency ?? v.currency,
      exemption: meta?.exemption,
      taxRate: meta?.taxRate,
      dividendsYTD: v.dividends,
      positions: v.positions.size,
      notes: meta?.notes,
    });
  }
  // Sort: regimes with realized > 0 first, then by absolute realized desc.
  out.sort((a, b) => Math.abs(b.realizedYTD) - Math.abs(a.realizedYTD));
  return out;
}
