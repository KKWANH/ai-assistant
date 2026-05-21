/**
 * Portfolio starter — sample files injected when a workspace is created with
 * starter="portfolio".
 *
 * Provides:
 *   holdings.csv   — multi-currency holdings (stocks, ETFs and base assets)
 *   fx_rates.csv   — exchange rates (current + at purchase) per currency
 *   history.csv    — monthly portfolio value and cumulative currency effect
 *   surface.tsx    — a multi-currency financial-analyst dashboard
 *
 * All colours use CSS custom-property tokens (rgb(var(--token))) — no hardcoded
 * hex — so the surface is fully legible in both dark and light mode.
 */

export const HOLDINGS_CSV = `symbol,name,asset_type,sector,currency,shares,buy_price,current_price
AAPL,Apple Inc.,Stock,Technology,USD,50,145.30,224.80
MSFT,Microsoft Corp.,Stock,Technology,USD,30,290.00,478.90
NVDA,NVIDIA Corp.,Stock,Technology,USD,20,145.00,178.40
JPM,JPMorgan Chase & Co.,Stock,Financials,USD,40,145.00,248.60
VOO,Vanguard S&P 500 ETF,ETF,Diversified,USD,35,380.00,512.30
QQQ,Invesco QQQ Trust,ETF,Technology,USD,18,360.00,498.70
GLD,SPDR Gold Shares,Commodity,Commodities,USD,30,178.00,242.10
TLT,iShares 20+ Year Treasury,Bond,Fixed Income,USD,25,98.00,88.40
BTC,Bitcoin,Crypto,Digital Assets,USD,0.5,42000.00,68500.00
ASML,ASML Holding,Stock,Technology,EUR,8,580.00,712.00
MC,LVMH,Stock,Consumer Discretionary,EUR,6,720.00,645.00
005930,Samsung Electronics,Stock,Technology,KRW,150,68000,79500
069500,KODEX 200 ETF,ETF,Diversified,KRW,80,34000,38200
7203,Toyota Motor,Stock,Consumer Discretionary,JPY,100,2100,2980
SHEL,Shell plc,Stock,Energy,GBP,60,24.50,28.90
CSPX,iShares Core S&P 500 ETF,ETF,Diversified,GBP,15,42.00,58.30
`;

export const FX_RATES_CSV = `currency,name,rate,buy_rate
USD,US Dollar,1.0000,1.0000
EUR,Euro,1.0850,1.0550
GBP,British Pound,1.2700,1.2400
JPY,Japanese Yen,0.00650,0.00690
KRW,Korean Won,0.000730,0.000760
`;

export const HISTORY_CSV = `date,value,fx_effect
2025-06,99100,30
2025-07,103400,8
2025-08,100700,-22
2025-09,109200,-58
2025-10,114100,-86
2025-11,110800,-108
2025-12,118600,-132
2026-01,123900,-158
2026-02,120400,-178
2026-03,128700,-192
2026-04,132500,-200
2026-05,136314,-205
`;

export const SURFACE_TSX = `/**
 * Portfolio Analysis — custom Ariadne surface (multi-currency analyst dashboard).
 *
 * Reads holdings.csv, fx_rates.csv and history.csv, then renders KPIs, a value
 * trend, currency exposure, allocation, per-position returns and a sortable
 * holdings table. Click any holding to open a detailed asset page. Toggle
 * "Currency analysis" to break out how exchange-rate moves affected returns.
 *
 * Data model
 *   holdings.csv  symbol,name,asset_type,sector,currency,shares,buy_price,current_price
 *   fx_rates.csv  currency,name,rate,buy_rate   (rate = base-currency units per 1 unit)
 *   history.csv   date,value,fx_effect          (value + cumulative currency effect)
 *
 * The base (reporting) currency is auto-detected as the fx_rates row whose rate
 * is 1. Edit fx_rates.csv to add currencies or report in a different one.
 *
 * This file lives at .ariadne/surface.tsx. Edit it freely, then click "Build"
 * to recompile and see the result in the workspace's Custom screen tab.
 *
 * All colours use CSS variables: rgb(var(--token)). Available tokens include
 * --background, --foreground, --card, --card-foreground, --border, --muted,
 * --muted-foreground, --accent, --accent-foreground, --success, --destructive,
 * --warning, --info.
 */

import { useState, useEffect, useAriadne, LineChart, BarChart, PieChart } from "@ariadne/surface";

// -- Types -------------------------------------------------------------------

interface RawHolding {
  symbol: string;
  name: string;
  assetType: string;
  sector: string;
  currency: string;
  shares: number;
  buyPrice: number;
  price: number;
}

interface FxRate {
  currency: string;
  name: string;
  rate: number;
  buyRate: number;
}

interface Holding extends RawHolding {
  rate: number;
  buyRate: number;
  costLocal: number;
  valueLocal: number;
  costBase: number;
  valueBase: number;
  plBase: number;
  plPctBase: number;
  priceEffect: number;
  fxEffect: number;
  priceReturnPct: number;
  weight: number;
}

interface Point {
  label: string;
  value: number;
}

interface HistPoint {
  label: string;
  value: number;
  fxEffect: number;
}

type View = { page: "overview" } | { page: "asset"; symbol: string };

type SortKey =
  | "symbol"
  | "assetType"
  | "currency"
  | "valueBase"
  | "weight"
  | "plBase"
  | "plPctBase"
  | "fxEffect";

// -- Helpers -----------------------------------------------------------------

function num(s: string | undefined): number {
  const n = parseFloat(s || "0");
  return isFinite(n) ? n : 0;
}

function fmt(n: number, d: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  KRW: "₩",
};

function money(n: number, cur: string): string {
  const sym = CURRENCY_SYMBOL[cur] || "";
  const d = cur === "JPY" || cur === "KRW" ? 0 : 2;
  const body = fmt(Math.abs(n), d);
  const sign = n < 0 ? "-" : "";
  return sym ? sign + sym + body : sign + body + " " + cur;
}

function money0(n: number, cur: string): string {
  const sym = CURRENCY_SYMBOL[cur] || "";
  const body = fmt(Math.abs(n), 0);
  const sign = n < 0 ? "-" : "";
  return sym ? sign + sym + body : sign + body + " " + cur;
}

function signedMoney(n: number, cur: string): string {
  return (n >= 0 ? "+" : "") + money0(n, cur);
}

function signedPct(n: number): string {
  return (n >= 0 ? "+" : "") + fmt(n, 1) + "%";
}

function plColor(n: number): string {
  return n >= 0 ? "rgb(var(--success))" : "rgb(var(--destructive))";
}

const cardStyle = {
  border: "1px solid rgb(var(--border))",
  borderRadius: "10px",
  background: "rgb(var(--card))",
  padding: "14px 16px",
};

const muted = { color: "rgb(var(--muted-foreground))" };

// -- Parse -------------------------------------------------------------------

function parseHoldings(rows: Record<string, string>[]): RawHolding[] {
  return rows
    .map((r) => ({
      symbol: (r["symbol"] || "").trim(),
      name: (r["name"] || "").trim(),
      assetType: (r["asset_type"] || "Other").trim() || "Other",
      sector: (r["sector"] || "Other").trim() || "Other",
      currency: (r["currency"] || "USD").trim().toUpperCase() || "USD",
      shares: num(r["shares"]),
      buyPrice: num(r["buy_price"]),
      price: num(r["current_price"]),
    }))
    .filter((h) => h.symbol.length > 0);
}

function parseFx(rows: Record<string, string>[]): FxRate[] {
  return rows
    .map((r) => {
      const rate = num(r["rate"]) || 1;
      return {
        currency: (r["currency"] || "").trim().toUpperCase(),
        name: (r["name"] || r["currency"] || "").trim(),
        rate,
        buyRate: num(r["buy_rate"]) || rate,
      };
    })
    .filter((f) => f.currency.length > 0);
}

function parseHistory(rows: Record<string, string>[]): HistPoint[] {
  return rows
    .map((r) => ({
      label: (r["date"] || "").trim(),
      value: num(r["value"]),
      fxEffect: num(r["fx_effect"]),
    }))
    .filter((p) => p.label.length > 0);
}

// -- Enrich ------------------------------------------------------------------

function enrich(raw: RawHolding[], fxMap: Record<string, FxRate>, baseRate: number): Holding[] {
  const base = raw.map((h) => {
    const fx = fxMap[h.currency] || { currency: h.currency, name: h.currency, rate: 1, buyRate: 1 };
    const costLocal = h.shares * h.buyPrice;
    const valueLocal = h.shares * h.price;
    const costBase = (costLocal * fx.buyRate) / baseRate;
    const valueBase = (valueLocal * fx.rate) / baseRate;
    const plBase = valueBase - costBase;
    const priceEffect = (h.shares * (h.price - h.buyPrice) * fx.buyRate) / baseRate;
    const fxEffect = (h.shares * h.price * (fx.rate - fx.buyRate)) / baseRate;
    return {
      ...h,
      rate: fx.rate,
      buyRate: fx.buyRate,
      costLocal,
      valueLocal,
      costBase,
      valueBase,
      plBase,
      plPctBase: costBase > 0 ? (plBase / costBase) * 100 : 0,
      priceEffect,
      fxEffect,
      priceReturnPct: h.buyPrice > 0 ? ((h.price - h.buyPrice) / h.buyPrice) * 100 : 0,
      weight: 0,
    };
  });
  const total = base.reduce((s, h) => s + h.valueBase, 0);
  return base.map((h) => ({ ...h, weight: total > 0 ? (h.valueBase / total) * 100 : 0 }));
}

// -- Small components --------------------------------------------------------

function Centered(props: { text: string; tone?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "220px" }}>
      <p style={{ color: props.tone === "error" ? "rgb(var(--destructive))" : "rgb(var(--muted-foreground))" }}>
        {props.text}
      </p>
    </div>
  );
}

function Kpi(props: { label: string; value: string; sub?: string; color?: string; onClick?: () => void }) {
  return (
    <div
      onClick={props.onClick}
      style={{
        ...cardStyle,
        flex: "1 1 158px",
        minWidth: "158px",
        cursor: props.onClick ? "pointer" : "default",
      }}
    >
      <div style={{ fontSize: "11px", color: "rgb(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
        {props.label}
      </div>
      <div style={{ fontSize: "21px", fontWeight: 700, lineHeight: 1.1, color: props.color || "rgb(var(--card-foreground))" }}>
        {props.value}
      </div>
      {props.sub ? (
        <div style={{ fontSize: "12px", marginTop: "3px", color: props.color || "rgb(var(--muted-foreground))" }}>
          {props.sub}
        </div>
      ) : null}
    </div>
  );
}

function Pill(props: { text: string; accent?: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "999px",
        fontSize: "11px",
        fontWeight: 600,
        whiteSpace: "nowrap",
        border: "1px solid rgb(var(--border))",
        color: props.accent ? "rgb(var(--accent-foreground))" : "rgb(var(--muted-foreground))",
        background: props.accent ? "rgb(var(--accent))" : "transparent",
      }}
    >
      {props.text}
    </span>
  );
}

function Chip(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      style={{
        padding: "4px 12px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: 600,
        cursor: "pointer",
        border: "1px solid " + (props.active ? "rgb(var(--accent))" : "rgb(var(--border))"),
        color: props.active ? "rgb(var(--accent-foreground))" : "rgb(var(--muted-foreground))",
        background: props.active ? "rgb(var(--accent))" : "transparent",
      }}
    >
      {props.label}
    </button>
  );
}

function StatRow(props: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", padding: "6px 0", borderBottom: "1px solid rgb(var(--border))" }}>
      <span style={{ fontSize: "13px", ...muted }}>{props.label}</span>
      <span style={{ fontSize: "13px", fontWeight: 600, color: props.color || "rgb(var(--foreground))" }}>
        {props.value}
      </span>
    </div>
  );
}

function SectionTitle(props: { children: string }) {
  return <h2 style={{ fontSize: "15px", fontWeight: 600, margin: "0 0 8px" }}>{props.children}</h2>;
}

// -- Asset detail page -------------------------------------------------------

function AssetDetail(props: { holding: Holding; holdings: Holding[]; baseCurrency: string; onBack: () => void }) {
  const h = props.holding;
  const all = props.holdings;
  const base = props.baseCurrency;

  const totalCost = all.reduce((s, x) => s + x.costBase, 0);
  const totalValue = all.reduce((s, x) => s + x.valueBase, 0);
  const portReturn = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;

  const ranked = [...all].sort((a, b) => b.plPctBase - a.plPctBase);
  const best = ranked[0];
  const byWeight = [...all].sort((a, b) => b.weight - a.weight);
  const rank = byWeight.findIndex((x) => x.symbol === h.symbol) + 1;

  const fxMoved = Math.abs(h.rate - h.buyRate) > 1e-12;
  const fxChangePct = h.buyRate > 0 ? ((h.rate - h.buyRate) / h.buyRate) * 100 : 0;

  const compareData: Point[] = [
    { label: h.symbol, value: Math.round(h.plPctBase * 10) / 10 },
    { label: "Portfolio", value: Math.round(portReturn * 10) / 10 },
    { label: best ? best.symbol : "Best", value: best ? Math.round(best.plPctBase * 10) / 10 : 0 },
  ];

  const backBtn = {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "5px 10px",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
    borderRadius: "8px",
    border: "1px solid rgb(var(--border))",
    background: "transparent",
    color: "rgb(var(--muted-foreground))",
  };

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", padding: "20px 24px", maxWidth: "1180px", margin: "0 auto", color: "rgb(var(--foreground))" }}>
      <button onClick={props.onBack} style={backBtn}>
        {"←  Back to portfolio"}
      </button>

      {/* Asset header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: "12px", flexWrap: "wrap", marginTop: "14px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>{h.symbol}</h1>
        <span style={{ fontSize: "15px", ...muted }}>{h.name}</span>
      </div>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
        <Pill text={h.assetType} accent />
        <Pill text={h.sector} />
        <Pill text={h.currency + " · " + (h.shares.toLocaleString("en-US") + " units")} />
        <Pill text={"Rank #" + rank + " of " + all.length + " by weight"} />
      </div>

      {/* KPI row */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", margin: "16px 0" }}>
        <Kpi label={"Market Value (" + base + ")"} value={money0(h.valueBase, base)} sub={fmt(h.weight, 1) + "% of portfolio"} />
        <Kpi label={"Cost Basis (" + base + ")"} value={money0(h.costBase, base)} />
        <Kpi
          label="Total Return"
          value={signedMoney(h.plBase, base)}
          sub={signedPct(h.plPctBase)}
          color={plColor(h.plBase)}
        />
        <Kpi label="Price Effect" value={signedMoney(h.priceEffect, base)} color={plColor(h.priceEffect)} sub="from asset price" />
        <Kpi label="Currency Effect" value={signedMoney(h.fxEffect, base)} color={plColor(h.fxEffect)} sub="from exchange rate" />
      </div>

      {/* Detail cards */}
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "16px" }}>
        <div style={{ ...cardStyle, flex: "1 1 320px" }}>
          <SectionTitle>Position</SectionTitle>
          <StatRow label="Units held" value={h.shares.toLocaleString("en-US")} />
          <StatRow label={"Average cost (" + h.currency + ")"} value={money(h.buyPrice, h.currency)} />
          <StatRow label={"Current price (" + h.currency + ")"} value={money(h.price, h.currency)} />
          <StatRow
            label="Price return (local)"
            value={signedPct(h.priceReturnPct)}
            color={plColor(h.priceReturnPct)}
          />
          <StatRow label={"Cost basis (" + h.currency + ")"} value={money0(h.costLocal, h.currency)} />
          <StatRow label={"Market value (" + h.currency + ")"} value={money0(h.valueLocal, h.currency)} />
        </div>

        <div style={{ ...cardStyle, flex: "1 1 320px" }}>
          <SectionTitle>Currency and FX</SectionTitle>
          <StatRow label="Quote currency" value={h.currency} />
          <StatRow label={"Reporting currency"} value={base} />
          <StatRow label={"FX rate at purchase"} value={fmt(h.buyRate, h.buyRate < 0.1 ? 6 : 4)} />
          <StatRow label={"FX rate now"} value={fmt(h.rate, h.rate < 0.1 ? 6 : 4)} />
          <StatRow
            label="FX move since purchase"
            value={fxMoved ? signedPct(fxChangePct) : "unchanged"}
            color={fxMoved ? plColor(fxChangePct) : "rgb(var(--muted-foreground))"}
          />
          <StatRow label={"Currency effect (" + base + ")"} value={signedMoney(h.fxEffect, base)} color={plColor(h.fxEffect)} />
        </div>
      </div>

      {/* P/L attribution */}
      <div style={{ ...cardStyle, marginBottom: "16px" }}>
        <SectionTitle>Return attribution</SectionTitle>
        <p style={{ fontSize: "12px", margin: "0 0 8px", ...muted }}>
          How the position moved from cost basis to its current market value, in {base}.
        </p>
        <StatRow label="Cost basis" value={money0(h.costBase, base)} />
        <StatRow label="Asset price effect" value={signedMoney(h.priceEffect, base)} color={plColor(h.priceEffect)} />
        <StatRow label="Currency (FX) effect" value={signedMoney(h.fxEffect, base)} color={plColor(h.fxEffect)} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", padding: "8px 0 0" }}>
          <span style={{ fontSize: "13px", fontWeight: 700 }}>Market value today</span>
          <span style={{ fontSize: "13px", fontWeight: 700 }}>{money0(h.valueBase, base)}</span>
        </div>
      </div>

      {/* Comparison */}
      <div style={{ ...cardStyle, overflowX: "auto" }}>
        <BarChart data={compareData} title="Return % vs portfolio and best" width={760} height={240} />
      </div>

      <p style={{ marginTop: "16px", fontSize: "12px", ...muted }}>
        Edit <code>holdings.csv</code> and <code>fx_rates.csv</code>, then click <strong>Build</strong> to refresh.
      </p>
    </div>
  );
}

// -- Main --------------------------------------------------------------------

export default function PortfolioDashboard() {
  const ariadne = useAriadne();
  const [rawHoldings, setRawHoldings] = useState<RawHolding[]>([]);
  const [fxRates, setFxRates] = useState<FxRate[]>([]);
  const [history, setHistory] = useState<HistPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<View>({ page: "overview" });
  const [fxMode, setFxMode] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("valueBase");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [hoverSym, setHoverSym] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const csv = await ariadne.readCsv("holdings.csv");
        setRawHoldings(parseHoldings(csv.rows));
        try {
          const fx = await ariadne.readCsv("fx_rates.csv");
          setFxRates(parseFx(fx.rows));
        } catch {
          /* fx_rates.csv is optional — without it everything is treated as base currency */
        }
        try {
          const hist = await ariadne.readCsv("history.csv");
          setHistory(parseHistory(hist.rows));
        } catch {
          /* history.csv is optional */
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [ariadne]);

  if (loading) return <Centered text="Loading portfolio..." />;
  if (error) return <Centered text={"Error: " + error} tone="error" />;
  if (rawHoldings.length === 0) return <Centered text="No rows in holdings.csv" />;

  // Resolve currencies and the base (reporting) currency.
  const fxMap: Record<string, FxRate> = {};
  for (const f of fxRates) fxMap[f.currency] = f;
  let baseCurrency = "USD";
  for (const f of fxRates) {
    if (Math.abs(f.rate - 1) < 1e-9) {
      baseCurrency = f.currency;
      break;
    }
  }
  if (!fxMap[baseCurrency] && fxRates.length > 0) baseCurrency = fxRates[0].currency;
  const baseRate = fxMap[baseCurrency] ? fxMap[baseCurrency].rate : 1;

  const holdings = enrich(rawHoldings, fxMap, baseRate);

  // Asset detail page.
  if (view.page === "asset") {
    const target = holdings.find((h) => h.symbol === view.symbol);
    if (target) {
      return (
        <AssetDetail
          holding={target}
          holdings={holdings}
          baseCurrency={baseCurrency}
          onBack={() => setView({ page: "overview" })}
        />
      );
    }
  }

  // Aggregates.
  const totalValue = holdings.reduce((s, h) => s + h.valueBase, 0);
  const totalBasis = holdings.reduce((s, h) => s + h.costBase, 0);
  const totalPL = totalValue - totalBasis;
  const totalPLPct = totalBasis > 0 ? (totalPL / totalBasis) * 100 : 0;
  const totalFx = holdings.reduce((s, h) => s + h.fxEffect, 0);

  const ranked = [...holdings].sort((a, b) => b.plPctBase - a.plPctBase);
  const best = ranked[0];

  const currencies = Object.keys(
    holdings.reduce((acc: Record<string, boolean>, h) => {
      acc[h.currency] = true;
      return acc;
    }, {})
  );

  // Allocation by asset type.
  const typeMap: Record<string, number> = {};
  for (const h of holdings) typeMap[h.assetType] = (typeMap[h.assetType] || 0) + h.valueBase;
  const typeData = Object.keys(typeMap)
    .map((k) => ({ label: k, value: typeMap[k] || 0 }))
    .sort((a, b) => b.value - a.value);

  // Exposure by currency.
  const curMap: Record<string, number> = {};
  for (const h of holdings) curMap[h.currency] = (curMap[h.currency] || 0) + h.valueBase;
  const curData = Object.keys(curMap)
    .map((k) => ({ label: k, value: curMap[k] || 0 }))
    .sort((a, b) => b.value - a.value);

  // Return % per position.
  const returnData = [...holdings]
    .sort((a, b) => b.plPctBase - a.plPctBase)
    .map((h) => ({ label: h.symbol, value: Math.round(h.plPctBase * 10) / 10 }));

  // Trend series.
  const valueSeries: Point[] = history.map((p) => ({ label: p.label, value: p.value }));
  const fxSeries: Point[] = history.map((p) => ({ label: p.label, value: p.fxEffect }));

  // Asset-type filter chips.
  const assetTypes = Object.keys(typeMap).sort();

  // Table rows: filter + sort.
  const filtered = holdings.filter((h) => typeFilter === "all" || h.assetType === typeFilter);
  const sorted = [...filtered].sort((a, b) => {
    let cmp: number;
    if (sortKey === "symbol") cmp = a.symbol.localeCompare(b.symbol);
    else if (sortKey === "assetType") cmp = a.assetType.localeCompare(b.assetType);
    else if (sortKey === "currency") cmp = a.currency.localeCompare(b.currency);
    else cmp = (a[sortKey] as number) - (b[sortKey] as number);
    return sortDir === "asc" ? cmp : -cmp;
  });

  function toggleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(k === "symbol" || k === "assetType" || k === "currency" ? "asc" : "desc");
    }
  }

  const cols: Array<{ key: SortKey | null; label: string; align: string }> = [
    { key: "symbol", label: "Symbol", align: "left" },
    { key: "assetType", label: "Type", align: "left" },
    { key: "currency", label: "Cur", align: "left" },
    { key: null, label: "Units", align: "right" },
    { key: null, label: "Price", align: "right" },
    { key: "valueBase", label: "Mkt Value", align: "right" },
    { key: "weight", label: "Weight", align: "right" },
    { key: "plBase", label: "Unreal. P/L", align: "right" },
  ];
  if (fxMode) cols.push({ key: "fxEffect", label: "FX Effect", align: "right" });
  cols.push({ key: "plPctBase", label: "Return", align: "right" });

  const th = {
    padding: "8px 10px",
    borderBottom: "2px solid rgb(var(--border))",
    fontWeight: 600,
    fontSize: "11px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    color: "rgb(var(--muted-foreground))",
    whiteSpace: "nowrap" as const,
  };
  const td = {
    padding: "7px 10px",
    borderBottom: "1px solid rgb(var(--border))",
    color: "rgb(var(--foreground))",
    whiteSpace: "nowrap" as const,
    fontSize: "13px",
  };

  const fxBtn = {
    display: "flex",
    alignItems: "center",
    gap: "7px",
    padding: "7px 13px",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
    borderRadius: "8px",
    border: "1px solid " + (fxMode ? "rgb(var(--accent))" : "rgb(var(--border))"),
    background: fxMode ? "rgb(var(--accent))" : "transparent",
    color: fxMode ? "rgb(var(--accent-foreground))" : "rgb(var(--muted-foreground))",
  };

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", padding: "20px 24px", maxWidth: "1180px", margin: "0 auto", color: "rgb(var(--foreground))" }}>
      {/* Header + currency-analysis toggle */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>Portfolio Analysis</h1>
          <p style={{ fontSize: "12px", margin: "4px 0 0", ...muted }}>
            {holdings.length + " positions · " + currencies.length + " currencies · reporting in " + baseCurrency}
          </p>
        </div>
        <button onClick={() => setFxMode(!fxMode)} style={fxBtn}>
          {(fxMode ? "◉" : "○") + "  Currency analysis"}
        </button>
      </div>

      {/* KPI row */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", margin: "16px 0" }}>
        <Kpi label={"Market Value (" + baseCurrency + ")"} value={money0(totalValue, baseCurrency)} />
        <Kpi label={"Cost Basis (" + baseCurrency + ")"} value={money0(totalBasis, baseCurrency)} />
        <Kpi
          label="Unrealized P/L"
          value={signedMoney(totalPL, baseCurrency)}
          sub={signedPct(totalPLPct)}
          color={plColor(totalPL)}
        />
        <Kpi
          label="Currency Effect"
          value={signedMoney(totalFx, baseCurrency)}
          sub={totalFx >= 0 ? "FX added value" : "FX reduced value"}
          color={plColor(totalFx)}
        />
        <Kpi
          label="Top Performer"
          value={best ? best.symbol : "-"}
          sub={best ? signedPct(best.plPctBase) : ""}
          color={best ? plColor(best.plPctBase) : undefined}
          onClick={best ? () => setView({ page: "asset", symbol: best.symbol }) : undefined}
        />
      </div>

      {/* Currency-analysis banner */}
      {fxMode ? (
        <div style={{ ...cardStyle, marginBottom: "16px", borderColor: "rgb(var(--accent))" }}>
          <p style={{ fontSize: "13px", margin: 0 }}>
            <strong>Currency analysis on.</strong>{" "}
            <span style={muted}>
              {"Exchange-rate moves changed portfolio value by " + signedMoney(totalFx, baseCurrency) +
                ". The trend below adds a cumulative currency-effect line, and the holdings table breaks out each position's FX effect."}
            </span>
          </p>
        </div>
      ) : null}

      {/* Value trend */}
      {valueSeries.length > 1 ? (
        <div style={{ ...cardStyle, marginBottom: "16px", overflowX: "auto" }}>
          <LineChart data={valueSeries} title={"Portfolio Value (" + baseCurrency + ")"} width={1090} height={250} />
        </div>
      ) : null}

      {/* Currency-effect trend (FX mode) */}
      {fxMode && fxSeries.length > 1 ? (
        <div style={{ ...cardStyle, marginBottom: "16px", overflowX: "auto" }}>
          <LineChart
            data={fxSeries}
            title={"Cumulative Currency Effect (" + baseCurrency + ")"}
            width={1090}
            height={220}
            color="rgb(var(--info))"
          />
        </div>
      ) : null}

      {/* Allocation: asset type + currency */}
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "16px" }}>
        <div style={{ ...cardStyle, flex: "1 1 300px", overflowX: "auto" }}>
          <PieChart data={typeData} title="Allocation by Asset Type" width={340} height={270} />
        </div>
        <div style={{ ...cardStyle, flex: "1 1 300px", overflowX: "auto" }}>
          <PieChart data={curData} title="Exposure by Currency" width={340} height={270} />
        </div>
      </div>

      {/* Return per position */}
      <div style={{ ...cardStyle, marginBottom: "16px", overflowX: "auto" }}>
        <BarChart data={returnData} title="Return % by Position" width={1090} height={260} />
      </div>

      {/* Holdings table */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "8px" }}>
        <SectionTitle>Holdings</SectionTitle>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <Chip label="All" active={typeFilter === "all"} onClick={() => setTypeFilter("all")} />
          {assetTypes.map((tname) => (
            <Chip key={tname} label={tname} active={typeFilter === tname} onClick={() => setTypeFilter(tname)} />
          ))}
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.label}
                  onClick={c.key ? () => toggleSort(c.key as SortKey) : undefined}
                  style={{ ...th, textAlign: c.align as "left" | "right", cursor: c.key ? "pointer" : "default" }}
                >
                  {c.label}
                  {c.key && c.key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((h) => (
              <tr
                key={h.symbol}
                onClick={() => setView({ page: "asset", symbol: h.symbol })}
                onMouseEnter={() => setHoverSym(h.symbol)}
                onMouseLeave={() => setHoverSym(null)}
                style={{ cursor: "pointer", background: hoverSym === h.symbol ? "rgb(var(--muted))" : "transparent" }}
              >
                <td style={{ ...td, fontWeight: 600, color: "rgb(var(--accent))" }}>{h.symbol}</td>
                <td style={td}>{h.assetType}</td>
                <td style={{ ...td, color: "rgb(var(--muted-foreground))" }}>{h.currency}</td>
                <td style={{ ...td, textAlign: "right" }}>{h.shares.toLocaleString("en-US")}</td>
                <td style={{ ...td, textAlign: "right" }}>{money(h.price, h.currency)}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{money0(h.valueBase, baseCurrency)}</td>
                <td style={{ ...td, textAlign: "right", color: "rgb(var(--muted-foreground))" }}>{fmt(h.weight, 1) + "%"}</td>
                <td style={{ ...td, textAlign: "right", color: plColor(h.plBase) }}>{signedMoney(h.plBase, baseCurrency)}</td>
                {fxMode ? (
                  <td style={{ ...td, textAlign: "right", color: plColor(h.fxEffect) }}>{signedMoney(h.fxEffect, baseCurrency)}</td>
                ) : null}
                <td style={{ ...td, textAlign: "right", fontWeight: 600, color: plColor(h.plBase) }}>{signedPct(h.plPctBase)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: "16px", fontSize: "12px", ...muted }}>
        Click any holding to open its detail page. Edit <code>holdings.csv</code>, <code>fx_rates.csv</code> and{" "}
        <code>history.csv</code>, then click <strong>Build</strong> to refresh. Click a column header to sort.
      </p>
    </div>
  );
}
`;
