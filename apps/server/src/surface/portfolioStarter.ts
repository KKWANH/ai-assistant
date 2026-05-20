/**
 * Portfolio starter — sample files injected when a workspace is created with starter="portfolio".
 *
 * Provides:
 *   holdings.csv   — sample equity holdings
 *   surface.tsx    — custom surface that reads the CSV and renders a dashboard
 *
 * All colours use CSS custom property tokens (rgb(var(--token))) — no hardcoded hex.
 * This means the surface is fully legible in both dark and light mode.
 */

export const HOLDINGS_CSV = `symbol,name,shares,buy_price,current_price
AAPL,Apple Inc.,50,145.30,178.90
MSFT,Microsoft Corp.,30,290.00,415.20
GOOGL,Alphabet Inc.,10,120.00,168.50
AMZN,Amazon.com Inc.,15,130.00,185.30
NVDA,NVIDIA Corp.,20,450.00,875.40
TSLA,Tesla Inc.,25,200.00,248.70
META,Meta Platforms Inc.,18,350.00,512.80
JPM,JPMorgan Chase & Co.,40,145.00,198.60
`;

export const SURFACE_TSX = `/**
 * Portfolio Dashboard — custom Ariadne surface
 *
 * This file lives at .ariadne/surface.tsx and is bundled by Ariadne into
 * .ariadne/surface-dist/bundle.js whenever you press "Build Surface".
 *
 * You can freely edit this file.  After saving, click "Build Surface" to
 * recompile and see the result in the workspace overview panel.
 *
 * The \`@ariadne/surface\` import gives you:
 *   - React (re-exported)
 *   - useAriadne()  → SDK for reading files, running templates, listing runs, + theme
 *   - LineChart, BarChart, PieChart  → SVG chart components (token-aware)
 *
 * All colours should use CSS variables: rgb(var(--token))
 * Available tokens: --background, --foreground, --card, --card-foreground,
 *   --border, --muted, --muted-foreground, --accent, --success, --destructive, etc.
 */

import { useState, useEffect, useAriadne, PieChart, BarChart } from "@ariadne/surface";

// ── Types ──────────────────────────────────────────────────────────────────

interface Holding {
  symbol: string;
  name: string;
  shares: number;
  buyPrice: number;
  currentPrice: number;
  value: number;
  gain: number;
  gainPct: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseHoldings(rows: Record<string, string>[]): Holding[] {
  return rows.map((r) => {
    const shares = parseFloat(r["shares"] ?? "0");
    const buyPrice = parseFloat(r["buy_price"] ?? "0");
    const currentPrice = parseFloat(r["current_price"] ?? "0");
    const value = shares * currentPrice;
    const gain = (currentPrice - buyPrice) * shares;
    const gainPct = buyPrice > 0 ? ((currentPrice - buyPrice) / buyPrice) * 100 : 0;
    return {
      symbol: r["symbol"] ?? "",
      name: r["name"] ?? "",
      shares,
      buyPrice,
      currentPrice,
      value,
      gain,
      gainPct,
    };
  });
}

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function PortfolioDashboard() {
  const ariadne = useAriadne();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const csv = await ariadne.readCsv("holdings.csv");
        setHoldings(parseHoldings(csv.rows));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [ariadne]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px" }}>
        <p style={{ color: "rgb(var(--muted-foreground))" }}>Loading holdings…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px" }}>
        <p style={{ color: "rgb(var(--destructive))" }}>Error: {error}</p>
      </div>
    );
  }

  const totalValue = holdings.reduce((s, h) => s + h.value, 0);
  const totalGain = holdings.reduce((s, h) => s + h.gain, 0);

  const allocationData = holdings.map((h) => ({ label: h.symbol, value: h.value }));
  const gainData = holdings.map((h) => ({ label: h.symbol, value: h.gain }));

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", padding: "24px", maxWidth: "960px", margin: "0 auto", color: "rgb(var(--foreground))" }}>
      <h1 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "16px", color: "rgb(var(--foreground))" }}>
        Portfolio Dashboard
      </h1>

      {/* Summary cards */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "24px", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 140px", border: "1px solid rgb(var(--border))", borderRadius: "8px", padding: "12px 16px", background: "rgb(var(--card))" }}>
          <div style={{ fontSize: "11px", color: "rgb(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>Total Value</div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: "rgb(var(--card-foreground))" }}>\${fmt(totalValue)}</div>
        </div>
        <div style={{ flex: "1 1 140px", border: \`1px solid \${totalGain >= 0 ? "rgb(var(--success))" : "rgb(var(--destructive))"}\`, borderRadius: "8px", padding: "12px 16px", background: "rgb(var(--card))" }}>
          <div style={{ fontSize: "11px", color: "rgb(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>Total Gain / Loss</div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: totalGain >= 0 ? "rgb(var(--success))" : "rgb(var(--destructive))" }}>
            {totalGain >= 0 ? "+" : ""}\${fmt(totalGain)}
          </div>
        </div>
        <div style={{ flex: "1 1 140px", border: "1px solid rgb(var(--border))", borderRadius: "8px", padding: "12px 16px", background: "rgb(var(--card))" }}>
          <div style={{ fontSize: "11px", color: "rgb(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>Positions</div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: "rgb(var(--card-foreground))" }}>{holdings.length}</div>
        </div>
      </div>

      {/* Charts */}
      <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", marginBottom: "8px" }}>
        <div style={{ border: "1px solid rgb(var(--border))", borderRadius: "8px", padding: "12px", background: "rgb(var(--card))" }}>
          <PieChart data={allocationData} title="Allocation by Value" width={320} height={280} />
        </div>
        <div style={{ border: "1px solid rgb(var(--border))", borderRadius: "8px", padding: "12px", background: "rgb(var(--card))" }}>
          <BarChart data={gainData} title="Gain / Loss per Position" width={420} height={280} />
        </div>
      </div>

      {/* Holdings table */}
      <h2 style={{ fontSize: "15px", fontWeight: 600, margin: "24px 0 8px", color: "rgb(var(--foreground))" }}>Holdings</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr>
              {["Symbol", "Name", "Shares", "Buy Price", "Current", "Value", "Gain", "Gain %"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "2px solid rgb(var(--border))", fontWeight: 600, color: "rgb(var(--foreground))", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.symbol}>
                <td style={{ padding: "7px 10px", borderBottom: "1px solid rgb(var(--border))", fontWeight: 600, color: "rgb(var(--foreground))", whiteSpace: "nowrap" }}>{h.symbol}</td>
                <td style={{ padding: "7px 10px", borderBottom: "1px solid rgb(var(--border))", color: "rgb(var(--foreground))", whiteSpace: "nowrap" }}>{h.name}</td>
                <td style={{ padding: "7px 10px", borderBottom: "1px solid rgb(var(--border))", color: "rgb(var(--foreground))", textAlign: "right", whiteSpace: "nowrap" }}>{fmt(h.shares, 0)}</td>
                <td style={{ padding: "7px 10px", borderBottom: "1px solid rgb(var(--border))", color: "rgb(var(--foreground))", textAlign: "right", whiteSpace: "nowrap" }}>\${fmt(h.buyPrice)}</td>
                <td style={{ padding: "7px 10px", borderBottom: "1px solid rgb(var(--border))", color: "rgb(var(--foreground))", textAlign: "right", whiteSpace: "nowrap" }}>\${fmt(h.currentPrice)}</td>
                <td style={{ padding: "7px 10px", borderBottom: "1px solid rgb(var(--border))", color: "rgb(var(--foreground))", textAlign: "right", whiteSpace: "nowrap" }}>\${fmt(h.value)}</td>
                <td style={{ padding: "7px 10px", borderBottom: "1px solid rgb(var(--border))", textAlign: "right", whiteSpace: "nowrap", color: h.gain >= 0 ? "rgb(var(--success))" : "rgb(var(--destructive))" }}>
                  {h.gain >= 0 ? "+" : ""}\${fmt(h.gain)}
                </td>
                <td style={{ padding: "7px 10px", borderBottom: "1px solid rgb(var(--border))", textAlign: "right", whiteSpace: "nowrap", color: h.gainPct >= 0 ? "rgb(var(--success))" : "rgb(var(--destructive))" }}>
                  {h.gainPct >= 0 ? "+" : ""}{fmt(h.gainPct)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: "16px", fontSize: "12px", color: "rgb(var(--muted-foreground))" }}>
        Edit <code>holdings.csv</code> in your workspace to update the data.
        Save this file and click <strong>Build Surface</strong> to recompile.
      </p>
    </div>
  );
}
`;
