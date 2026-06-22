/**
 * Built-in "Net Worth" sample workspace.
 *
 * A PUBLIC, fabricated net-worth tracker seeded on boot so logged-out visitors
 * and guests can see Ariadne's data-driven dashboard + in-place value editing
 * without exposing any real finances. Every number here is made up.
 *
 * Shape mirrors the Portfolio demo: an on-disk folder with plain CSV data and a
 * `.ariadne/surface` dashboard that reads it. The two data files (accounts.csv,
 * history.csv) are seeded only when missing, so edits made in the Data tab
 * survive a restart.
 */

import fs from "node:fs";
import path from "node:path";
import {
  NETWORTH_SAMPLE_WORKSPACE_ID,
  DEFAULT_INCLUDE,
  DEFAULT_EXCLUDE,
} from "@ariadne/shared";
import type { Workspace } from "@ariadne/shared";
import { dbGetWorkspace, dbInsertWorkspace } from "./db/repo.js";
import { PATHS } from "./config.js";
import { ensureAriadneFolder, writeSurface } from "./ariadneFolder.js";
import { buildSurface } from "./services/surfaceBuild.js";
import logger from "./logger.js";

// ── Fabricated data ──────────────────────────────────────────────────────────
// All figures invented. `kind` is asset|liability; balances are always positive
// (the dashboard subtracts liabilities) so editing a cell never needs a sign.

const ACCOUNTS_CSV = `category,name,institution,kind,balance,currency
Cash,Checking,Everbank,asset,8420,USD
Cash,High-Yield Savings,Marcus,asset,24600,USD
Cash,Emergency Fund,Ally,asset,15000,USD
Investments,Brokerage,Fidelity,asset,62300,USD
Investments,Index Funds,Vanguard,asset,48900,USD
Retirement,401(k),Empower,asset,112400,USD
Retirement,Roth IRA,Schwab,asset,38700,USD
Real Estate,Primary Residence,—,asset,420000,USD
Vehicles,Car,—,asset,18500,USD
Crypto,BTC + ETH,Coinbase,asset,9800,USD
Liabilities,Mortgage,Wells Fargo,liability,284000,USD
Liabilities,Student Loan,SoFi,liability,12300,USD
Liabilities,Credit Card,Chase,liability,1850,USD
`;

const HISTORY_CSV = `month,net_worth
2025-07,418500
2025-08,422100
2025-09,428900
2025-10,431200
2025-11,439800
2025-12,444600
2026-01,441900
2026-02,449300
2026-03,453700
2026-04,455100
2026-05,458800
2026-06,460470
`;

// ── Surface dashboard ────────────────────────────────────────────────────────
// Authored against @ariadne/surface (sandboxed). No nested template literals or
// ${} so it round-trips cleanly as a JS string here.

const SURFACE_TSX = `/**
 * Net Worth — a sample Ariadne dashboard (all figures fabricated).
 *
 * Reads accounts.csv (category,name,institution,kind,balance,currency) and
 * history.csv (month,net_worth), then renders the headline net worth, a 12-month
 * trend, an asset-allocation breakdown, and an accounts table. Every value is
 * editable in the workspace's Data tab — change a balance there and rebuild to
 * see it flow through. Edit this file freely and click Build to recompile.
 */

import {
  useState,
  useEffect,
  useCallback,
  useAriadne,
  LineChart,
  PieChart,
  Card,
  Stat,
  Grid,
  Badge,
  Button,
} from "@ariadne/surface";

// The build shim imports this file's DEFAULT export and mounts it (with the
// shared error boundary), so the root component is exported, not self-mounted.

type Row = Record<string, string>;

function num(s: string | undefined): number {
  const n = parseFloat((s || "0").replace(/,/g, ""));
  return isFinite(n) ? n : 0;
}

function usd(n: number): string {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(n)).toLocaleString("en-US");
}

const muted = { color: "rgb(var(--muted-foreground))" };

export default function App() {
  const ariadne = useAriadne();
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [history, setHistory] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const a = await ariadne.readCsv("accounts.csv");
      const h = await ariadne.readCsv("history.csv");
      setAccounts(a.rows);
      setHistory(h.rows);
    } finally {
      setLoading(false);
    }
  }, [ariadne]);

  useEffect(() => {
    load();
  }, [load]);

  const assets = accounts.filter((r) => r.kind !== "liability");
  const liabilities = accounts.filter((r) => r.kind === "liability");
  const totalAssets = assets.reduce((s, r) => s + num(r.balance), 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + num(r.balance), 0);
  const netWorth = totalAssets - totalLiabilities;

  // Month-over-month change from the last two history points.
  const hist = history.map((r) => ({ label: (r.month || "").slice(2), value: num(r.net_worth) }));
  const last = hist.length ? hist[hist.length - 1].value : netWorth;
  const prev = hist.length > 1 ? hist[hist.length - 2].value : last;
  const momPct = prev ? ((last - prev) / prev) * 100 : 0;

  // Asset allocation by category (assets only).
  const byCat: Record<string, number> = {};
  for (const r of assets) byCat[r.category] = (byCat[r.category] || 0) + num(r.balance);
  const pie = Object.keys(byCat).map((k) => ({ label: k, value: byCat[k] }));

  if (loading && accounts.length === 0) {
    return <div style={{ padding: 24, ...muted }}>Loading…</div>;
  }

  const th: React.CSSProperties = {
    textAlign: "left",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "rgb(var(--muted-foreground))",
    padding: "6px 10px",
    borderBottom: "1px solid rgb(var(--border))",
  };
  const td: React.CSSProperties = {
    padding: "8px 10px",
    fontSize: 13,
    color: "rgb(var(--foreground))",
    borderBottom: "1px solid rgb(var(--border))",
  };

  return (
    <div style={{ padding: 20, maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "rgb(var(--foreground))", margin: 0 }}>
          Net Worth
        </h1>
        <Badge label="Sample data" tone="info" />
        <div style={{ marginLeft: "auto" }}>
          <Button label="Refresh" variant="ghost" onClick={() => void load()} />
        </div>
      </div>

      <Grid cols={3} gap={12}>
        <Card>
          <Stat label="Net Worth" value={usd(netWorth)} delta={momPct} />
        </Card>
        <Card>
          <Stat label="Total Assets" value={usd(totalAssets)} />
        </Card>
        <Card>
          <Stat label="Total Liabilities" value={usd(-totalLiabilities)} />
        </Card>
      </Grid>

      <div style={{ height: 16 }} />

      <Grid cols={2} gap={12}>
        <Card title="Net worth — last 12 months">
          <LineChart data={hist} width={460} height={220} color="rgb(var(--accent))" />
        </Card>
        <Card title="Asset allocation">
          <PieChart data={pie} width={300} height={240} />
        </Card>
      </Grid>

      <div style={{ height: 16 }} />

      <Card title="Accounts">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Account</th>
              <th style={th}>Category</th>
              <th style={th}>Institution</th>
              <th style={{ ...th, textAlign: "right" }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((r, i) => {
              const liab = r.kind === "liability";
              return (
                <tr key={i}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.name}</td>
                  <td style={{ ...td, ...muted }}>{r.category}</td>
                  <td style={{ ...td, ...muted }}>{r.institution}</td>
                  <td
                    style={{
                      ...td,
                      textAlign: "right",
                      fontWeight: 600,
                      color: liab ? "rgb(var(--destructive))" : "rgb(var(--foreground))",
                    }}
                  >
                    {liab ? "-" + usd(num(r.balance)) : usd(num(r.balance))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <p style={{ marginTop: 16, fontSize: 12, ...muted }}>
        Every figure here is fabricated. Open the workspace's <strong>Data</strong> tab to edit any
        balance directly — the dashboard recomputes from <code>accounts.csv</code> and{" "}
        <code>history.csv</code>.
      </p>
    </div>
  );
}
`;

/** Seed the built-in public "Net Worth" sample workspace at data/sample-networth/. */
export async function ensureNetWorthSample(): Promise<void> {
  try {
    const exists = !!dbGetWorkspace(NETWORTH_SAMPLE_WORKSPACE_ID);
    const rootPath = path.join(PATHS.home, "sample-networth");
    fs.mkdirSync(rootPath, { recursive: true });

    // Data files — seed once, never overwrite (Data-tab edits survive restart).
    const dataFiles: Array<[string, string]> = [
      ["accounts.csv", ACCOUNTS_CSV],
      ["history.csv", HISTORY_CSV],
    ];
    for (const [rel, body] of dataFiles) {
      const abs = path.join(rootPath, rel);
      if (!fs.existsSync(abs)) fs.writeFileSync(abs, body, "utf-8");
    }

    // Surface — seed the single-file dashboard if neither form exists yet, so a
    // user's later customisation of the screen is preserved across restarts.
    ensureAriadneFolder(rootPath);
    const singleSurfacePath = path.join(rootPath, ".ariadne", "surface.tsx");
    const folderEntry = path.join(rootPath, ".ariadne", "surface", "index.tsx");
    if (!fs.existsSync(folderEntry) && !fs.existsSync(singleSurfacePath)) {
      writeSurface(rootPath, SURFACE_TSX);
    }
    await buildSurface(rootPath);

    if (!exists) {
      const workspace: Workspace = {
        id: NETWORTH_SAMPLE_WORKSPACE_ID,
        name: "Net Worth",
        rootPath,
        include: DEFAULT_INCLUDE,
        exclude: DEFAULT_EXCLUDE,
        createdAt: new Date().toISOString(),
        lastScanAt: null,
        fileCount: 0,
        createdBy: null,
        createdByName: null,
        visibility: "public",
        category: "finance",
        // Open straight to the immersive dashboard — it's a showcase screen.
        homeView: "surface",
        defaultProvider: null,
        defaultModel: null,
        defaultSkillId: null,
      };
      dbInsertWorkspace(workspace);
      logger.info({ rootPath }, "Seeded the built-in Net Worth sample workspace");
    }
  } catch (err) {
    logger.warn({ err }, "Failed to seed the Net Worth sample workspace");
  }
}
