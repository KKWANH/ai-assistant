/**
 * Surface utilities — formatters, FX conversion, region heuristics.
 * Pure functions only — no React imports, no SDK calls.
 */

export function fmtMoney(amount: number, currency: string): string {
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
 *  (each entry = how many base-units 1 unit of `from` equals). */
export function toBase(amount: number, from: string, fxMap: Record<string, number>): number {
  const rate = fxMap[from] ?? (from === "MIXED" ? 1 : 1);
  return amount * rate;
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
