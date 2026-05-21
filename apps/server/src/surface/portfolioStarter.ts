/**
 * Portfolio starter — sample files injected when a workspace is created with
 * starter="portfolio".
 *
 * Provides:
 *   holdings.csv   — sample equity holdings (with sector)
 *   history.csv    — monthly portfolio market value
 *   surface.tsx    — a financial-analyst dashboard reading both CSVs
 *
 * All colours use CSS custom-property tokens (rgb(var(--token))) — no hardcoded
 * hex — so the surface is fully legible in both dark and light mode.
 */

export const HOLDINGS_CSV = `symbol,name,sector,shares,buy_price,current_price
AAPL,Apple Inc.,Technology,50,145.30,178.90
MSFT,Microsoft Corp.,Technology,30,290.00,415.20
GOOGL,Alphabet Inc.,Communication,12,120.00,168.50
AMZN,Amazon.com Inc.,Consumer Discretionary,15,130.00,185.30
NVDA,NVIDIA Corp.,Technology,20,450.00,875.40
TSLA,Tesla Inc.,Consumer Discretionary,25,260.00,248.70
META,Meta Platforms Inc.,Communication,18,350.00,512.80
JPM,JPMorgan Chase & Co.,Financials,40,145.00,198.60
JNJ,Johnson & Johnson,Health Care,35,160.00,152.40
XOM,Exxon Mobil Corp.,Energy,45,98.00,118.70
V,Visa Inc.,Financials,22,210.00,279.30
UNH,UnitedHealth Group,Health Care,10,470.00,521.60
`;

export const HISTORY_CSV = `date,value
2025-06,68200
2025-07,70900
2025-08,69100
2025-09,73400
2025-10,77800
2025-11,75600
2025-12,79900
2026-01,83100
2026-02,85400
2026-03,82700
2026-04,86900
2026-05,89139
`;

export const SURFACE_TSX = `/**
 * Portfolio Analysis — custom Ariadne surface (financial-analyst dashboard).
 *
 * Reads holdings.csv (and optional history.csv) and renders KPIs, a value
 * trend, sector allocation, per-position return and a sortable holdings table.
 *
 * This file lives at .ariadne/surface.tsx. Edit it freely, then click "Build"
 * to recompile and see the result in the workspace's Custom screen tab.
 *
 * The "@ariadne/surface" import gives you:
 *   - React (re-exported) + useState / useEffect
 *   - useAriadne()  → SDK: readCsv, readText, listFiles, runTemplate, theme
 *   - LineChart, BarChart, PieChart  → token-aware SVG charts
 *
 * All colours use CSS variables: rgb(var(--token)). Available tokens include
 * --background, --foreground, --card, --card-foreground, --border, --muted,
 * --muted-foreground, --accent, --success, --destructive, --warning, --info.
 */

import { useState, useEffect, useAriadne, LineChart, BarChart, PieChart } from "@ariadne/surface";

// ── Types ──────────────────────────────────────────────────────────────────

interface Holding {
  symbol: string;
  name: string;
  sector: string;
  shares: number;
  cost: number;
  price: number;
  basis: number;
  value: number;
  pl: number;
  plPct: number;
  weight: number;
}

interface Point {
  label: string;
  value: number;
}

type SortKey = "symbol" | "sector" | "value" | "weight" | "pl" | "plPct";

// ── Helpers ────────────────────────────────────────────────────────────────

function num(s: string | undefined): number {
  const n = parseFloat(s ?? "0");
  return isFinite(n) ? n : 0;
}

function fmt(n: number, d = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function usd(n: number): string {
  return (n < 0 ? "-$" : "$") + fmt(Math.abs(n), 0);
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

// ── Parse ───────────────────────────────────────────────────────────────────

function parseHoldings(rows: Record<string, string>[]): Holding[] {
  const base = rows.map((r) => {
    const shares = num(r["shares"]);
    const cost = num(r["buy_price"]);
    const price = num(r["current_price"]);
    const basis = shares * cost;
    const value = shares * price;
    const pl = value - basis;
    return {
      symbol: r["symbol"] ?? "",
      name: r["name"] ?? "",
      sector: r["sector"] ?? "Other",
      shares,
      cost,
      price,
      basis,
      value,
      pl,
      plPct: basis > 0 ? (pl / basis) * 100 : 0,
      weight: 0,
    };
  });
  const total = base.reduce((s, h) => s + h.value, 0);
  return base.map((h) => ({ ...h, weight: total > 0 ? (h.value / total) * 100 : 0 }));
}

// ── Small components ─────────────────────────────────────────────────────────

function Centered(props: { text: string; tone?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "220px" }}>
      <p style={{ color: props.tone === "error" ? "rgb(var(--destructive))" : "rgb(var(--muted-foreground))" }}>
        {props.text}
      </p>
    </div>
  );
}

function Kpi(props: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ ...cardStyle, flex: "1 1 158px", minWidth: "158px" }}>
      <div style={{ fontSize: "11px", color: "rgb(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
        {props.label}
      </div>
      <div style={{ fontSize: "22px", fontWeight: 700, lineHeight: 1.1, color: props.color ?? "rgb(var(--card-foreground))" }}>
        {props.value}
      </div>
      {props.sub ? (
        <div style={{ fontSize: "12px", marginTop: "3px", color: props.color ?? "rgb(var(--muted-foreground))" }}>
          {props.sub}
        </div>
      ) : null}
    </div>
  );
}

function Mover(props: { label: string; h: Holding }) {
  const h = props.h;
  return (
    <div style={{ ...cardStyle, flex: "1 1 240px", minWidth: "240px", display: "flex", alignItems: "center", gap: "12px" }}>
      <div style={{ width: "44px", height: "44px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "13px", color: "rgb(var(--accent-foreground))", background: "rgb(var(--accent))" }}>
        {h.symbol}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", ...muted }}>{props.label}</div>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "rgb(var(--foreground))" }}>{h.name}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: "16px", fontWeight: 700, color: plColor(h.pl) }}>{signedPct(h.plPct)}</div>
        <div style={{ fontSize: "12px", color: plColor(h.pl) }}>{(h.pl >= 0 ? "+" : "") + usd(h.pl)}</div>
      </div>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

export default function PortfolioDashboard() {
  const ariadne = useAriadne();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [history, setHistory] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    async function load() {
      try {
        const csv = await ariadne.readCsv("holdings.csv");
        setHoldings(parseHoldings(csv.rows));
        try {
          const hist = await ariadne.readCsv("history.csv");
          setHistory(hist.rows.map((r) => ({ label: r["date"] ?? "", value: num(r["value"]) })));
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

  if (loading) return <Centered text="Loading portfolio…" />;
  if (error) return <Centered text={"Error: " + error} tone="error" />;
  if (holdings.length === 0) return <Centered text="No rows in holdings.csv" />;

  // Aggregates
  const totalValue = holdings.reduce((s, h) => s + h.value, 0);
  const totalBasis = holdings.reduce((s, h) => s + h.basis, 0);
  const totalPL = totalValue - totalBasis;
  const totalPLPct = totalBasis > 0 ? (totalPL / totalBasis) * 100 : 0;

  const ranked = [...holdings].sort((a, b) => b.plPct - a.plPct);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  // Sector allocation
  const sectorMap: Record<string, number> = {};
  for (const h of holdings) sectorMap[h.sector] = (sectorMap[h.sector] ?? 0) + h.value;
  const sectorData = Object.keys(sectorMap)
    .map((k) => ({ label: k, value: sectorMap[k] ?? 0 }))
    .sort((a, b) => b.value - a.value);

  const returnData = [...holdings]
    .sort((a, b) => b.plPct - a.plPct)
    .map((h) => ({ label: h.symbol, value: Math.round(h.plPct * 10) / 10 }));

  // Table sort
  const sorted = [...holdings].sort((a, b) => {
    let cmp: number;
    if (sortKey === "symbol") cmp = a.symbol.localeCompare(b.symbol);
    else if (sortKey === "sector") cmp = a.sector.localeCompare(b.sector);
    else cmp = (a[sortKey] as number) - (b[sortKey] as number);
    return sortDir === "asc" ? cmp : -cmp;
  });

  function toggleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(k === "symbol" || k === "sector" ? "asc" : "desc");
    }
  }

  const cols: Array<{ key: SortKey | null; label: string; align: string }> = [
    { key: "symbol", label: "Symbol", align: "left" },
    { key: "sector", label: "Sector", align: "left" },
    { key: null, label: "Shares", align: "right" },
    { key: null, label: "Avg Cost", align: "right" },
    { key: null, label: "Price", align: "right" },
    { key: "value", label: "Mkt Value", align: "right" },
    { key: "weight", label: "Weight", align: "right" },
    { key: "pl", label: "Unreal. P/L", align: "right" },
    { key: "plPct", label: "Return", align: "right" },
  ];

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

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", padding: "20px 24px", maxWidth: "1140px", margin: "0 auto", color: "rgb(var(--foreground))" }}>
      <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>Portfolio Analysis</h1>
      <p style={{ fontSize: "12px", margin: "4px 0 0", ...muted }}>
        {holdings.length} positions across {Object.keys(sectorMap).length} sectors · valued from holdings.csv
      </p>

      {/* KPI row */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", margin: "16px 0" }}>
        <Kpi label="Market Value" value={usd(totalValue)} />
        <Kpi label="Cost Basis" value={usd(totalBasis)} />
        <Kpi
          label="Unrealized P/L"
          value={(totalPL >= 0 ? "+" : "") + usd(totalPL)}
          sub={signedPct(totalPLPct)}
          color={plColor(totalPL)}
        />
        <Kpi label="Top Performer" value={best.symbol} sub={signedPct(best.plPct)} color={plColor(best.plPct)} />
        <Kpi label="Laggard" value={worst.symbol} sub={signedPct(worst.plPct)} color={plColor(worst.plPct)} />
      </div>

      {/* Value trend */}
      {history.length > 1 ? (
        <div style={{ ...cardStyle, marginBottom: "16px", overflowX: "auto" }}>
          <LineChart data={history} title="Portfolio Value Over Time" width={1050} height={250} />
        </div>
      ) : null}

      {/* Sector allocation + return per position */}
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "16px" }}>
        <div style={{ ...cardStyle, flex: "1 1 300px", overflowX: "auto" }}>
          <PieChart data={sectorData} title="Sector Allocation" width={320} height={270} />
        </div>
        <div style={{ ...cardStyle, flex: "2 1 460px", overflowX: "auto" }}>
          <BarChart data={returnData} title="Return % by Position" width={640} height={270} />
        </div>
      </div>

      {/* Best / worst movers */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "20px" }}>
        <Mover label="Best performer" h={best} />
        <Mover label="Biggest laggard" h={worst} />
      </div>

      {/* Holdings table */}
      <h2 style={{ fontSize: "15px", fontWeight: 600, margin: "0 0 8px" }}>Holdings</h2>
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
              <tr key={h.symbol}>
                <td style={{ ...td, fontWeight: 600 }}>{h.symbol}</td>
                <td style={{ ...td, color: "rgb(var(--muted-foreground))" }}>{h.sector}</td>
                <td style={{ ...td, textAlign: "right" }}>{fmt(h.shares, 0)}</td>
                <td style={{ ...td, textAlign: "right" }}>{"$" + fmt(h.cost)}</td>
                <td style={{ ...td, textAlign: "right" }}>{"$" + fmt(h.price)}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{usd(h.value)}</td>
                <td style={{ ...td, textAlign: "right", color: "rgb(var(--muted-foreground))" }}>{fmt(h.weight, 1) + "%"}</td>
                <td style={{ ...td, textAlign: "right", color: plColor(h.pl) }}>
                  {(h.pl >= 0 ? "+" : "") + usd(h.pl)}
                </td>
                <td style={{ ...td, textAlign: "right", fontWeight: 600, color: plColor(h.pl) }}>
                  {signedPct(h.plPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: "16px", fontSize: "12px", ...muted }}>
        Edit <code>holdings.csv</code> and <code>history.csv</code> in your workspace, then click{" "}
        <strong>Build</strong> to refresh. Click a column header to sort.
      </p>
    </div>
  );
}
`;
