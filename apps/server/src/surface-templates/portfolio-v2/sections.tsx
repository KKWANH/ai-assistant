/**
 * Page-level sections — one component per scroll section of the Portfolio
 * v2 dashboard. Each section is dumb: receives data + callbacks via props,
 * delegates rendering to primitives.tsx.
 *
 * Order (vertical scroll on the page):
 *   ActionStrip → NetWorthCard → AllocationGrid → AccountsTable →
 *   PositionsTable → CashAndManualAssets → RecentAnalysis
 */

import { BarChart, PieChart, LineChart, useState, useMemo } from "@ariadne/surface";
import type { Account, RawPosition, CashBucket, ManualAsset, Derived, QuoteFailure, LiveQuote, BucketTarget, IndexTrigger, HistPoint, PricePoint, QuoteCalendar } from "./types";
import { fmtMoney, fmtPct, fmtNum, daysBetween, daysUntil, toBase } from "./utils";
import { Markdown } from "./markdown";
import {
  Section, ActionCard, KpiCard, Chart, Table, SortHead, Badge, AnalysisColumn,
  tdLeft, tdRight, inputStyle, subHead, mutedDot,
} from "./primitives";

// ─ 1 ─ Action strip ──────────────────────────────────────────────────────
export function ActionStrip({ accounts, derived, buckets, base }: { accounts: Account[]; derived: Derived; buckets: BucketTarget[]; base: string }) {
  // Cap violations from targets/buckets-2026.yaml (AJ4) — surface them as
  // first-class urgency cards. These are the '리밸런싱 1순위' items.
  const violations: Array<{ icon: string; title: string; detail: string; accent: "destructive" | "warning" }> = [];
  for (const b of buckets) {
    for (const v of b.current_violations ?? []) {
      const tag = v.position ?? v.sector ?? "violation";
      const excess = v.excess_pct != null ? ` (+${v.excess_pct.toFixed(1)}pp 초과)` : "";
      const action = v.action ? ` — ${v.action}` : "";
      violations.push({
        icon: "⚠️",
        title: `cap 위반: ${tag}`,
        detail: `현재 ${v.current_pct.toFixed(1)}% / cap ${v.cap_pct}%${excess}${action}`,
        accent: (v.excess_pct ?? 0) > 5 ? "destructive" : "warning",
      });
    }
  }
  return (
    <Section title="시급 / 알림" icon="🚨">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
        {derived.closingAccounts.map((a) => {
          const d = a.closing_date ? daysUntil(a.closing_date) : null;
          const urgent = d !== null && d <= 60;
          return (
            <ActionCard
              key={a.id}
              icon="🚨"
              title={`${a.label} 폐쇄 임박`}
              detail={d !== null ? `D-${d}일 (${a.closing_date})` : a.closing_date ?? ""}
              accent={urgent ? "destructive" : "warning"}
            />
          );
        })}
        {derived.taxAccounts.map((a) => {
          const used = a.annual_cap_used ?? 0;
          const cap = a.annual_cap_amount ?? 0;
          const pct = cap > 0 ? (used / cap) * 100 : 0;
          const remaining = cap - used;
          return (
            <ActionCard
              key={a.id}
              icon="💰"
              title={`${a.label} 한도`}
              detail={`사용 ${pct.toFixed(1)}% · 잔여 ${fmtMoney(remaining, a.annual_cap_currency ?? a.currency)}`}
              accent={pct < 50 ? "info" : "muted"}
            />
          );
        })}
        {derived.totalIdleBase > 0 && (
          <ActionCard
            icon="💤"
            title="유휴 자금"
            detail={`${fmtMoney(derived.totalIdleBase, base)} (${(derived.totalIdleBase / derived.totalNetWorthBase * 100).toFixed(1)}% 비중)`}
            accent="warning"
          />
        )}
        {derived.staleTheses.length > 0 && (
          <ActionCard
            icon="📝"
            title="thesis 90일 경과"
            detail={`${derived.staleTheses.length}개 포지션 — review 필요`}
            accent="warning"
          />
        )}
        {derived.missingTheses.length > 0 && (
          <ActionCard
            icon="❓"
            title="thesis 미작성"
            detail={`${derived.missingTheses.length}개 포지션 — analysis/micro/ 작성 필요`}
            accent="muted"
          />
        )}
        {violations.map((v, i) => (
          <ActionCard key={`viol-${i}`} icon={v.icon} title={v.title} detail={v.detail} accent={v.accent} />
        ))}
      </div>
    </Section>
  );
}

// ─ 4.5 ─ Bucket gap table (AJ4) ──────────────────────────────────────────
export function BucketGapTable({ buckets, base }: { buckets: BucketTarget[]; base: string }) {
  if (buckets.length === 0) return null;
  return (
    <Section title="5-bucket 갭 분석" icon="🎯">
      <Table headers={["버킷", "현재", "목표", "갭", "스탠스", "목표액", "위반"]}>
        {buckets.map((b) => {
          const violationCount = b.current_violations?.length ?? 0;
          const gapTone = Math.abs(b.gap_pp) > 20 ? "destructive" : Math.abs(b.gap_pp) > 10 ? "warning" : "muted";
          return (
            <tr key={b.id} style={{ borderBottom: "1px solid rgb(var(--border))" }}>
              <td style={tdLeft}><strong>{b.label}</strong></td>
              <td style={tdRight}>{b.current_pct.toFixed(1)}%</td>
              <td style={tdRight}>{b.target_pct.toFixed(1)}%</td>
              <td style={{ ...tdRight, color: b.gap_pp > 5 ? "rgb(var(--success))" : b.gap_pp < -5 ? "rgb(var(--destructive))" : "rgb(var(--muted-foreground))" }}>
                {b.gap_pp >= 0 ? "+" : ""}{b.gap_pp.toFixed(1)}pp
              </td>
              <td style={tdLeft}><Badge tone={gapTone}>{b.stance}</Badge></td>
              <td style={tdRight}>{fmtMoney(b.target_amount_krw, base)}</td>
              <td style={tdLeft}>
                {violationCount > 0
                  ? <Badge tone="destructive">{violationCount}건</Badge>
                  : <span style={{ color: "rgb(var(--muted-foreground))" }}>—</span>}
              </td>
            </tr>
          );
        })}
      </Table>
    </Section>
  );
}

// ─ 4.6 ─ Trigger gauge (AJ4 / AK fix) ───────────────────────────────────
//
// AK: every level access is null-guarded. Earlier YAML parser bug
// produced rows whose `level` was undefined (the inline `{key: val}`
// flow form parsed as `{"{ key": val}` — see yaml.ts comment). Even
// with triggers.yaml now using indented form, the surface stays
// defensive: a future YAML edit shouldn't crash the dashboard.
function levelLabel(z: { level?: number | string; drawdown_pct?: number }): string {
  if (typeof z.level === "string") return z.level;
  if (typeof z.level === "number") return z.level.toLocaleString();
  if (typeof z.drawdown_pct === "number") return `${z.drawdown_pct}%`;
  return "—";
}

export function TriggerGauge({ triggers }: { triggers: IndexTrigger[] }) {
  if (triggers.length === 0) return null;
  return (
    <Section title="매매 트리거 (지수·환율)" icon="🎚️">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
        {triggers.map((t) => {
          const buyZone = t.zones?.buy_zone ?? [];
          const trimZone = t.zones?.trim_zone ?? [];
          const fxExpand = t.zones?.fx_expand_below ?? [];
          const fxMin = t.zones?.fx_minimize_above ?? [];
          const cur = typeof t.current_value === "number" ? t.current_value.toLocaleString() : (t.current_value ?? "—");
          return (
            <div key={t.id} style={{ border: "1px solid rgb(var(--border))", borderRadius: 8, padding: 8, background: "rgb(var(--card))" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <strong style={{ fontSize: 12 }}>{t.label}</strong>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{cur}</span>
              </div>
              <div style={{ fontSize: 11, color: "rgb(var(--muted-foreground))", display: "flex", flexDirection: "column", gap: 2 }}>
                {buyZone.map((z, i) => (
                  <div key={`b-${i}`}><Badge tone="success">매수</Badge> {levelLabel(z)} — {z.action ?? "—"}</div>
                ))}
                {trimZone.map((z, i) => (
                  <div key={`t-${i}`}><Badge tone="warning">익절</Badge> {levelLabel(z)} — {z.action ?? "—"}</div>
                ))}
                {fxExpand.map((z, i) => (
                  <div key={`fx-${i}`}><Badge tone="info">환전 ↑</Badge> ≤{levelLabel(z)} — {z.action ?? "—"}</div>
                ))}
                {fxMin.map((z, i) => (
                  <div key={`fxm-${i}`}><Badge tone="muted">환전 ↓</Badge> ≥{levelLabel(z)} — {z.action ?? "—"}</div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ─ 2 ─ Net worth card ────────────────────────────────────────────────────
// AN — adds concentration KPIs (top1, top5) + refresh button. The five
// original cards stay; pro-trader strip below adds risk visibility.
export function NetWorthCard({ accounts, positions, derived, base, onRefresh }: { accounts: Account[]; positions: RawPosition[]; derived: Derived; base: string; onRefresh?: () => void }) {
  const investedPct = derived.totalNetWorthBase > 0 ? (derived.totalInvestedBase / derived.totalNetWorthBase * 100) : 0;
  const cashPct = derived.totalNetWorthBase > 0 ? (derived.totalCashBase / derived.totalNetWorthBase * 100) : 0;
  const idleOfCash = derived.totalCashBase > 0 ? (derived.totalIdleBase / derived.totalCashBase * 100) : 0;
  return (
    <Section title="순자산" icon="📊">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "rgb(var(--muted-foreground))" }}>
          {positions.length} 포지션 · {accounts.length} 계좌
        </span>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            style={{ fontSize: 11, padding: "3px 10px", borderRadius: 4, border: "1px solid rgb(var(--border))", background: "rgb(var(--surface-2))", color: "rgb(var(--foreground))", cursor: "pointer" }}
            title="getQuotes() 재호출"
          >
            🔄 시세 갱신
          </button>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
        <KpiCard label="총 순자산" value={fmtMoney(derived.totalNetWorthBase, base)} muted={base} />
        <KpiCard label="투자 자산" value={fmtMoney(derived.totalInvestedBase, base)} muted={`${investedPct.toFixed(1)}%`} />
        <KpiCard label="현금 합계" value={fmtMoney(derived.totalCashBase, base)} muted={`${cashPct.toFixed(1)}%`} />
        <KpiCard label="유휴 자금" value={fmtMoney(derived.totalIdleBase, base)} muted={`${idleOfCash.toFixed(0)}% / cash`} />
        <KpiCard
          label={`최대 단일 (${derived.concentration.top1Symbol})`}
          value={`${derived.concentration.top1Pct.toFixed(1)}%`}
          muted={derived.concentration.top1Pct > 10 ? "★ cap 위반" : "투자 자산 대비"}
        />
        <KpiCard
          label="Top-5 집중도"
          value={`${derived.concentration.top5Pct.toFixed(1)}%`}
          muted={derived.concentration.top5Symbols.slice(0, 3).join(" · ")}
        />
      </div>
    </Section>
  );
}

// ─ 3 ─ Allocation grid (AQ: compact restoration / AR: responsive) ───────
// Lost in the AM redesign. Self-review flagged this as a daily-driver PM
// view — "where is the money concentrated?". 4 mini-pies / mini-bar in a
// single row, smaller than before so they don't dominate the page.
export function AllocationGrid({ derived, isMobile }: { derived: Derived; isMobile?: boolean }) {
  // Risk metrics from history.csv (if present) — surfaced here next to
  // allocation since both are "shape of my book" KPIs.
  const r = derived.risk;
  const chartW = isMobile ? 280 : 220;
  return (
    <Section title="자산 배분 + 리스크" icon="🥧">
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${chartW}px, 1fr))`, gap: 10 }}>
        <Chart title="자산군">
          <PieChart data={derived.byAssetClass} title="" width={chartW} height={160} />
        </Chart>
        <Chart title="통화">
          <PieChart data={derived.byCurrency} title="" width={chartW} height={160} />
        </Chart>
        <Chart title={`섹터 top ${Math.min(derived.bySector.length, 8)}`}>
          <BarChart data={derived.bySector.slice(0, 8)} title="" width={chartW} height={160} />
        </Chart>
        <Chart title="지역">
          <PieChart data={derived.byRegion} title="" width={chartW} height={160} />
        </Chart>
      </div>
      {r && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginTop: 10 }}>
          <KpiCard
            label="변동성 (연환산)"
            value={`${r.volPctAnnual.toFixed(1)}%`}
            muted={`${r.monthsUsed}개월 기반`}
          />
          <KpiCard
            label="Sharpe (rf=0)"
            value={r.sharpe.toFixed(2)}
            muted={r.sharpe >= 1 ? "양호" : r.sharpe >= 0 ? "낮음" : "음수"}
          />
          <KpiCard
            label="최대 낙폭 (MDD)"
            value={`-${r.maxDrawdownPct.toFixed(1)}%`}
            muted={r.maxDrawdownPct > 20 ? "★ 큼" : "관리 범위"}
          />
          <KpiCard
            label="섹터 HHI"
            value={r.sectorHHI.toFixed(3)}
            muted={r.sectorHHI > 0.25 ? "★ 집중" : r.sectorHHI > 0.15 ? "보통" : "분산"}
          />
        </div>
      )}
    </Section>
  );
}

// ─ 4 ─ Accounts table ────────────────────────────────────────────────────
export function AccountsTable({ accounts, derived, base }: { accounts: Account[]; derived: Derived; base: string }) {
  return (
    <Section title="계좌" icon="🏦">
      <Table headers={["계좌", "유형", "통화", "투자가치", "예수금", "포지션", "비중", "상태"]}>
        {accounts.map((a) => {
          const r = derived.accountRollup.get(a.id) ?? { value: 0, positions: 0, cash: 0 };
          const total = r.value + r.cash;
          const wPct = derived.totalNetWorthBase > 0 ? (total / derived.totalNetWorthBase) * 100 : 0;
          const badge = a.status === "closing"
            ? <Badge tone="destructive">폐쇄 임박</Badge>
            : a.tax_advantaged
            ? <Badge tone="info">세제우대</Badge>
            : a.is_idle
            ? <Badge tone="warning">유휴</Badge>
            : <Badge tone="muted">표준</Badge>;
          return (
            <tr key={a.id} style={{ borderBottom: "1px solid rgb(var(--border))" }}>
              <td style={tdLeft}>{a.label}</td>
              <td style={tdLeft}>{a.type}{a.sub_type ? ` · ${a.sub_type}` : ""}</td>
              <td style={tdLeft}>{a.currency}</td>
              <td style={tdRight}>{fmtMoney(r.value, base)}</td>
              <td style={tdRight}>{r.cash > 0 ? fmtMoney(r.cash, base) : "—"}</td>
              <td style={tdRight}>{r.positions}</td>
              <td style={tdRight}>{wPct.toFixed(1)}%</td>
              <td style={tdLeft}>{badge}</td>
            </tr>
          );
        })}
      </Table>
    </Section>
  );
}

// ─ 5 ─ Positions table ───────────────────────────────────────────────────
// AN — pro-trader features:
//   · quick-filter chip strip (전체 / 수익 / 손실 / stale / cap 위반)
//   · 비중 column (% of total invested, base currency)
//   · fmtNum/fmtMoney everywhere (no raw .toLocaleString() — NaN safe)
//   · empty-state row when filters yield nothing (so user knows it's the
//     filter, not the data)
export type QuickFilter = "all" | "gainers" | "losers" | "stale" | "cap";

export interface PositionsTableProps {
  accounts: Account[];
  positions: RawPosition[];
  visiblePositions: RawPosition[];
  derived: Derived;
  fxMap: Record<string, number>;
  base: string;
  /** Symbols Yahoo couldn't quote, keyed by inputSymbol — renders an
   *  'unquotable' badge in the symbol column. Best-effort: missing
   *  entries fall back to the CSV-supplied current_price. */
  quoteFailures: Record<string, QuoteFailure>;
  search: string;
  setSearch: (s: string) => void;
  filterAccount: string;
  setFilterAccount: (s: string) => void;
  filterAssetClass: string;
  setFilterAssetClass: (s: string) => void;
  quickFilter: QuickFilter;
  setQuickFilter: (q: QuickFilter) => void;
  sortKey: "market_value" | "return_pct" | "symbol" | "account_id";
  sortDir: "asc" | "desc";
  flipSort: (k: PositionsTableProps["sortKey"]) => void;
  /** AL1 — row click handler. Opens the drill-down modal. */
  onRowClick?: (p: RawPosition) => void;
}

function FilterChip({ label, count, active, tone, onClick }: { label: string; count: number; active: boolean; tone: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 11,
        padding: "3px 10px",
        borderRadius: 999,
        border: `1px solid ${active ? "rgb(var(--accent))" : "rgb(var(--border))"}`,
        background: active ? "rgb(var(--accent))" : "rgb(var(--surface-2))",
        color: active ? "rgb(var(--accent-foreground))" : tone,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label} <span style={{ opacity: 0.7 }}>{count}</span>
    </button>
  );
}

export function PositionsTable(p: PositionsTableProps) {
  const accountLabel = (id: string): string => p.accounts.find((a) => a.id === id)?.label ?? id;

  // Sum of all positions' base-currency market value — denominator for
  // the 비중 column. Recomputed on each render but cheap (n ≤ ~100).
  const totalInvested = p.positions.reduce(
    (s, pos) => s + toBase(pos.market_value, pos.currency, p.fxMap),
    0,
  );

  const chip = (id: QuickFilter, label: string, count: number, tone: string) => (
    <FilterChip
      key={id}
      label={label}
      count={count}
      tone={tone}
      active={p.quickFilter === id}
      onClick={() => p.setQuickFilter(p.quickFilter === id ? "all" : id)}
    />
  );

  return (
    <Section title="보유 종목" icon="📈">
      {/* AN — quick-filter chip strip. Clicking again clears back to '전체'. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        {chip("all", "전체", p.positions.length, "rgb(var(--muted-foreground))")}
        {chip("gainers", "수익 +", p.derived.gainers.length, "rgb(var(--success))")}
        {chip("losers", "손실 −", p.derived.losers.length, "rgb(var(--destructive))")}
        {chip("stale", "thesis 90d+", p.derived.staleTheses.length, "rgb(var(--warning, var(--muted-foreground)))")}
        {chip("cap", "cap 위반 (>10%)", p.derived.capViolators.length, "rgb(var(--destructive))")}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input value={p.search} onChange={(e) => p.setSearch(e.target.value)} placeholder="symbol or name search…" style={inputStyle} />
        <select value={p.filterAccount} onChange={(e) => p.setFilterAccount(e.target.value)} style={inputStyle}>
          <option value="">모든 계좌</option>
          {p.accounts.map((a) => (<option key={a.id} value={a.id}>{a.label}</option>))}
        </select>
        <select value={p.filterAssetClass} onChange={(e) => p.setFilterAssetClass(e.target.value)} style={inputStyle}>
          <option value="">모든 자산군</option>
          {Array.from(new Set(p.positions.map((x) => x.asset_class).filter(Boolean))).map((c) => (<option key={c} value={c}>{c}</option>))}
        </select>
        <span style={{ alignSelf: "center", color: "rgb(var(--muted-foreground))", fontSize: 12 }}>
          {p.visiblePositions.length} / {p.positions.length}
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        {/* AO — name-first display. AQ — added P&L (base) column and
            collapsed target/stop into one cell with risk:reward visible. */}
        <Table headers={[
          <SortHead key="symbol" label="종목" onClick={() => p.flipSort("symbol")} active={p.sortKey === "symbol"} dir={p.sortDir} />,
          <SortHead key="account" label="계좌" onClick={() => p.flipSort("account_id")} active={p.sortKey === "account_id"} dir={p.sortDir} />,
          "자산군", "수량", "매수가", "현재가",
          <SortHead key="mkt" label="평가금액" onClick={() => p.flipSort("market_value")} active={p.sortKey === "market_value"} dir={p.sortDir} />,
          "비중",
          <SortHead key="ret" label="수익률" onClick={() => p.flipSort("return_pct")} active={p.sortKey === "return_pct"} dir={p.sortDir} />,
          `손익 (${p.base})`,
          "목표 / 손절", "thesis", "review",
        ]}>
          {p.visiblePositions.length === 0 ? (
            <tr>
              <td colSpan={13} style={{ ...tdLeft, textAlign: "center", padding: 16, color: "rgb(var(--muted-foreground))" }}>
                필터 결과가 없음. 칩 해제하거나 검색어 비우기.
              </td>
            </tr>
          ) : p.visiblePositions.map((pos) => {
            const stale = pos.last_reviewed ? daysBetween(pos.last_reviewed) > 90 : false;
            const noThesis = !pos.thesis_id;
            // AN — defensive symbol resolution. Either column can be empty
            // in a malformed CSV row; avoid .toUpperCase() on undefined.
            const qs = String(pos.quote_symbol || pos.symbol || "").toUpperCase();
            const quoteFail = qs ? p.quoteFailures[qs] : undefined;
            const handleClick = p.onRowClick ? () => p.onRowClick!(pos) : undefined;
            const baseValue = toBase(pos.market_value, pos.currency, p.fxMap);
            const weightPct = totalInvested > 0 ? (baseValue / totalInvested) * 100 : 0;
            const overCap = weightPct > 10;
            const ret = Number.isFinite(pos.return_pct) ? pos.return_pct : 0;
            // AQ — absolute P&L in base currency. Tells the PM "how much
            // did this position make me in real money" rather than just %.
            const bookValueBase = toBase(pos.book_value, pos.currency, p.fxMap);
            const pl = Number.isFinite(baseValue) && Number.isFinite(bookValueBase) ? baseValue - bookValueBase : NaN;
            return (
              <tr
                key={`${pos.account_id}-${pos.symbol}`}
                style={{
                  borderBottom: "1px solid rgb(var(--border))",
                  cursor: handleClick ? "pointer" : "default",
                }}
                onClick={handleClick}
              >
                <td style={{ ...tdLeft, maxWidth: 240, overflow: "hidden" }} title={`${pos.name || ""} (${pos.symbol || "—"})`}>
                  <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                    <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pos.name || pos.symbol || "—"}</strong>
                    <span style={{ fontSize: 10, color: "rgb(var(--muted-foreground))", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                      {pos.symbol || "—"}{pos.currency ? ` · ${pos.currency}` : ""}
                      {quoteFail && (
                        <span title={`quote failed: ${quoteFail.reason}`} style={{ marginLeft: 4 }}>
                          <Badge tone="warning">no quote</Badge>
                        </span>
                      )}
                    </span>
                  </div>
                </td>
                <td style={tdLeft}>{accountLabel(pos.account_id)}</td>
                <td style={tdLeft}>{pos.asset_class || "—"}</td>
                <td style={tdRight}>{fmtNum(pos.shares)}</td>
                <td style={tdRight}>{fmtMoney(pos.buy_price, pos.currency)}</td>
                <td style={tdRight}>{fmtMoney(pos.current_price, pos.currency)}</td>
                <td style={tdRight}><strong>{fmtMoney(pos.market_value, pos.currency)}</strong></td>
                <td style={{ ...tdRight, color: overCap ? "rgb(var(--destructive))" : "rgb(var(--foreground))", fontWeight: overCap ? 600 : 400 }}>
                  {weightPct.toFixed(1)}%{overCap ? " ★" : ""}
                </td>
                <td style={{ ...tdRight, color: ret >= 0 ? "rgb(var(--success))" : "rgb(var(--destructive))" }}>{fmtPct(ret)}</td>
                <td style={{ ...tdRight, color: pl >= 0 ? "rgb(var(--success))" : "rgb(var(--destructive))" }}>
                  {Number.isFinite(pl) ? fmtMoney(pl, p.base) : <span style={mutedDot}>—</span>}
                </td>
                <td style={tdRight}>
                  {pos.target_price != null || pos.stop_loss != null ? (
                    <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25, alignItems: "flex-end" }}>
                      {pos.target_price != null && (
                        <span style={{ color: "rgb(var(--success))", fontSize: 11 }}>
                          ↑ {fmtNum(pos.target_price)}
                          {pos.current_price > 0 && ` (${((pos.target_price - pos.current_price) / pos.current_price * 100).toFixed(0)}%)`}
                        </span>
                      )}
                      {pos.stop_loss != null && (
                        <span style={{ color: "rgb(var(--destructive))", fontSize: 11 }}>
                          ↓ {fmtNum(pos.stop_loss)}
                          {pos.current_price > 0 && ` (${((pos.stop_loss - pos.current_price) / pos.current_price * 100).toFixed(0)}%)`}
                        </span>
                      )}
                    </div>
                  ) : <span style={mutedDot}>—</span>}
                </td>
                <td style={tdLeft}>{noThesis ? <Badge tone="muted">미작성</Badge> : <code style={{ fontSize: 10 }}>{pos.thesis_id}</code>}</td>
                <td style={tdLeft}>{pos.last_reviewed ? (stale ? <Badge tone="warning">{pos.last_reviewed}</Badge> : <span style={{ color: "rgb(var(--muted-foreground))" }}>{pos.last_reviewed}</span>) : <Badge tone="muted">—</Badge>}</td>
              </tr>
            );
          })}
        </Table>
      </div>
      <ReturnsBarChart positions={p.visiblePositions} />
    </Section>
  );
}

// ─ 6 ─ Cash + manual-value assets ────────────────────────────────────────
export function CashAndManualAssets({ accounts, cash, metals, funds }: { accounts: Account[]; cash: CashBucket[]; metals: ManualAsset[]; funds: ManualAsset[] }) {
  const accountLabel = (id: string): string => accounts.find((a) => a.id === id)?.label ?? id;
  return (
    <Section title="현금 / 비-쿼트 자산" icon="💵">
      {cash.length > 0 && (
        <>
          <h4 style={subHead}>현금 buckets</h4>
          <Table headers={["라벨", "유형", "계좌", "통화", "금액", "APR", "유휴", "비상금", "메모"]}>
            {cash.map((c) => (
              <tr key={c.id} style={{ borderBottom: "1px solid rgb(var(--border))" }}>
                <td style={tdLeft}>{c.label}</td>
                <td style={tdLeft}>{c.type}</td>
                <td style={tdLeft}>{c.within_account_id ? accountLabel(c.within_account_id) : "—"}</td>
                <td style={tdLeft}>{c.currency}</td>
                <td style={tdRight}><strong>{fmtMoney(c.amount, c.currency)}</strong></td>
                <td style={tdRight}>{c.apr != null ? `${c.apr}%` : "—"}</td>
                <td style={tdLeft}>{c.is_idle ? <Badge tone="warning">유휴</Badge> : "—"}</td>
                <td style={tdLeft}>{c.is_emergency_fund ? <Badge tone="info">비상금</Badge> : "—"}</td>
                <td style={{ ...tdLeft, fontSize: 11, color: "rgb(var(--muted-foreground))" }}>{c.notes ?? ""}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
      {(metals.length > 0 || funds.length > 0) && (
        <>
          <h4 style={subHead}>매뉴얼 평가 자산 <span style={{ fontSize: 11, color: "rgb(var(--muted-foreground))", fontWeight: 400 }}>(no live quote — 사용자 maintain)</span></h4>
          <Table headers={["자산", "계좌", "자산군", "수량", "통화", "평가금액", "수익률"]}>
            {[...metals, ...funds].map((m) => (
              <tr key={m.id} style={{ borderBottom: "1px solid rgb(var(--border))" }}>
                <td style={tdLeft}>{m.name} <Badge tone="muted">manual</Badge></td>
                <td style={tdLeft}>{m.account_id ? accountLabel(m.account_id) : "—"}</td>
                <td style={tdLeft}>{m.asset_class}</td>
                <td style={tdRight}>{m.quantity != null ? `${m.quantity} ${m.unit ?? ""}` : "—"}</td>
                <td style={tdLeft}>{m.currency}</td>
                <td style={tdRight}><strong>{fmtMoney(m.market_value, m.currency)}</strong></td>
                <td style={{ ...tdRight, color: (m.return_pct ?? 0) >= 0 ? "rgb(var(--success))" : "rgb(var(--destructive))" }}>
                  {m.return_pct != null ? fmtPct(m.return_pct) : "—"}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Section>
  );
}

// ─ 7 ─ Recent analysis links ─────────────────────────────────────────────
export function RecentAnalysis({ files }: { files: { macro: string[]; meso: string[]; micro: string[] } }) {
  return (
    <Section title="분석 문서" icon="📚">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <AnalysisColumn title="Macro (월)" files={files.macro} />
        <AnalysisColumn title="Meso (분기)" files={files.meso} />
        <AnalysisColumn title={`Micro (${files.micro.length})`} files={files.micro.slice(0, 10)} />
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: "rgb(var(--muted-foreground))" }}>
        액션 실행: macro_brief_monthly / sector_review_quarterly / position_check / rebalance_audit / account_closure_planner — Create &amp; Run 탭에서.
      </div>
    </Section>
  );
}

// ─ AL1 — Value trend chart ────────────────────────────────────────────────
// Reads history.csv (label, value, fx_effect). Was a v1 feature lost in
// the v2 rewrite — user explicitly missed it ('그래프가 더 불편하게
// 바뀜'). Render as LineChart at the top of the page so the long-view
// is the first thing users see.
export function ValueTrendChart({
  history, base, showFx, setShowFx, benchmark, isMobile,
}: {
  history: HistPoint[];
  base: string;
  showFx: boolean;
  setShowFx: (v: boolean) => void;
  /** AQ — Yahoo benchmark series for relative-performance overlay.
   *  Both series get normalized to 100 at the first portfolio point so
   *  the visual comparison is scale-agnostic. */
  benchmark?: { bench: { symbol: string; label: string }; points: Array<{ date: string; close: number }> } | null;
  isMobile?: boolean;
}) {
  const [showBench, setShowBench] = useState(true);
  if (history.length === 0) return null;
  const chartW = isMobile ? Math.min(window.innerWidth - 48, 600) : 1100;

  // AQ — Normalize both series to base=100 at the first portfolio point
  // for the benchmark overlay mode. If we just plotted KOSPI in ₩-thousands
  // vs portfolio in ₩-millions the visual would be useless.
  const series = history.map((h) => ({ label: h.label, value: h.value }));
  const fxSeries = showFx
    ? history.map((h) => ({ label: h.label, value: h.value - h.fxEffect }))
    : undefined;

  // Try to align benchmark closes to the same monthly labels by date.
  let benchSeries: Array<{ label: string; value: number }> | undefined;
  let alpha: number | null = null;
  if (benchmark && benchmark.points.length > 0 && history.length > 0) {
    const firstHist = history[0]!.value;
    const lastHist = history[history.length - 1]!.value;
    // Align: find benchmark close on/before each portfolio label.
    const benchAligned: number[] = [];
    for (const h of history) {
      const matching = benchmark.points.filter((p) => p.date.slice(0, 7) <= h.label.slice(0, 7));
      const last = matching[matching.length - 1];
      benchAligned.push(last ? last.close : NaN);
    }
    const firstBench = benchAligned.find((v) => Number.isFinite(v));
    if (firstBench && firstBench > 0) {
      benchSeries = history.map((h, i) => ({
        label: h.label,
        value: Number.isFinite(benchAligned[i]!) ? (benchAligned[i]! / firstBench) * firstHist : firstHist,
      }));
      // alpha = portfolio TR - benchmark TR over the same window
      const portTR = firstHist > 0 ? ((lastHist - firstHist) / firstHist) * 100 : 0;
      const lastBench = benchAligned[benchAligned.length - 1];
      const benchTR = (lastBench && firstBench > 0) ? ((lastBench - firstBench) / firstBench) * 100 : 0;
      alpha = portTR - benchTR;
    }
  }

  const useBench = showBench && benchSeries != null;
  const useFx = !useBench && showFx && fxSeries != null;

  return (
    <Section title={`가치 추이 (${base})`} icon="📈">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 11, color: "rgb(var(--muted-foreground))" }}>
          {history.length}개월 · history.csv
          {alpha != null && (
            <span style={{ marginLeft: 8, color: alpha >= 0 ? "rgb(var(--success))" : "rgb(var(--destructive))" }}>
              · α vs {benchmark!.bench.label}: {alpha >= 0 ? "+" : ""}{alpha.toFixed(1)}pp
            </span>
          )}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {benchSeries && (
            <button
              type="button"
              onClick={() => setShowBench(!showBench)}
              style={{
                fontSize: 11, padding: "2px 8px", borderRadius: 4,
                background: showBench ? "rgb(var(--accent))" : "rgb(var(--surface-2))",
                color: showBench ? "rgb(var(--accent-foreground))" : "rgb(var(--muted-foreground))",
                border: "1px solid rgb(var(--border))", cursor: "pointer",
              }}
            >
              {showBench ? "벤치마크 끄기" : `vs ${benchmark!.bench.label}`}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowFx(!showFx)}
            style={{
              fontSize: 11, padding: "2px 8px", borderRadius: 4,
              background: showFx && !useBench ? "rgb(var(--accent))" : "rgb(var(--surface-2))",
              color: showFx && !useBench ? "rgb(var(--accent-foreground))" : "rgb(var(--muted-foreground))",
              border: "1px solid rgb(var(--border))", cursor: "pointer",
            }}
          >
            {showFx ? "FX overlay 끄기" : "FX 영향 분리"}
          </button>
        </div>
      </div>
      {useBench ? (
        <LineChart
          data={series}
          compare={benchSeries!}
          seriesLabels={["내 포트폴리오", benchmark!.bench.label]}
          width={chartW}
          height={240}
        />
      ) : useFx ? (
        <LineChart
          data={series}
          compare={fxSeries!}
          seriesLabels={["실제 가치", "FX-중립 baseline"]}
          width={chartW}
          height={240}
        />
      ) : (
        <LineChart data={series} width={1100} height={240} />
      )}
    </Section>
  );
}

// ─ AL1 — Per-position returns bar chart ──────────────────────────────────
// Compact view of return_pct across all positions. Restored from v1.
export function ReturnsBarChart({ positions }: { positions: RawPosition[] }) {
  if (positions.length === 0) return null;
  // Top 15 by absolute return — keeps the chart readable.
  const top = positions
    .slice()
    .sort((a, b) => Math.abs(b.return_pct) - Math.abs(a.return_pct))
    .slice(0, 15)
    .map((p) => ({ label: p.symbol, value: p.return_pct }));
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 4, color: "rgb(var(--muted-foreground))" }}>
        종목별 수익률 % (상위 15)
      </div>
      <BarChart data={top} width={1100} height={200} />
    </div>
  );
}

// ─ AO — Position detail PAGE (replaces the AL1 modal) ────────────────────
// Click a position row → full-page route-swap (not a popup overlay). Big
// price chart with range selector at the top, KPIs, then thesis / news.
// When news/thesis files are missing, the live Yahoo snapshot (52w high/
// low, day range, volume, previous close) takes their place — no more
// ugly "파일 없음" placeholders for positions without docs.
type RangeKey = "1M" | "3M" | "6M" | "1Y" | "ALL";

function sliceHistoryByRange(points: PricePoint[], range: RangeKey): PricePoint[] {
  if (range === "ALL" || points.length === 0) return points;
  const months = range === "1M" ? 1 : range === "3M" ? 3 : range === "6M" ? 6 : 12;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const filtered = points.filter((p) => {
    const d = new Date(p.label);
    return Number.isFinite(d.getTime()) && d >= cutoff;
  });
  return filtered.length > 0 ? filtered : points;
}

export function PositionDetailPage({
  position,
  account,
  thesisBody,
  priceHistory,
  newsBody,
  liveQuote,
  calendar,
  onBack,
  onRefreshQuote,
  isMobile,
}: {
  position: RawPosition;
  account?: Account;
  thesisBody: string | null;
  /** Per-position price points loaded from positions/history/<key>.csv. */
  priceHistory: PricePoint[];
  /** Markdown body of analysis/news/<key>.md (analyst targets + headlines). */
  newsBody: string | null;
  /** AO — Yahoo's live snapshot (52w high/low, vol, etc.) — used as a
   *  fallback when thesis/news files are absent so the page never shows
   *  an ugly "파일 없음" pane. */
  liveQuote?: LiveQuote;
  /** AR — earnings + ex-div for this symbol. */
  calendar?: QuoteCalendar;
  onBack: () => void;
  onRefreshQuote?: () => void;
  isMobile?: boolean;
}) {
  const p = position;
  const [range, setRange] = useState<RangeKey>("1Y");

  const pl = Number.isFinite(p.current_price) && Number.isFinite(p.buy_price)
    ? p.current_price - p.buy_price
    : NaN;
  const targetPct = p.target_price && p.current_price > 0
    ? ((p.target_price - p.current_price) / p.current_price) * 100
    : null;
  const stopPct = p.stop_loss && p.current_price > 0
    ? ((p.current_price - p.stop_loss) / p.current_price) * 100
    : null;

  const sliced = sliceHistoryByRange(priceHistory, range);

  // External Yahoo Finance link. Useful when the local thesis/news file is
  // empty — user can click out to live news / analyst pages directly.
  const yahooSym = (p.quote_symbol || p.symbol || "").trim();
  const yahooUrl = yahooSym ? `https://finance.yahoo.com/quote/${encodeURIComponent(yahooSym)}` : null;

  return (
    <div>
      {/* AO — page header. Back arrow + name as primary identifier +
          symbol/exchange/account as the muted subtitle row. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 12 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
          <button
            type="button"
            onClick={onBack}
            style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid rgb(var(--border))", background: "rgb(var(--surface-2))", color: "rgb(var(--foreground))", cursor: "pointer", flexShrink: 0 }}
          >
            ← 목록
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{p.name || p.symbol || "—"}</div>
            <div style={{ fontSize: 12, color: "rgb(var(--muted-foreground))", marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <code style={{ fontSize: 11 }}>{p.symbol}</code>
              <span>· {p.asset_class} / {p.sector}</span>
              <span>· {account?.label ?? p.account_id}</span>
              <span>· {p.listing_market ?? p.currency}</span>
              {p.isin && <span>· ISIN {p.isin}</span>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {onRefreshQuote && (
            <button
              type="button"
              onClick={onRefreshQuote}
              style={{ fontSize: 11, padding: "4px 10px", borderRadius: 4, border: "1px solid rgb(var(--border))", background: "rgb(var(--surface-2))", color: "rgb(var(--foreground))", cursor: "pointer" }}
            >
              🔄 시세 갱신
            </button>
          )}
          {yahooUrl && (
            <a
              href={yahooUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 11, padding: "4px 10px", borderRadius: 4, border: "1px solid rgb(var(--border))", background: "rgb(var(--surface-2))", color: "rgb(var(--foreground))", textDecoration: "none" }}
            >
              Yahoo ↗
            </a>
          )}
        </div>
      </div>

      {/* AO — Big price chart with range selector. Same shape as a
          brokerage app's stock detail page. */}
      <div style={{ marginBottom: 16, padding: 12, background: "rgb(var(--card))", border: "1px solid rgb(var(--border))", borderRadius: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: "rgb(var(--muted-foreground))" }}>
            가격 추이 ({p.currency}){priceHistory.length > 0 ? ` · ${sliced.length} / ${priceHistory.length} points` : ""}
          </div>
          {priceHistory.length > 0 && (
            <div style={{ display: "flex", gap: 4 }}>
              {(["1M", "3M", "6M", "1Y", "ALL"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 4,
                    border: `1px solid ${range === r ? "rgb(var(--accent))" : "rgb(var(--border))"}`,
                    background: range === r ? "rgb(var(--accent))" : "rgb(var(--surface-2))",
                    color: range === r ? "rgb(var(--accent-foreground))" : "rgb(var(--foreground))",
                    cursor: "pointer",
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>
        {priceHistory.length > 0 ? (
          <LineChart
            data={sliced.map((h) => ({ label: h.label, value: h.value }))}
            width={isMobile ? Math.min(window.innerWidth - 48, 600) : 1100}
            height={260}
          />
        ) : (
          <div style={{ fontSize: 12, color: "rgb(var(--muted-foreground))", padding: "24px 0", textAlign: "center" }}>
            가격 히스토리 없음 · positions/history/{p.kr_listing_code || p.quote_symbol || p.symbol}.csv 추가하면 차트 표시
          </div>
        )}
      </div>

      {/* AO — KPI grid. Same as before but now full-width across the page. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 16 }}>
        <KpiCard label="평가금액" value={fmtMoney(p.market_value, p.currency)} muted={`${fmtNum(p.shares)}주`} />
        <KpiCard label="매수가" value={fmtNum(p.buy_price)} muted={p.currency} />
        <KpiCard label="현재가" value={fmtNum(p.current_price)} muted={Number.isFinite(pl) ? `${pl >= 0 ? "+" : ""}${pl.toFixed(2)}` : "—"} />
        <KpiCard label="수익률" value={fmtPct(Number.isFinite(p.return_pct) ? p.return_pct : 0)} muted={p.confidence ?? "—"} />
        <KpiCard label="목표가" value={fmtNum(p.target_price)} muted={targetPct != null ? `${targetPct >= 0 ? "+" : ""}${targetPct.toFixed(1)}%` : "미설정"} />
        <KpiCard label="손절" value={fmtNum(p.stop_loss)} muted={stopPct != null ? `-${Math.abs(stopPct).toFixed(1)}%` : "미설정"} />
      </div>

      {/* AR — calendar strip (earnings / ex-div from Yahoo v10). */}
      {calendar && (calendar.earningsDate || calendar.exDividendDate) && (
        <div style={{
          marginBottom: 12, padding: "8px 12px",
          background: "rgb(var(--surface-2))", borderRadius: 6,
          fontSize: 11, display: "flex", gap: 16, flexWrap: "wrap",
        }}>
          {calendar.earningsDate && (() => {
            const d = daysUntil(calendar.earningsDate);
            const tone = d <= 7 ? "rgb(var(--destructive))" : d <= 30 ? "rgb(var(--warning, var(--accent)))" : "rgb(var(--muted-foreground))";
            return (
              <span>
                📅 다음 실적 <strong style={{ color: tone }}>{calendar.earningsDate}</strong> (D{d >= 0 ? "-" : "+"}{Math.abs(d)})
                {calendar.earningsType === "estimate" && <span style={{ marginLeft: 4, color: "rgb(var(--muted-foreground))" }}>est.</span>}
              </span>
            );
          })()}
          {calendar.exDividendDate && (() => {
            const d = daysUntil(calendar.exDividendDate);
            const tone = d >= 0 && d <= 14 ? "rgb(var(--accent))" : "rgb(var(--muted-foreground))";
            return (
              <span>
                💵 ex-div <strong style={{ color: tone }}>{calendar.exDividendDate}</strong> (D{d >= 0 ? "-" : "+"}{Math.abs(d)})
                {calendar.dividendRate != null && <span style={{ marginLeft: 4, color: "rgb(var(--muted-foreground))" }}>· {fmtNum(calendar.dividendRate)} / {calendar.dividendYield != null ? `${(calendar.dividendYield * 100).toFixed(2)}%` : "—"}</span>}
              </span>
            );
          })()}
        </div>
      )}

      {/* AO — Live snapshot from Yahoo. Always rendered when we have a
          live quote: 52w high/low + day range + volume + prev close.
          Replaces what used to be the "no news file" placeholder. */}
      {liveQuote && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: "rgb(var(--muted-foreground))" }}>
            Live 스냅샷 · {liveQuote.market ?? "Yahoo"} ({liveQuote.resolvedSymbol ?? liveQuote.symbol})
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
            {liveQuote.fiftyTwoWeekLow != null && liveQuote.fiftyTwoWeekHigh != null && (
              <KpiCard
                label="52주 범위"
                value={`${fmtNum(liveQuote.fiftyTwoWeekLow)} – ${fmtNum(liveQuote.fiftyTwoWeekHigh)}`}
                muted={(() => {
                  const lo = liveQuote.fiftyTwoWeekLow, hi = liveQuote.fiftyTwoWeekHigh, cur = liveQuote.price;
                  if (lo != null && hi != null && hi > lo && Number.isFinite(cur)) {
                    const pct = ((cur - lo) / (hi - lo)) * 100;
                    return `현재 ${pct.toFixed(0)}% 위치`;
                  }
                  return liveQuote.currency;
                })()}
              />
            )}
            {liveQuote.regularMarketDayLow != null && liveQuote.regularMarketDayHigh != null && (
              <KpiCard
                label="당일 범위"
                value={`${fmtNum(liveQuote.regularMarketDayLow)} – ${fmtNum(liveQuote.regularMarketDayHigh)}`}
                muted={liveQuote.currency}
              />
            )}
            {liveQuote.previousClose != null && (
              <KpiCard
                label="전일 종가"
                value={fmtNum(liveQuote.previousClose)}
                muted={(() => {
                  const prev = liveQuote.previousClose;
                  if (prev != null && prev > 0 && Number.isFinite(liveQuote.price)) {
                    const ch = ((liveQuote.price - prev) / prev) * 100;
                    return `${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%`;
                  }
                  return liveQuote.currency;
                })()}
              />
            )}
            {liveQuote.regularMarketVolume != null && (
              <KpiCard
                label="거래량"
                value={fmtNum(liveQuote.regularMarketVolume)}
                muted="주"
              />
            )}
          </div>
        </div>
      )}

      {(p.proposed_action || p.notes) && (
        <div style={{ marginBottom: 16, padding: 12, background: "rgb(var(--surface-2))", borderRadius: 6, fontSize: 12 }}>
          {p.proposed_action && <div><strong>제안:</strong> {p.proposed_action}</div>}
          {p.notes && <div style={{ marginTop: 4, color: "rgb(var(--muted-foreground))" }}>{p.notes}</div>}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, fontSize: 11, color: "rgb(var(--muted-foreground))", marginBottom: 16, flexWrap: "wrap" }}>
        <span>thesis: <code>{p.thesis_id ?? "—"}</code></span>
        {p.horizon_months != null && <span>horizon: {p.horizon_months}개월</span>}
        {p.last_reviewed && <span>last review: {p.last_reviewed}</span>}
        {p.tax_regime && <span>tax: {p.tax_regime}</span>}
      </div>

      {/* AO — News / thesis panes only render when content exists. No
          more "(파일 없음 — ... 작성 권장)" placeholders cluttering the
          page. The live snapshot above carries the weight when files
          are missing.
          AP — markdown rendered via the lightweight ./markdown component:
          tables (analyst-target grids), headings, lists, bold/italic,
          links. Was <pre> with whitespace-pre-wrap before; analysts'
          target tables were unreadable. */}
      {newsBody && (
        <div style={{ marginBottom: 16, padding: 12, background: "rgb(var(--surface-2))", borderRadius: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: "rgb(var(--muted-foreground))" }}>뉴스 · 증권사 의견</div>
          <Markdown source={newsBody} />
        </div>
      )}

      {thesisBody && (
        <div style={{ padding: 12, background: "rgb(var(--surface-2))", borderRadius: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: "rgb(var(--muted-foreground))" }}>
            analysis/micro/{p.thesis_id ?? "?"}.md
          </div>
          <Markdown source={thesisBody} />
        </div>
      )}

      {/* AO — Inline action prompt when both files are missing. Replaces
          the old "파일 없음" placeholder with something the user can
          actually act on (or ignore). */}
      {!newsBody && !thesisBody && (
        <div style={{ marginTop: 16, padding: 12, background: "rgb(var(--surface-2))", borderRadius: 6, fontSize: 11, color: "rgb(var(--muted-foreground))" }}>
          이 종목에 대한 상세 분석은 위 Live 스냅샷 + 가격 추이로 갈음됩니다. 직접 메모하려면
          <code style={{ margin: "0 4px" }}>analysis/news/{p.kr_listing_code || p.quote_symbol || p.symbol}.md</code>
          또는
          <code style={{ margin: "0 4px" }}>analysis/micro/{p.thesis_id || (p.symbol + "-thesis")}.md</code>
          를 만드세요.
        </div>
      )}
    </div>
  );
}

// ─ AQ — Realized P&L section ─────────────────────────────────────────────
// FIFO-based realized PnL fed from transactions/*.csv. Shows headline KPI
// (YTD + all-time) + per-symbol breakdown. Without this, a PM can't
// answer "how much did I actually make this year?" or do tax filing.
export function RealizedPnLSection({
  derived, base, fxMap, transactions,
}: {
  derived: Derived;
  base: string;
  fxMap: Record<string, number>;
  transactions: Array<{ date: string; action: string; symbol: string; notes?: string }>;
}) {
  if (derived.realized.length === 0 && transactions.length === 0) return null;
  const recent = transactions.slice(-8).reverse();
  return (
    <Section title="실현 손익 + 거래 내역" icon="💰">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 12 }}>
        <KpiCard
          label={`YTD 실현 (${base})`}
          value={fmtMoney(derived.realizedYTDBase, base)}
          muted={derived.realizedYTDBase >= 0 ? "수익" : "손실"}
        />
        <KpiCard
          label={`전체 실현 (${base})`}
          value={fmtMoney(derived.realizedTotalBase, base)}
          muted={`${derived.realized.length}개 종목 거래`}
        />
        <KpiCard
          label="거래 건수"
          value={String(transactions.length)}
          muted={transactions.length > 0 ? `${transactions[0]!.date.slice(0, 7)} 이후` : "—"}
        />
      </div>

      {derived.realized.length > 0 && (
        <>
          <h4 style={subHead}>종목별 실현 손익 (FIFO)</h4>
          <Table headers={["종목", "통화", "실현 손익", "매도 금액", "원가", "수수료", "배당", "매도 건수"]}>
            {derived.realized.map((r) => (
              <tr key={r.symbol} style={{ borderBottom: "1px solid rgb(var(--border))" }}>
                <td style={tdLeft}>
                  <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                    <strong>{r.name}</strong>
                    <span style={{ fontSize: 10, color: "rgb(var(--muted-foreground))", fontFamily: "ui-monospace, monospace" }}>{r.symbol}</span>
                  </div>
                </td>
                <td style={tdLeft}>{r.currency}</td>
                <td style={{ ...tdRight, color: r.realized >= 0 ? "rgb(var(--success))" : "rgb(var(--destructive))", fontWeight: 600 }}>
                  {fmtMoney(r.realized, r.currency)}
                </td>
                <td style={tdRight}>{fmtMoney(r.proceeds, r.currency)}</td>
                <td style={tdRight}>{fmtMoney(r.costSold, r.currency)}</td>
                <td style={tdRight}>{r.fees > 0 ? fmtMoney(r.fees, r.currency) : <span style={mutedDot}>—</span>}</td>
                <td style={tdRight}>{r.dividends > 0 ? fmtMoney(r.dividends, r.currency) : <span style={mutedDot}>—</span>}</td>
                <td style={tdRight}>{r.sellCount}</td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {recent.length > 0 && (
        <>
          <h4 style={subHead}>최근 거래</h4>
          <Table headers={["날짜", "구분", "종목", "메모"]}>
            {recent.map((t, i) => {
              const tone: "success" | "destructive" | "info" | "muted" =
                t.action === "buy" ? "info"
                  : t.action === "sell" ? "success"
                  : t.action === "dividend" ? "muted"
                  : "muted";
              return (
                <tr key={`${t.date}-${t.symbol}-${i}`} style={{ borderBottom: "1px solid rgb(var(--border))" }}>
                  <td style={{ ...tdLeft, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{t.date}</td>
                  <td style={tdLeft}><Badge tone={tone}>{t.action}</Badge></td>
                  <td style={tdLeft}><code style={{ fontSize: 11 }}>{t.symbol}</code></td>
                  <td style={{ ...tdLeft, fontSize: 11, color: "rgb(var(--muted-foreground))" }}>{t.notes ?? ""}</td>
                </tr>
              );
            })}
          </Table>
        </>
      )}
    </Section>
  );
}

// ─ AM — Watchlist table ──────────────────────────────────────────────────
// Renders positions/watchlist.csv. Separate section so watchlist entries
// don't blend in with held positions (different decision frame: 'when
// should I open?' vs 'when should I adjust?').
// AQ — when trigger_price set and live quote available, highlight the row
// when current is at-or-below trigger ("buy zone"). This was the whole
// point of having a trigger column — actual alerting.
export function WatchlistTable({
  rows,
  liveQuotes,
  onRowClick,
}: {
  rows: Array<{ symbol: string; name: string; asset_class: string; sector: string; currency: string; trigger_price?: number; thesis_id?: string; notes?: string; quote_symbol?: string }>;
  liveQuotes?: Record<string, LiveQuote>;
  onRowClick?: (symbol: string) => void;
}) {
  if (rows.length === 0) return null;
  const triggered = rows.filter((r) => {
    if (!r.trigger_price || !liveQuotes) return false;
    const key = String(r.quote_symbol || r.symbol || "").toUpperCase();
    const q = liveQuotes[key];
    return q && q.price > 0 && q.price <= r.trigger_price;
  });
  return (
    <Section title={`Watchlist (${rows.length})${triggered.length > 0 ? ` · 🔔 ${triggered.length}개 트리거` : ""}`} icon="👀">
      <Table headers={["종목", "자산군", "통화", "현재가", "trigger", "위치", "메모"]}>
        {rows.map((r) => {
          const key = String(r.quote_symbol || r.symbol || "").toUpperCase();
          const q = liveQuotes?.[key];
          const cur = q?.price;
          const trig = r.trigger_price;
          const hit = trig != null && cur != null && cur > 0 && cur <= trig;
          const diffPct = (trig != null && cur != null && trig > 0)
            ? ((cur - trig) / trig) * 100
            : null;
          return (
            <tr
              key={r.symbol}
              style={{
                borderBottom: "1px solid rgb(var(--border))",
                cursor: onRowClick ? "pointer" : "default",
                background: hit ? "rgba(34, 197, 94, 0.06)" : "transparent",
              }}
              onClick={onRowClick ? () => onRowClick(r.symbol) : undefined}
            >
              <td style={tdLeft}>
                <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                  <strong>{r.name}{hit && <span style={{ marginLeft: 4 }}><Badge tone="success">트리거 도달</Badge></span>}</strong>
                  <span style={{ fontSize: 10, color: "rgb(var(--muted-foreground))", fontFamily: "ui-monospace, monospace" }}>{r.symbol}</span>
                </div>
              </td>
              <td style={tdLeft}>{r.asset_class}</td>
              <td style={tdLeft}>{r.currency}</td>
              <td style={tdRight}>{cur != null ? fmtNum(cur) : <span style={mutedDot}>—</span>}</td>
              <td style={tdRight}>{trig != null ? fmtNum(trig) : <span style={mutedDot}>—</span>}</td>
              <td style={{ ...tdRight, color: hit ? "rgb(var(--success))" : diffPct != null && diffPct < 5 ? "rgb(var(--warning, var(--muted-foreground)))" : "rgb(var(--muted-foreground))" }}>
                {diffPct != null ? `${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(1)}%` : "—"}
              </td>
              <td style={{ ...tdLeft, fontSize: 11, color: "rgb(var(--muted-foreground))" }}>{r.notes ?? ""}</td>
            </tr>
          );
        })}
      </Table>
    </Section>
  );
}

// ─ AM/AO — Base currency selector ─────────────────────────────────────────
// Lets the user pick the reporting unit on the fly. AO: options come from
// the currencies actually present in the data (positions/cash/assets) —
// no point offering JPY if there's nothing JPY-denominated. fxMap
// re-resolves on change and every fmtMoney() call re-renders accordingly.
export function BaseCurrencySelector({
  base, onChange, options, onRefresh,
}: {
  base: string;
  onChange: (cur: string) => void;
  /** Currencies present in the user's data — drives the dropdown.
   *  Empty / undefined → falls back to [base] only. */
  options?: string[];
  /** AO — refresh button next to the dropdown re-fetches live FX. */
  onRefresh?: () => void;
}) {
  // Always include the current base, dedup, sort. If nothing else is in
  // data, the dropdown is single-entry (still useful as a label).
  const list = Array.from(new Set([base, ...(options ?? [])])).filter(Boolean).sort();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
      <span style={{ color: "rgb(var(--muted-foreground))" }}>기준 통화</span>
      <select
        value={base}
        onChange={(e) => onChange(e.target.value)}
        style={{
          fontSize: 12,
          padding: "3px 6px",
          background: "rgb(var(--background))",
          color: "rgb(var(--foreground))",
          border: "1px solid rgb(var(--border))",
          borderRadius: 4,
        }}
      >
        {list.map((c) => (<option key={c} value={c}>{c}</option>))}
      </select>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          title="실시간 환율 + 시세 재조회"
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 4,
            border: "1px solid rgb(var(--border))",
            background: "rgb(var(--surface-2))",
            color: "rgb(var(--foreground))",
            cursor: "pointer",
          }}
        >
          🔄 FX
        </button>
      )}
    </div>
  );
}

// ─ AR — Attribution section ──────────────────────────────────────────────
// Per-position + per-sector contribution to total return (in pp).
// "Which positions built or destroyed alpha this year." Self-review:
// without this a PM can't answer "왜 이번 분기 outperform 했나".
export function AttributionSection({ derived, isMobile }: { derived: Derived; isMobile?: boolean }) {
  const top = derived.contributions.slice(0, 10);
  if (top.length === 0) return null;
  const totalReturnPp = derived.contributions.reduce((s, c) => s + c.contributionPp, 0);
  // Chart: contribution per position (top 10 abs).
  const chartData = top.map((c) => ({ label: c.symbol, value: Number(c.contributionPp.toFixed(2)) }));
  const sectorChartData = derived.contributionsBySector.slice(0, 8).map((s) => ({
    label: s.sector,
    value: Number(s.contributionPp.toFixed(2)),
  }));
  const chartW = isMobile ? Math.min(window.innerWidth - 48, 600) : 540;
  return (
    <Section title="수익 기여도 (alpha 분해)" icon="🎯">
      <div style={{ fontSize: 11, color: "rgb(var(--muted-foreground))", marginBottom: 8 }}>
        총합 가중 수익 <strong style={{ color: totalReturnPp >= 0 ? "rgb(var(--success))" : "rgb(var(--destructive))" }}>{totalReturnPp >= 0 ? "+" : ""}{totalReturnPp.toFixed(2)}pp</strong>
        {" · "} 종목별 기여도 = 비중 × 수익률
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${chartW}px, 1fr))`, gap: 12, marginBottom: 12 }}>
        <Chart title="종목별 기여 (top 10, pp)">
          <BarChart data={chartData} title="" width={chartW} height={200} />
        </Chart>
        <Chart title="섹터별 기여 (pp)">
          <BarChart data={sectorChartData} title="" width={chartW} height={200} />
        </Chart>
      </div>
      <Table headers={["종목", "섹터", "비중", "수익률", "기여 (pp)"]}>
        {top.map((c) => (
          <tr key={c.symbol} style={{ borderBottom: "1px solid rgb(var(--border))" }}>
            <td style={tdLeft}>
              <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                <strong>{c.name}</strong>
                <span style={{ fontSize: 10, color: "rgb(var(--muted-foreground))", fontFamily: "ui-monospace, monospace" }}>{c.symbol}</span>
              </div>
            </td>
            <td style={tdLeft}>{c.sector}</td>
            <td style={tdRight}>{c.weightPct.toFixed(1)}%</td>
            <td style={{ ...tdRight, color: c.returnPct >= 0 ? "rgb(var(--success))" : "rgb(var(--destructive))" }}>
              {fmtPct(c.returnPct)}
            </td>
            <td style={{ ...tdRight, color: c.contributionPp >= 0 ? "rgb(var(--success))" : "rgb(var(--destructive))", fontWeight: 600 }}>
              {c.contributionPp >= 0 ? "+" : ""}{c.contributionPp.toFixed(2)}pp
            </td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

// ─ AR — Tax YTD section ──────────────────────────────────────────────────
// Per-tax-regime accumulated realized YTD with annual exemption + rate.
// BE €10k cap, KR ₩2.5M cap, Reynders 30% are the live cases for the
// multi-jurisdictional reference workspace.
export function TaxYTDSection({ derived }: { derived: Derived }) {
  if (derived.taxBuckets.length === 0) return null;
  return (
    <Section title="세금 YTD (양도세 · 배당)" icon="🏛️">
      <div style={{ fontSize: 11, color: "rgb(var(--muted-foreground))", marginBottom: 10 }}>
        ⚠️ 추정치. tax_regime 컬럼 기반. 회계사 확인 권장.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
        {derived.taxBuckets.map((t) => {
          const overExemption = t.exemption != null ? Math.max(0, t.realizedYTD - t.exemption) : 0;
          const taxOwed = (t.taxRate != null) ? overExemption * t.taxRate : 0;
          const usagePct = t.exemption != null && t.exemption > 0
            ? Math.min(100, (t.realizedYTD / t.exemption) * 100)
            : 0;
          const remaining = t.exemption != null ? Math.max(0, t.exemption - t.realizedYTD) : 0;
          return (
            <div key={t.regime} style={{ border: "1px solid rgb(var(--border))", borderRadius: 8, padding: 10, background: "rgb(var(--card))" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <strong style={{ fontSize: 12 }}>{t.label}</strong>
                <code style={{ fontSize: 10, color: "rgb(var(--muted-foreground))" }}>{t.regime}</code>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                {fmtMoney(t.realizedYTD, t.realizedCurrency)}
                <span style={{ fontSize: 11, color: "rgb(var(--muted-foreground))", fontWeight: 400, marginLeft: 6 }}>실현 YTD</span>
              </div>
              {t.dividendsYTD > 0 && (
                <div style={{ fontSize: 11, color: "rgb(var(--muted-foreground))", marginBottom: 4 }}>
                  배당 YTD: {fmtMoney(t.dividendsYTD, t.realizedCurrency)}
                </div>
              )}
              {t.exemption != null && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ height: 6, background: "rgb(var(--surface-2))", borderRadius: 3, overflow: "hidden", marginBottom: 4 }}>
                    <div style={{
                      width: `${usagePct}%`, height: "100%",
                      background: usagePct >= 100 ? "rgb(var(--destructive))" : usagePct > 80 ? "rgb(var(--warning, var(--accent)))" : "rgb(var(--success))",
                    }} />
                  </div>
                  <div style={{ fontSize: 11, color: "rgb(var(--muted-foreground))" }}>
                    공제 {fmtMoney(t.exemption, t.realizedCurrency)} · 잔여 {fmtMoney(remaining, t.realizedCurrency)}
                    {t.taxRate != null && taxOwed > 0 && (
                      <span style={{ color: "rgb(var(--destructive))", fontWeight: 500 }}>
                        {" · "} 예상 세액 {fmtMoney(taxOwed, t.realizedCurrency)} ({(t.taxRate * 100).toFixed(0)}%)
                      </span>
                    )}
                  </div>
                </div>
              )}
              {t.taxRate != null && t.exemption == null && t.realizedYTD > 0 && (
                <div style={{ fontSize: 11, color: "rgb(var(--destructive))", marginTop: 4 }}>
                  예상 세액 {fmtMoney(t.realizedYTD * t.taxRate, t.realizedCurrency)} ({(t.taxRate * 100).toFixed(0)}%)
                </div>
              )}
              <div style={{ fontSize: 10, color: "rgb(var(--muted-foreground))", marginTop: 6 }}>
                {t.positions}개 종목 · {t.notes ?? ""}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ─ AR — Event calendar ───────────────────────────────────────────────────
// Earnings + ex-div timeline. Sorted by nearest upcoming event date.
// PM checks this every morning before market open.
export function EventCalendar({
  positions, calendars,
}: {
  positions: RawPosition[];
  calendars: Record<string, QuoteCalendar>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  // Build event list: per position, the earlier of earnings vs ex-div if both
  // exist and are upcoming. Group by date for the timeline view.
  const events: Array<{ date: string; type: "earnings" | "ex-div"; symbol: string; name: string; calendar: QuoteCalendar }> = [];
  for (const p of positions) {
    const key = String(p.quote_symbol || p.symbol || "").toUpperCase();
    const cal = calendars[key];
    if (!cal) continue;
    if (cal.earningsDate && cal.earningsDate >= today) {
      events.push({ date: cal.earningsDate, type: "earnings", symbol: p.symbol, name: p.name || p.symbol, calendar: cal });
    }
    if (cal.exDividendDate && cal.exDividendDate >= today) {
      events.push({ date: cal.exDividendDate, type: "ex-div", symbol: p.symbol, name: p.name || p.symbol, calendar: cal });
    }
  }
  events.sort((a, b) => (a.date < b.date ? -1 : 1));
  const upcoming = events.filter((e) => daysUntil(e.date) <= 60).slice(0, 12);
  if (upcoming.length === 0) return null;
  return (
    <Section title={`다가올 이벤트 (60일 이내, ${upcoming.length}건)`} icon="📅">
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {upcoming.map((e, i) => {
          const d = daysUntil(e.date);
          const tone = d <= 3 ? "destructive" : d <= 7 ? "warning" : d <= 21 ? "info" : "muted";
          const cur = e.calendar.dividendRate != null && e.calendar.dividendYield != null
            ? ` · ${fmtNum(e.calendar.dividendRate)} / ${(e.calendar.dividendYield * 100).toFixed(2)}%`
            : "";
          return (
            <div key={`${e.symbol}-${e.type}-${e.date}-${i}`} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "6px 10px",
              borderLeft: `3px solid ${tone === "destructive" ? "rgb(var(--destructive))" : tone === "warning" ? "rgb(var(--accent))" : "rgb(var(--border))"}`,
              background: d <= 7 ? "rgba(var(--accent-rgb, 99 102 241), 0.04)" : "transparent",
            }}>
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "rgb(var(--muted-foreground))", minWidth: 78 }}>
                {e.date}
              </span>
              <Badge tone={tone as "destructive" | "warning" | "info" | "muted"}>D-{d}</Badge>
              <span style={{ fontSize: 11, color: "rgb(var(--muted-foreground))", minWidth: 60 }}>
                {e.type === "earnings" ? "📊 실적" : "💵 ex-div"}
              </span>
              <strong style={{ fontSize: 12 }}>{e.name}</strong>
              <code style={{ fontSize: 10, color: "rgb(var(--muted-foreground))" }}>{e.symbol}</code>
              {e.type === "ex-div" && <span style={{ fontSize: 10, color: "rgb(var(--muted-foreground))" }}>{cur}</span>}
              {e.type === "earnings" && e.calendar.earningsType === "estimate" && <span style={{ fontSize: 10, color: "rgb(var(--muted-foreground))" }}>est.</span>}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ─ AR — Rebalance simulator ──────────────────────────────────────────────
// User sets target weight % per position; we compute the required trade
// in shares + base-currency. Realized P&L estimate from FIFO would need
// the full transaction log per position — current scope just shows the
// delta. PM checks "if I trim SOXX 12% → 8%, what's the trade?".
export function RebalanceSimulator({
  positions, fxMap, base, derived, buckets,
}: {
  positions: RawPosition[];
  fxMap: Record<string, number>;
  base: string;
  derived: Derived;
  buckets: BucketTarget[];
}) {
  const [open, setOpen] = useState(false);
  // targetMap keyed by symbol → user-input target weight %. Default: current.
  const [targetMap, setTargetMap] = useState<Record<string, number>>({});

  const totalInvested = positions.reduce((s, p) => s + toBase(p.market_value, p.currency, fxMap), 0);
  if (totalInvested <= 0) return null;

  // Top 10 positions by base-value — keep the simulator focused.
  const top = useMemo(() => positions
    .map((p) => {
      const baseValue = toBase(p.market_value, p.currency, fxMap);
      return { p, baseValue, currentWeight: (baseValue / totalInvested) * 100 };
    })
    .filter((x) => x.baseValue > 0)
    .sort((a, b) => b.baseValue - a.baseValue)
    .slice(0, 10), [positions, fxMap, totalInvested]);

  return (
    <Section title="리밸런스 모의" icon="⚖️">
      <div style={{ marginBottom: 8 }}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          style={{
            fontSize: 12, padding: "4px 12px", borderRadius: 6,
            background: open ? "rgb(var(--accent))" : "rgb(var(--surface-2))",
            color: open ? "rgb(var(--accent-foreground))" : "rgb(var(--foreground))",
            border: "1px solid rgb(var(--border))", cursor: "pointer",
          }}
        >
          {open ? "닫기" : "열기 — top 10 종목의 목표 비중 입력"}
        </button>
      </div>
      {open && (
        <>
          <Table headers={["종목", "현재 비중", "목표 비중 (%)", "비중 변화", `필요 거래 (${base})`, "방향"]}>
            {top.map(({ p, currentWeight }) => {
              const sym = p.symbol;
              const target = targetMap[sym] ?? currentWeight;
              const diff = target - currentWeight;
              const tradeBase = (diff / 100) * totalInvested;
              const action = tradeBase > 0 ? "매수" : tradeBase < 0 ? "매도" : "유지";
              const tone = action === "매수" ? "info" : action === "매도" ? "destructive" : "muted";
              return (
                <tr key={sym} style={{ borderBottom: "1px solid rgb(var(--border))" }}>
                  <td style={tdLeft}>
                    <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                      <strong>{p.name || p.symbol}</strong>
                      <span style={{ fontSize: 10, color: "rgb(var(--muted-foreground))", fontFamily: "ui-monospace, monospace" }}>{p.symbol}</span>
                    </div>
                  </td>
                  <td style={tdRight}>{currentWeight.toFixed(1)}%</td>
                  <td style={tdRight}>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={target.toFixed(1)}
                      onChange={(e) => setTargetMap({ ...targetMap, [sym]: parseFloat(e.target.value) || 0 })}
                      style={{
                        width: 60, padding: "2px 4px", fontSize: 11,
                        textAlign: "right",
                        background: "rgb(var(--background))", color: "rgb(var(--foreground))",
                        border: "1px solid rgb(var(--border))", borderRadius: 4,
                      }}
                    />
                  </td>
                  <td style={{ ...tdRight, color: diff > 0 ? "rgb(var(--success))" : diff < 0 ? "rgb(var(--destructive))" : "rgb(var(--muted-foreground))" }}>
                    {diff >= 0 ? "+" : ""}{diff.toFixed(1)}pp
                  </td>
                  <td style={tdRight}>
                    {Math.abs(tradeBase) > 0 ? fmtMoney(Math.abs(tradeBase), base) : <span style={mutedDot}>—</span>}
                  </td>
                  <td style={tdLeft}><Badge tone={tone as "info" | "destructive" | "muted"}>{action}</Badge></td>
                </tr>
              );
            })}
          </Table>
          {(() => {
            const totals = top.reduce((s, { p, currentWeight }) => {
              const target = targetMap[p.symbol] ?? currentWeight;
              const tradeBase = ((target - currentWeight) / 100) * totalInvested;
              if (tradeBase > 0) s.buy += tradeBase;
              else s.sell += -tradeBase;
              return s;
            }, { buy: 0, sell: 0 });
            const net = totals.sell - totals.buy;
            if (totals.buy + totals.sell === 0) return null;
            return (
              <div style={{ marginTop: 10, padding: 10, background: "rgb(var(--surface-2))", borderRadius: 6, fontSize: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
                <span>총 매수: <strong style={{ color: "rgb(var(--success))" }}>{fmtMoney(totals.buy, base)}</strong></span>
                <span>총 매도: <strong style={{ color: "rgb(var(--destructive))" }}>{fmtMoney(totals.sell, base)}</strong></span>
                <span>순 현금 변동: <strong style={{ color: net >= 0 ? "rgb(var(--success))" : "rgb(var(--destructive))" }}>{net >= 0 ? "+" : ""}{fmtMoney(net, base)}</strong></span>
                <button
                  type="button"
                  onClick={() => setTargetMap({})}
                  style={{
                    fontSize: 11, padding: "2px 8px", borderRadius: 4,
                    background: "transparent", color: "rgb(var(--muted-foreground))",
                    border: "1px solid rgb(var(--border))", cursor: "pointer",
                  }}
                >
                  초기화
                </button>
              </div>
            );
          })()}
          {buckets.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 11, color: "rgb(var(--muted-foreground))" }}>
              💡 5-bucket 목표는 targets/buckets-2026.yaml 에서. 종목별 상세는 위 표.
            </div>
          )}
        </>
      )}
    </Section>
  );
}
