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
import type { Account, RawPosition, CashBucket, ManualAsset, Derived, QuoteFailure, LiveQuote, BucketTarget, IndexTrigger, HistPoint, PricePoint } from "./types";
import { parseYaml } from "./yaml";
import { toBase, regionOf, daysBetween } from "./utils";
import {
  ActionStrip, NetWorthCard, AccountsTable,
  PositionsTable, CashAndManualAssets, RecentAnalysis,
  TriggerGauge,
  ValueTrendChart, ReturnsBarChart, PositionDetailPage,
  WatchlistTable, BaseCurrencySelector,
} from "./sections";

// AM — key used to look up price history + news files.
// Prefer KR listing code (6-digit), fall back to Yahoo/display symbol.
function fileKey(p: RawPosition): string {
  return p.kr_listing_code || p.quote_symbol || p.symbol;
}

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
  // AO — store full live quotes (price + 52w high/low + volume) keyed by
  // resolved symbol. Lets the detail page render a live-snapshot panel
  // even when no news/thesis file exists.
  const [liveQuotes, setLiveQuotes] = useState<Record<string, LiveQuote>>({});
  const [buckets, setBuckets] = useState<BucketTarget[]>([]);
  const [triggers, setTriggers] = useState<IndexTrigger[]>([]);
  const [history, setHistory] = useState<HistPoint[]>([]);
  const [showFx, setShowFx] = useState(false);
  // AL1 / AM / AO — clicked-position + its loaded thesis / price history /
  // news body. AO changes this from a modal overlay to a route-switched
  // "page": when activePosition is set, the main list is hidden and a
  // full-page detail view renders in its place.
  const [activePosition, setActivePosition] = useState<RawPosition | null>(null);
  const [activeThesis, setActiveThesis] = useState<string | null>(null);
  const [activePriceHistory, setActivePriceHistory] = useState<PricePoint[]>([]);
  const [activeNews, setActiveNews] = useState<string | null>(null);
  // AM — reporting currency is user-selectable; KRW default for the
  // Korea-resident reference workspace, switchable to USD / EUR / JPY.
  const [base, setBase] = useState<string>("KRW");
  // AM — watchlist (positions/watchlist.csv).
  const [watchlist, setWatchlist] = useState<Array<{
    symbol: string; name: string; asset_class: string; sector: string;
    currency: string; trigger_price?: number; thesis_id?: string;
    notes?: string; quote_symbol?: string;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<"market_value" | "return_pct" | "symbol" | "account_id">("market_value");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterAccount, setFilterAccount] = useState<string>("");
  const [filterAssetClass, setFilterAssetClass] = useState<string>("");
  const [search, setSearch] = useState("");
  // AN — quick-filter chip above the positions table (전체 / 수익 / 손실 / stale / cap 위반).
  const [quickFilter, setQuickFilter] = useState<"all" | "gainers" | "losers" | "stale" | "cap">("all");
  // AN — bumping refreshTick re-runs the load() effect, re-fetching FX + quotes.
  const [refreshTick, setRefreshTick] = useState(0);

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
          // AN — readCsv returns { headers, rows }; the old code treated
          // the whole object as the array → posList silently stayed empty
          // → "보유 종목 동작 안함". Destructure + defensive number coercion.
          const { rows } = await ariadne.readCsv("positions/current.csv");
          const toNum = (v: any, fallback = 0): number => {
            const n = Number(v);
            return Number.isFinite(n) ? n : fallback;
          };
          posList = rows
            .filter((r: any) => r.account_id && r.symbol)
            .map((r: any): RawPosition => {
              const shares = toNum(r.shares);
              const buy_price = toNum(r.buy_price);
              const current_price = toNum(r.current_price);
              return {
                account_id: r.account_id, symbol: r.symbol, name: r.name || r.symbol,
                asset_class: r.asset_class || "기타", sector: r.sector || "기타",
                currency: r.currency || "KRW",
                shares, buy_price, current_price,
                book_value: r.book_value ? toNum(r.book_value) : shares * buy_price,
                market_value: r.market_value ? toNum(r.market_value) : shares * current_price,
                return_pct: r.return_pct != null && r.return_pct !== "" ? toNum(r.return_pct)
                  : (buy_price > 0 ? ((current_price - buy_price) / buy_price) * 100 : 0),
                target_price: r.target_price ? toNum(r.target_price) : undefined,
                stop_loss: r.stop_loss ? toNum(r.stop_loss) : undefined,
                thesis_id: r.thesis_id || undefined,
                horizon_months: r.horizon_months ? toNum(r.horizon_months) : undefined,
                confidence: r.confidence || undefined,
                last_reviewed: r.last_reviewed || undefined,
                proposed_action: r.proposed_action || undefined,
                quote_symbol: r.quote_symbol || undefined,
                quote_source: r.quote_source || "yahoo",
                has_live_quote: r.has_live_quote === "true" || r.has_live_quote === true,
                isin: r.isin || undefined,
                kr_listing_code: r.kr_listing_code || undefined,
                listing_market: r.listing_market || undefined,
                tax_regime: r.tax_regime || undefined,
                notes: r.notes || undefined,
              };
            });
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

        // 5-bucket targets + index triggers (AJ4 — new files).
        let bucketList: BucketTarget[] = [];
        try {
          const txt = await ariadne.readText("targets/buckets-2026.yaml");
          const parsed = parseYaml(txt) as { buckets?: BucketTarget[] };
          bucketList = parsed.buckets ?? [];
        } catch (_e) { /* file absent — surface shows empty bucket panel */ }

        let trigList: IndexTrigger[] = [];
        try {
          const txt = await ariadne.readText("targets/triggers.yaml");
          const parsed = parseYaml(txt) as { triggers?: IndexTrigger[] };
          trigList = parsed.triggers ?? [];
        } catch (_e) { /* */ }

        // history.csv — kept from v1 demo seed; renders the value-trend
        // line chart restored in AL1.
        let histList: HistPoint[] = [];
        try {
          const { rows } = await ariadne.readCsv("history.csv");
          histList = rows.map((r: any) => ({
            label: String(r.date ?? ""),
            value: Number(r.value ?? 0),
            fxEffect: Number(r.fx_effect ?? 0),
          })).filter((h: HistPoint) => h.label && Number.isFinite(h.value));
        } catch (_e) { /* file absent — chart silently hidden */ }

        // AM — positions/watchlist.csv (tracked-but-not-held).
        let wlList: typeof watchlist = [];
        try {
          const { rows } = await ariadne.readCsv("positions/watchlist.csv");
          wlList = rows.map((r: any) => ({
            symbol: r.symbol,
            name: r.name,
            asset_class: r.asset_class,
            sector: r.sector,
            currency: r.currency,
            trigger_price: r.trigger_price ? Number(r.trigger_price) : undefined,
            thesis_id: r.thesis_id || undefined,
            notes: r.notes || undefined,
            quote_symbol: r.quote_symbol || undefined,
          })).filter((r: any) => r.symbol);
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
        setBuckets(bucketList);
        setTriggers(trigList);
        setHistory(histList);
        setWatchlist(wlList);
        setAnalysisFiles(af);

        // AO — Live quotes. Detailed call returns the full Quote (with
        // Yahoo's meta extras: 52w high/low, day high/low, volume,
        // previous close) so the detail page can show a live snapshot
        // even when news/thesis files are missing. Errors keyed for the
        // 'no quote' badge in the table.
        const yahooSyms = posList
          .filter((p) => (p.quote_source ?? "yahoo") === "yahoo")
          .map((p) => p.quote_symbol ?? p.symbol)
          .filter((s): s is string => !!s);
        if (yahooSyms.length > 0 && typeof ariadne.getQuotesDetailed === "function") {
          try {
            const { quotes, errors } = await ariadne.getQuotesDetailed(yahooSyms);
            if (!cancelled) {
              if (errors.length > 0) {
                const m: Record<string, QuoteFailure> = {};
                for (const e of errors) m[e.inputSymbol] = e;
                setQuoteFailures(m);
              } else {
                setQuoteFailures({});
              }
              const qm: Record<string, LiveQuote> = {};
              for (const q of quotes) {
                if (q.inputSymbol) qm[q.inputSymbol.toUpperCase()] = q as LiveQuote;
                if (q.resolvedSymbol) qm[q.resolvedSymbol.toUpperCase()] = q as LiveQuote;
                if (q.symbol) qm[q.symbol.toUpperCase()] = q as LiveQuote;
              }
              setLiveQuotes(qm);
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
  }, [ariadne, refreshTick]);

  // AO — dedicated FX effect. Refetches when base currency or the set
  // of held currencies changes — without re-walking the whole CSV/YAML
  // load pipeline. Bumping refreshTick also re-runs it (manual refresh
  // path). Falls back to identity (base only) on network error.
  const dataCurrencies = useMemo(() => {
    const seen = new Set<string>();
    for (const p of positions) if (p.currency) seen.add(p.currency);
    for (const c of cash) if (c.currency) seen.add(c.currency);
    for (const m of metals) if (m.currency) seen.add(m.currency);
    for (const f of funds) if (f.currency) seen.add(f.currency);
    seen.delete("MIXED");
    return Array.from(seen).sort();
  }, [positions, cash, metals, funds]);

  useEffect(() => {
    let cancelled = false;
    const need = dataCurrencies.filter((c) => c !== base);
    if (need.length === 0) {
      setFxMap({ [base]: 1 });
      return;
    }
    (async () => {
      try {
        const rates = await ariadne.getFxRates(base, need);
        if (cancelled) return;
        const m: Record<string, number> = { [base]: 1 };
        for (const c of need) m[c] = rates[c] ?? 0;
        setFxMap(m);
      } catch (_e) {
        if (!cancelled) setFxMap({ [base]: 1 });
      }
    })();
    return () => { cancelled = true; };
  }, [ariadne, base, dataCurrencies, refreshTick]);

  const refreshQuotes = useCallback(() => setRefreshTick((n) => n + 1), []);

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

    // AN — pro-trader metrics. Concentration over invested capital (not
    // net worth), since cash is by definition diversified.
    const ranked = positions
      .map((p) => ({ p, base: toBase(p.market_value, p.currency, fxMap) }))
      .filter((x) => Number.isFinite(x.base) && x.base > 0)
      .sort((a, b) => b.base - a.base);
    const totalInvested = ranked.reduce((s, x) => s + x.base, 0);
    const top1 = ranked[0];
    const top5 = ranked.slice(0, 5);
    const concentration = {
      top1Pct: totalInvested > 0 && top1 ? (top1.base / totalInvested) * 100 : 0,
      top1Symbol: top1?.p.symbol ?? "—",
      top5Pct: totalInvested > 0 ? (top5.reduce((s, x) => s + x.base, 0) / totalInvested) * 100 : 0,
      top5Symbols: top5.map((x) => x.p.symbol),
    };
    const gainers = positions.filter((p) => Number.isFinite(p.return_pct) && p.return_pct > 0);
    const losers = positions.filter((p) => Number.isFinite(p.return_pct) && p.return_pct < 0);
    const capViolators = ranked
      .filter((x) => totalInvested > 0 && (x.base / totalInvested) * 100 > 10)
      .map((x) => x.p);

    return {
      totalNetWorthBase, totalInvestedBase, totalCashBase, totalIdleBase,
      byAssetClass, byCurrency, bySector, byRegion,
      accountRollup, closingAccounts, taxAccounts, staleTheses, missingTheses,
      concentration, gainers, losers, capViolators,
    };
  }, [positions, cash, metals, funds, accounts, fxMap]);

  // ── Filter + sort positions ────────────────────────────────────────────
  const visiblePositions = useMemo(() => {
    const lower = search.toLowerCase().trim();
    // AN — quick-filter pre-pass (chip strip): collect symbols matching
    // the current chip, then intersect with the existing search/select
    // filters. 'all' is a no-op.
    let chipSet: Set<string> | null = null;
    if (quickFilter === "gainers") chipSet = new Set(derived.gainers.map((p) => `${p.account_id}-${p.symbol}`));
    else if (quickFilter === "losers") chipSet = new Set(derived.losers.map((p) => `${p.account_id}-${p.symbol}`));
    else if (quickFilter === "stale") chipSet = new Set(derived.staleTheses.map((p) => `${p.account_id}-${p.symbol}`));
    else if (quickFilter === "cap") chipSet = new Set(derived.capViolators.map((p) => `${p.account_id}-${p.symbol}`));

    let list = positions.filter((p) => {
      if (chipSet && !chipSet.has(`${p.account_id}-${p.symbol}`)) return false;
      if (filterAccount && p.account_id !== filterAccount) return false;
      if (filterAssetClass && p.asset_class !== filterAssetClass) return false;
      if (lower) {
        const sym = (p.symbol ?? "").toLowerCase();
        const nm = (p.name ?? "").toLowerCase();
        if (!sym.includes(lower) && !nm.includes(lower)) return false;
      }
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
  }, [positions, derived, quickFilter, filterAccount, filterAssetClass, search, sortKey, sortDir, fxMap]);

  const flipSort = useCallback((k: typeof sortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "symbol" || k === "account_id" ? "asc" : "desc"); }
  }, [sortKey]);

  // AL1 — open the drill-down modal. Best-effort load of the thesis
  // markdown so the modal can render the user's stated position view.
  // AM extends: also fetches positions/history/<key>.csv (price history)
  // and analysis/news/<key>.md (analyst targets + headlines) in parallel
  // so the modal renders a price chart + news pane.
  const openPosition = useCallback(async (p: RawPosition) => {
    setActivePosition(p);
    setActiveThesis(null);
    setActivePriceHistory([]);
    setActiveNews(null);
    const key = fileKey(p);

    // Three independent fetches; failure of any is silently ignored
    // (the modal renders the missing-file fallback message in each pane).
    const tasks: Promise<unknown>[] = [];

    if (p.thesis_id) {
      tasks.push((async () => {
        try {
          const body = await ariadne.readText(`analysis/micro/${p.thesis_id}.md`);
          setActiveThesis(body);
        } catch (_e) { /* */ }
      })());
    }
    tasks.push((async () => {
      try {
        const { rows } = await ariadne.readCsv(`positions/history/${key}.csv`);
        const points = rows
          .map((r: any) => ({
            label: String(r.date ?? ""),
            value: Number(r.price ?? 0),
            note: r.note || undefined,
          }))
          .filter((pt: PricePoint) => pt.label && Number.isFinite(pt.value) && pt.value > 0);
        setActivePriceHistory(points);
      } catch (_e) { /* */ }
    })());
    tasks.push((async () => {
      try {
        const body = await ariadne.readText(`analysis/news/${key}.md`);
        setActiveNews(body);
      } catch (_e) { /* */ }
    })());

    await Promise.allSettled(tasks);
  }, [ariadne]);

  if (loading) {
    return <div style={{ padding: 24, color: "rgb(var(--muted-foreground))" }}>Loading workspace…</div>;
  }
  if (loadError) {
    return <div style={{ padding: 24, color: "rgb(var(--destructive))" }}>Failed to load: {loadError}</div>;
  }

  // AO — route swap: position detail takes over the entire surface
  // viewport when activePosition is set. No more modal overlay — the
  // back arrow drops back to the dashboard.
  if (activePosition) {
    const liveKey = String(activePosition.quote_symbol ?? activePosition.symbol ?? "").toUpperCase();
    return (
      <div style={{ padding: "16px 20px", maxWidth: 1280, margin: "0 auto", fontSize: 13, color: "rgb(var(--foreground))" }}>
        <PositionDetailPage
          position={activePosition}
          account={accounts.find((a) => a.id === activePosition.account_id)}
          thesisBody={activeThesis}
          priceHistory={activePriceHistory}
          newsBody={activeNews}
          liveQuote={liveQuotes[liveKey]}
          onBack={() => setActivePosition(null)}
          onRefreshQuote={refreshQuotes}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 20px", maxWidth: 1280, margin: "0 auto", fontSize: 13, color: "rgb(var(--foreground))" }}>
      {/* AM — base currency selector pinned to the top right. AO: list
          is limited to currencies actually present in the data. */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <BaseCurrencySelector base={base} onChange={setBase} options={dataCurrencies} onRefresh={refreshQuotes} />
      </div>

      <ActionStrip accounts={accounts} derived={derived} buckets={buckets} base={base} />
      <NetWorthCard accounts={accounts} positions={positions} derived={derived} base={base} onRefresh={refreshQuotes} />
      <ValueTrendChart history={history} base={base} showFx={showFx} setShowFx={setShowFx} />
      {/* AM — '자산 배분' (AllocationGrid + BucketGapTable) removed per user
          request. TriggerGauge stays — it's about trade timing, not allocation. */}
      <TriggerGauge triggers={triggers} />
      <AccountsTable accounts={accounts} derived={derived} base={base} />
      <PositionsTable
        accounts={accounts}
        positions={positions}
        visiblePositions={visiblePositions}
        derived={derived}
        fxMap={fxMap}
        base={base}
        quoteFailures={quoteFailures}
        search={search}
        setSearch={setSearch}
        filterAccount={filterAccount}
        setFilterAccount={setFilterAccount}
        filterAssetClass={filterAssetClass}
        setFilterAssetClass={setFilterAssetClass}
        quickFilter={quickFilter}
        setQuickFilter={setQuickFilter}
        sortKey={sortKey}
        sortDir={sortDir}
        flipSort={flipSort}
        onRowClick={openPosition}
      />
      <WatchlistTable rows={watchlist} />
      <CashAndManualAssets accounts={accounts} cash={cash} metals={metals} funds={funds} />
      <RecentAnalysis files={analysisFiles} />
    </div>
  );
}
