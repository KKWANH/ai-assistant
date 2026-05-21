/**
 * Budget starter — sample files injected when a workspace is created with
 * starter="budget".
 *
 * Provides:
 *   budget.csv     — three months of personal income / expense transactions
 *   surface.tsx    — a personal-finance dashboard reading budget.csv
 *
 * All colours use CSS custom-property tokens (rgb(var(--token))) — no hardcoded
 * hex — so the surface is fully legible in both dark and light mode.
 */

export const BUDGET_CSV = `date,category,type,amount
2026-03-01,Salary,income,5200.00
2026-03-02,Rent,expense,1650.00
2026-03-04,Groceries,expense,214.35
2026-03-07,Utilities,expense,138.90
2026-03-09,Dining,expense,86.40
2026-03-12,Transport,expense,72.10
2026-03-15,Subscriptions,expense,44.97
2026-03-19,Shopping,expense,159.20
2026-03-23,Healthcare,expense,95.00
2026-03-28,Freelance,income,640.00
2026-04-01,Salary,income,5200.00
2026-04-02,Rent,expense,1650.00
2026-04-05,Groceries,expense,238.70
2026-04-08,Utilities,expense,121.45
2026-04-11,Dining,expense,112.80
2026-04-14,Transport,expense,68.55
2026-04-15,Subscriptions,expense,44.97
2026-04-20,Shopping,expense,97.60
2026-04-26,Healthcare,expense,150.00
2026-05-01,Salary,income,5200.00
2026-05-02,Rent,expense,1650.00
2026-05-05,Groceries,expense,201.15
2026-05-08,Utilities,expense,129.30
2026-05-10,Dining,expense,94.25
2026-05-13,Transport,expense,80.40
2026-05-17,Subscriptions,expense,44.97
`;

export const SURFACE_TSX = `/**
 * Budget & Cashflow — custom Ariadne surface (personal-finance dashboard).
 *
 * Reads budget.csv and renders KPIs, monthly net cashflow, expenses by
 * category, a running balance trend and a sortable transactions table.
 *
 * This file lives at .ariadne/surface.tsx. Edit it freely, then click "Build"
 * to recompile and see the result in the workspace's Custom screen tab.
 *
 * The "@ariadne/surface" import gives you:
 *   - React (re-exported) + useState / useEffect
 *   - useAriadne()  -> SDK: readCsv, readText, listFiles, runTemplate, theme
 *   - LineChart, BarChart, PieChart  -> token-aware SVG charts
 *
 * All colours use CSS variables: rgb(var(--token)). Available tokens include
 * --background, --foreground, --card, --card-foreground, --border, --muted,
 * --muted-foreground, --accent, --success, --destructive, --warning, --info.
 */

import { useState, useEffect, useAriadne, LineChart, BarChart, PieChart } from "@ariadne/surface";

// -- Types -------------------------------------------------------------------

interface Txn {
  date: string;
  category: string;
  type: "income" | "expense";
  amount: number;
}

interface Point {
  label: string;
  value: number;
}

type SortKey = "date" | "category" | "type" | "amount";

// -- Helpers -----------------------------------------------------------------

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

function usdCents(n: number): string {
  return (n < 0 ? "-$" : "$") + fmt(Math.abs(n), 2);
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

function flowColor(n: number): string {
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

function parseTxns(rows: Record<string, string>[]): Txn[] {
  return rows
    .map((r) => {
      const rawType = (r["type"] ?? "").trim().toLowerCase();
      return {
        date: (r["date"] ?? "").trim(),
        category: (r["category"] ?? "Uncategorized").trim() || "Uncategorized",
        type: rawType === "income" ? "income" : "expense",
        amount: Math.abs(num(r["amount"])),
      } as Txn;
    })
    .filter((t) => t.date.length > 0);
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

function Kpi(props: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ ...cardStyle, flex: "1 1 168px", minWidth: "168px" }}>
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

// -- Main --------------------------------------------------------------------

export default function BudgetDashboard() {
  const ariadne = useAriadne();
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    async function load() {
      try {
        const csv = await ariadne.readCsv("budget.csv");
        setTxns(parseTxns(csv.rows));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [ariadne]);

  if (loading) return <Centered text="Loading budget..." />;
  if (error) return <Centered text={"Error: " + error} tone="error" />;
  if (txns.length === 0) return <Centered text="No rows in budget.csv" />;

  // Aggregates
  const totalIncome = txns.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const totalExpense = txns.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const netSavings = totalIncome - totalExpense;
  const savingsRate = totalIncome > 0 ? (netSavings / totalIncome) * 100 : 0;

  // Monthly net cashflow
  const months = Array.from(new Set(txns.map((t) => monthOf(t.date)))).sort();
  const monthlyNet: Point[] = months.map((m) => {
    const inc = txns.filter((t) => monthOf(t.date) === m && t.type === "income").reduce((s, t) => s + t.amount, 0);
    const exp = txns.filter((t) => monthOf(t.date) === m && t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return { label: m, value: Math.round(inc - exp) };
  });

  // Expenses by category
  const catMap: Record<string, number> = {};
  for (const t of txns) {
    if (t.type === "expense") catMap[t.category] = (catMap[t.category] ?? 0) + t.amount;
  }
  const categoryData = Object.keys(catMap)
    .map((k) => ({ label: k, value: Math.round(catMap[k] ?? 0) }))
    .sort((a, b) => b.value - a.value);
  const topCategory = categoryData.length > 0 ? categoryData[0] : { label: "-", value: 0 };

  // Running balance over time, ordered by date
  const chrono = [...txns].sort((a, b) => a.date.localeCompare(b.date));
  let runningTotal = 0;
  const balanceData: Point[] = chrono.map((t) => {
    runningTotal += t.type === "income" ? t.amount : -t.amount;
    return { label: t.date.slice(5), value: Math.round(runningTotal) };
  });

  // Table sort
  const sorted = [...txns].sort((a, b) => {
    let cmp: number;
    if (sortKey === "date") cmp = a.date.localeCompare(b.date);
    else if (sortKey === "category") cmp = a.category.localeCompare(b.category);
    else if (sortKey === "type") cmp = a.type.localeCompare(b.type);
    else cmp = a.amount - b.amount;
    return sortDir === "asc" ? cmp : -cmp;
  });

  function toggleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(k === "amount" ? "desc" : "asc");
    }
  }

  const cols: Array<{ key: SortKey; label: string; align: string }> = [
    { key: "date", label: "Date", align: "left" },
    { key: "category", label: "Category", align: "left" },
    { key: "type", label: "Type", align: "left" },
    { key: "amount", label: "Amount", align: "right" },
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
    cursor: "pointer",
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
      <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>Budget & Cashflow</h1>
      <p style={{ fontSize: "12px", margin: "4px 0 0", ...muted }}>
        {txns.length + " transactions across " + months.length + " months · tracked from budget.csv"}
      </p>

      {/* KPI row */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", margin: "16px 0" }}>
        <Kpi label="Total Income" value={usd(totalIncome)} color="rgb(var(--success))" />
        <Kpi label="Total Expense" value={usd(totalExpense)} color="rgb(var(--destructive))" />
        <Kpi
          label="Net Savings"
          value={(netSavings >= 0 ? "+" : "") + usd(netSavings)}
          sub={netSavings >= 0 ? "Saved this period" : "Overspent this period"}
          color={flowColor(netSavings)}
        />
        <Kpi
          label="Savings Rate"
          value={fmt(savingsRate, 1) + "%"}
          sub={"of income retained"}
          color={flowColor(netSavings)}
        />
        <Kpi label="Top Expense" value={topCategory.label} sub={usd(topCategory.value)} />
      </div>

      {/* Monthly net cashflow */}
      <div style={{ ...cardStyle, marginBottom: "16px", overflowX: "auto" }}>
        <BarChart data={monthlyNet} title="Net Cashflow by Month" width={1050} height={250} color="rgb(var(--info))" />
      </div>

      {/* Expenses by category + running balance */}
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "20px" }}>
        <div style={{ ...cardStyle, flex: "1 1 300px", overflowX: "auto" }}>
          <PieChart data={categoryData} title="Expenses by Category" width={320} height={270} />
        </div>
        <div style={{ ...cardStyle, flex: "2 1 460px", overflowX: "auto" }}>
          <LineChart data={balanceData} title="Running Balance Over Time" width={640} height={270} color="rgb(var(--accent))" />
        </div>
      </div>

      {/* Transactions table */}
      <h2 style={{ fontSize: "15px", fontWeight: 600, margin: "0 0 8px" }}>Transactions</h2>
      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.label}
                  onClick={() => toggleSort(c.key)}
                  style={{ ...th, textAlign: c.align as "left" | "right" }}
                >
                  {c.label + (c.key === sortKey ? (sortDir === "asc" ? " ^" : " v") : "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => (
              <tr key={t.date + "-" + t.category + "-" + i}>
                <td style={{ ...td, fontWeight: 600 }}>{t.date}</td>
                <td style={{ ...td, color: "rgb(var(--muted-foreground))" }}>{t.category}</td>
                <td style={{ ...td }}>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      padding: "2px 8px",
                      borderRadius: "999px",
                      color: t.type === "income" ? "rgb(var(--success))" : "rgb(var(--destructive))",
                      background: "rgb(var(--accent))",
                    }}
                  >
                    {t.type}
                  </span>
                </td>
                <td
                  style={{
                    ...td,
                    textAlign: "right",
                    fontWeight: 600,
                    color: t.type === "income" ? "rgb(var(--success))" : "rgb(var(--destructive))",
                  }}
                >
                  {(t.type === "income" ? "+" : "-") + usdCents(t.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: "16px", fontSize: "12px", ...muted }}>
        Edit <code>budget.csv</code> in your workspace, then click <strong>Build</strong> to
        refresh. Click a column header to sort the transactions.
      </p>
    </div>
  );
}
`;
