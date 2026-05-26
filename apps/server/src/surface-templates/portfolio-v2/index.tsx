/**
 * Portfolio v2 surface — entry.
 *
 * Multi-file layout (AH):
 *   index.tsx     ← you are here. Default export = the page. Loads data,
 *                   computes derivations, wires sections.
 *   types.ts      shared interfaces (mirror the v2 schema)
 *   yaml.ts       inline YAML parser (subset)
 *   utils.ts      formatters + FX + region heuristic
 *   primitives.tsx  Section / KpiCard / Table / Badge / SortHead / Chart
 *   sections.tsx    7 page-level sections, one per scroll block
 *
 * Esbuild bundles all of these together when the surface builds.
 * Add more files freely — anything `index.tsx` imports gets pulled in.
 *
 * Data sources (v2 layout — see docs/PORTFOLIO_STARTER_V2.md):
 *   accounts/_index.yaml             account metadata
 *   positions/current.csv            holdings (thesis_id + last_reviewed)
 *   positions/watchlist.csv          tracked-but-not-held (TODO: surface)
 *   cash/_index.yaml                 cash buckets
 *   assets/precious_metals.yaml      paper metals (no live quote)
 *   assets/funds.yaml                robo / opaque funds
 *
 * All colours via CSS custom-property tokens — `rgb(var(--…))`.
 */

import { useState, useEffect, useMemo, useCallback, useAriadne } from "@ariadne/surface";
import type { Account, RawPosition, CashBucket, ManualAsset, Derived, QuoteFailure } from "./types";
import { parseYaml } from "./yaml";
import { toBase, regionOf, daysBetween } from "./utils";
import {
  ActionStrip, NetWorthCard, AllocationGrid, AccountsTable,
  PositionsTable, CashAndManualAssets, RecentAnalysis,
} from "./sections";

export default function App() {
  const ariadne = useAriadne();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [positions, setPositions] = useState<RawPosition[]>([]);
  const [cash, setCash] = useState<CashBucket[]>([]);
  const [metals, setMetals] = useState<ManualAsset[]>([]);
  const [funds, setFunds] = useState<ManualAsset[]>([]);
  const [analysisFiles, setAnalysisFiles] = useState<{ macro: string[]; meso: string[]; micro: string[] }>({ macro: [], meso: [], micro: [] });

  const [fxMap, setFxMap] = useState<Record<string, number>>({ KRW: 1 });
  const [quoteFailures, setQuoteFailures] = useState<Record<string, QuoteFailure>>({});
  const [base] = useState<string>("KRW");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<"market_value" | "return_pct" | "symbol" | "account_id">("market_value");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterAccount, setFilterAccount] = useState<string>("");
  const [filterAssetClass, setFilterAssetClass] = useState<string>("");
  const [search, setSearch] = useState("");

  // ── Load all v2 data ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        let accList: Account[] = [];
        try {
          const txt = await ariadne.readText("accounts/_index.yaml");
          const parsed = parseYaml(txt) as { accounts?: Account[] };
          accList = parsed.accounts ?? [];
        } catch (_e) { /* v1 fallback */ }

        let posList: RawPosition[] = [];
        try {
          const rows = await ariadne.readCsv("positions/current.csv");
          posList = rows.map((r: any): RawPosition => ({
            account_id: r.account_id, symbol: r.symbol, name: r.name,
            asset_class: r.asset_class, sector: r.sector, currency: r.currency,
            shares: Number(r.shares),
            buy_price: Number(r.buy_price), current_price: Number(r.current_price),
            book_value: Number(r.book_value || r.shares * r.buy_price),
            market_value: Number(r.market_value || r.shares * r.current_price),
            return_pct: Number(r.return_pct || 0),
            target_price: r.target_price ? Number(r.target_price) : undefined,
            stop_loss: r.stop_loss ? Number(r.stop_loss) : undefined,
            thesis_id: r.thesis_id || undefined,
            horizon_months: r.horizon_months ? Number(r.horizon_months) : undefined,
            confidence: r.confidence || undefined,
            last_reviewed: r.last_reviewed || undefined,
            quote_symbol: r.quote_symbol || undefined,
            quote_source: r.quote_source || "yahoo",
            has_live_quote: r.has_live_quote === "true" || r.has_live_quote === true,
            notes: r.notes || undefined,
          }));
        } catch (_e) { /* */ }

        let cashList: CashBucket[] = [];
        try {
          const txt = await ariadne.readText("cash/_index.yaml");
          const parsed = parseYaml(txt) as { buckets?: CashBucket[] };
          cashList = parsed.buckets ?? [];
        } catch (_e) { /* */ }

        let metalList: ManualAsset[] = [];
        try {
          const txt = await ariadne.readText("assets/precious_metals.yaml");
          const parsed = parseYaml(txt) as { holdings?: ManualAsset[] };
          metalList = parsed.holdings ?? [];
        } catch (_e) { /* */ }

        let fundList: ManualAsset[] = [];
        try {
          const txt = await ariadne.readText("assets/funds.yaml");
          const parsed = parseYaml(txt) as { holdings?: ManualAsset[] };
          fundList = parsed.holdings ?? [];
        } catch (_e) { /* */ }

        const af = { macro: [] as string[], meso: [] as string[], micro: [] as string[] };
        try {
          const all = await ariadne.listFiles("analysis/**/*.md");
          for (const f of all) {
            if (f.path.startsWith("analysis/macro/")) af.macro.push(f.path);
            else if (f.path.startsWith("analysis/meso/")) af.meso.push(f.path);
            else if (f.path.startsWith("analysis/micro/")) af.micro.push(f.path);
          }
        } catch (_e) { /* */ }

        if (cancelled) return;
        setAccounts(accList);
        setPositions(posList);
        setCash(cashList);
        setMetals(metalList);
        setFunds(fundList);
        setAnalysisFiles(af);

        // FX
        const currencies = Array.from(new Set([
          ...posList.map((p) => p.currency),
          ...cashList.map((c) => c.currency),
          ...metalList.map((m) => m.currency),
          ...fundList.map((f) => f.currency),
        ])).filter((c) => c && c !== base && c !== "MIXED");
        try {
          const rates = await ariadne.getFxRates(base, currencies);
          const m: Record<string, number> = { [base]: 1 };
          for (const c of currencies) m[c] = rates[c] ?? 0;
          if (!cancelled) setFxMap(m);
        } catch (_e) {
          if (!cancelled) setFxMap({ [base]: 1 });
        }

        // Live quotes — only for positions explicitly marked as Yahoo-quotable.
        // The detailed call returns errors per-symbol so we can render an
        // "unquotable" badge on positions whose ticker Yahoo couldn't price.
        // Paper metals / robo funds (quote_source: manual) are skipped here;
        // they keep their CSV-provided market_value.
        const yahooSyms = posList
          .filter((p) => (p.quote_source ?? "yahoo") === "yahoo")
          .map((p) => p.quote_symbol ?? p.symbol)
          .filter((s): s is string => !!s);
        if (yahooSyms.length > 0 && typeof ariadne.getQuotesDetailed === "function") {
          try {
            const { errors } = await ariadne.getQuotesDetailed(yahooSyms);
            if (!cancelled && errors.length > 0) {
              const m: Record<string, QuoteFailure> = {};
              for (const e of errors) m[e.inputSymbol] = e;
              setQuoteFailures(m);
            }
          } catch (_e) {
            /* quote failures are non-fatal — surface keeps CSV values */
          }
        }

        setLoading(false);
      } catch (e: any) {
        if (!cancelled) {
          setLoadError(e?.message ?? String(e));
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [ariadne, base]);

  // ── Derive aggregates ──────────────────────────────────────────────────
  const derived: Derived = useMemo(() => {
    const allRows = [
      ...positions.map((p) => ({
        kind: "position" as const, account_id: p.account_id, asset_class: p.asset_class,
        sector: p.sector, currency: p.currency, market_value: p.market_value,
        book_value: p.book_value, region: regionOf(p.symbol, p.currency),
      })),
      ...metals.map((m) => ({
        kind: "metal" as const, account_id: m.account_id ?? "", asset_class: m.asset_class,
        sector: m.sector, currency: m.currency, market_value: m.market_value,
        book_value: 0, region: "기타",
      })),
      ...funds.map((f) => ({
        kind: "fund" as const, account_id: f.account_id ?? "", asset_class: f.asset_class,
        sector: f.sector, currency: f.currency, market_value: f.market_value,
        book_value: 0, region: "기타",
      })),
    ];

    const totalInvestedBase = allRows.reduce((s, r) => s + toBase(r.market_value, r.currency, fxMap), 0);
    const totalCashBase = cash.reduce((s, c) => s + toBase(c.amount, c.currency, fxMap), 0);
    const totalIdleBase = cash.filter((c) => c.is_idle).reduce((s, c) => s + toBase(c.amount, c.currency, fxMap), 0);
    const totalNetWorthBase = totalInvestedBase + totalCashBase;

    function group(by: (r: typeof allRows[number]) => string): Array<{ label: string; value: number }> {
      const map = new Map<string, number>();
      for (const r of allRows) {
        const k = by(r);
        const v = toBase(r.market_value, r.currency, fxMap);
        map.set(k, (map.get(k) ?? 0) + v);
      }
      return Array.from(map.entries())
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value);
    }

    const byAssetClass = group((r) => r.asset_class);
    const byCurrency = group((r) => r.currency);
    const bySector = group((r) => r.sector).slice(0, 8);
    const byRegion = group((r) => r.region);

    const accountRollup = new Map<string, { value: number; positions: number; cash: number }>();
    for (const a of accounts) accountRollup.set(a.id, { value: 0, positions: 0, cash: 0 });
    for (const p of positions) {
      const ar = accountRollup.get(p.account_id);
      if (ar) {
        ar.value += toBase(p.market_value, p.currency, fxMap);
        ar.positions += 1;
      }
    }
    for (const c of cash) {
      const acc = c.within_account_id ?? "";
      const ar = accountRollup.get(acc);
      if (ar) ar.cash += toBase(c.amount, c.currency, fxMap);
    }

    const today = new Date();
    const closingAccounts = accounts.filter((a) => a.status === "closing" && a.closing_date);
    const taxAccounts = accounts.filter((a) => a.tax_advantaged);
    const staleTheses = positions.filter((p) => p.last_reviewed && daysBetween(p.last_reviewed, today) > 90);
    const missingTheses = positions.filter((p) => !p.thesis_id);

    return {
      totalNetWorthBase, totalInvestedBase, totalCashBase, totalIdleBase,
      byAssetClass, byCurrency, bySector, byRegion,
      accountRollup, closingAccounts, taxAccounts, staleTheses, missingTheses,
    };
  }, [positions, cash, metals, funds, accounts, fxMap]);

  // ── Filter + sort positions ────────────────────────────────────────────
  const visiblePositions = useMemo(() => {
    const lower = search.toLowerCase().trim();
    let list = positions.filter((p) => {
      if (filterAccount && p.account_id !== filterAccount) return false;
      if (filterAssetClass && p.asset_class !== filterAssetClass) return false;
      if (lower && !p.symbol.toLowerCase().includes(lower) && !p.name.toLowerCase().includes(lower)) return false;
      return true;
    });
    list = list.slice().sort((a, b) => {
      let av: any = (a as any)[sortKey], bv: any = (b as any)[sortKey];
      if (sortKey === "market_value") {
        av = toBase(a.market_value, a.currency, fxMap);
        bv = toBase(b.market_value, b.currency, fxMap);
      }
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [positions, filterAccount, filterAssetClass, search, sortKey, sortDir, fxMap]);

  const flipSort = useCallback((k: typeof sortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "symbol" || k === "account_id" ? "asc" : "desc"); }
  }, [sortKey]);

  if (loading) {
    return <div style={{ padding: 24, color: "rgb(var(--muted-foreground))" }}>Loading workspace…</div>;
  }
  if (loadError) {
    return <div style={{ padding: 24, color: "rgb(var(--destructive))" }}>Failed to load: {loadError}</div>;
  }

  return (
    <div style={{ padding: "16px 20px", maxWidth: 1280, margin: "0 auto", fontSize: 13, color: "rgb(var(--foreground))" }}>
      <ActionStrip accounts={accounts} derived={derived} base={base} />
      <NetWorthCard accounts={accounts} positions={positions} derived={derived} base={base} />
      <AllocationGrid derived={derived} />
      <AccountsTable accounts={accounts} derived={derived} base={base} />
      <PositionsTable
        accounts={accounts}
        positions={positions}
        visiblePositions={visiblePositions}
        fxMap={fxMap}
        quoteFailures={quoteFailures}
        search={search}
        setSearch={setSearch}
        filterAccount={filterAccount}
        setFilterAccount={setFilterAccount}
        filterAssetClass={filterAssetClass}
        setFilterAssetClass={setFilterAssetClass}
        sortKey={sortKey}
        sortDir={sortDir}
        flipSort={flipSort}
      />
      <CashAndManualAssets accounts={accounts} cash={cash} metals={metals} funds={funds} />
      <RecentAnalysis files={analysisFiles} />
    </div>
  );
}
