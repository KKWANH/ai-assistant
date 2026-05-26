/**
 * Page-level sections — one component per scroll section of the Portfolio
 * v2 dashboard. Each section is dumb: receives data + callbacks via props,
 * delegates rendering to primitives.tsx.
 *
 * Order (vertical scroll on the page):
 *   ActionStrip → NetWorthCard → AllocationGrid → AccountsTable →
 *   PositionsTable → CashAndManualAssets → RecentAnalysis
 */

import { BarChart, PieChart } from "@ariadne/surface";
import type { Account, RawPosition, CashBucket, ManualAsset, Derived, QuoteFailure, BucketTarget, IndexTrigger } from "./types";
import { fmtMoney, fmtPct, daysBetween, daysUntil, toBase } from "./utils";
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
export function NetWorthCard({ accounts, positions, derived, base }: { accounts: Account[]; positions: RawPosition[]; derived: Derived; base: string }) {
  return (
    <Section title="순자산" icon="📊">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
        <KpiCard label="총 순자산" value={fmtMoney(derived.totalNetWorthBase, base)} muted={base} />
        <KpiCard label="투자 자산" value={fmtMoney(derived.totalInvestedBase, base)} muted={`${(derived.totalInvestedBase / derived.totalNetWorthBase * 100).toFixed(1)}%`} />
        <KpiCard label="현금 합계" value={fmtMoney(derived.totalCashBase, base)} muted={`${(derived.totalCashBase / derived.totalNetWorthBase * 100).toFixed(1)}%`} />
        <KpiCard label="유휴 자금" value={fmtMoney(derived.totalIdleBase, base)} muted={`${derived.totalIdleBase > 0 ? (derived.totalIdleBase / derived.totalCashBase * 100).toFixed(0) : 0}% / cash`} />
        <KpiCard label="계좌 수" value={String(accounts.length)} muted={`${positions.length} 포지션`} />
      </div>
    </Section>
  );
}

// ─ 3 ─ Allocation grid ───────────────────────────────────────────────────
export function AllocationGrid({ derived }: { derived: Derived }) {
  return (
    <Section title="자산 배분" icon="🥧">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
        <Chart title="자산군">
          <PieChart data={derived.byAssetClass} title="" width={340} height={220} />
        </Chart>
        <Chart title="통화 노출">
          <PieChart data={derived.byCurrency} title="" width={340} height={220} />
        </Chart>
        <Chart title={`섹터 (top ${derived.bySector.length})`}>
          <BarChart data={derived.bySector} title="" width={340} height={220} />
        </Chart>
        <Chart title="지역">
          <PieChart data={derived.byRegion} title="" width={340} height={220} />
        </Chart>
      </div>
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
export interface PositionsTableProps {
  accounts: Account[];
  positions: RawPosition[];
  visiblePositions: RawPosition[];
  fxMap: Record<string, number>;
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
  sortKey: "market_value" | "return_pct" | "symbol" | "account_id";
  sortDir: "asc" | "desc";
  flipSort: (k: PositionsTableProps["sortKey"]) => void;
}

export function PositionsTable(p: PositionsTableProps) {
  const accountLabel = (id: string): string => p.accounts.find((a) => a.id === id)?.label ?? id;
  return (
    <Section title="보유 종목" icon="📈">
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input value={p.search} onChange={(e) => p.setSearch(e.target.value)} placeholder="symbol or name search…" style={inputStyle} />
        <select value={p.filterAccount} onChange={(e) => p.setFilterAccount(e.target.value)} style={inputStyle}>
          <option value="">모든 계좌</option>
          {p.accounts.map((a) => (<option key={a.id} value={a.id}>{a.label}</option>))}
        </select>
        <select value={p.filterAssetClass} onChange={(e) => p.setFilterAssetClass(e.target.value)} style={inputStyle}>
          <option value="">모든 자산군</option>
          {Array.from(new Set(p.positions.map((x) => x.asset_class))).map((c) => (<option key={c} value={c}>{c}</option>))}
        </select>
        <span style={{ alignSelf: "center", color: "rgb(var(--muted-foreground))", fontSize: 12 }}>
          {p.visiblePositions.length} / {p.positions.length}
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <Table headers={[
          <SortHead key="symbol" label="종목" onClick={() => p.flipSort("symbol")} active={p.sortKey === "symbol"} dir={p.sortDir} />,
          "이름",
          <SortHead key="account" label="계좌" onClick={() => p.flipSort("account_id")} active={p.sortKey === "account_id"} dir={p.sortDir} />,
          "자산군", "통화", "수량", "매수가", "현재가",
          <SortHead key="mkt" label="평가금액" onClick={() => p.flipSort("market_value")} active={p.sortKey === "market_value"} dir={p.sortDir} />,
          <SortHead key="ret" label="수익률" onClick={() => p.flipSort("return_pct")} active={p.sortKey === "return_pct"} dir={p.sortDir} />,
          "목표가", "thesis", "review",
        ]}>
          {p.visiblePositions.map((pos) => {
            const stale = pos.last_reviewed ? daysBetween(pos.last_reviewed) > 90 : false;
            const noThesis = !pos.thesis_id;
            const qs = (pos.quote_symbol ?? pos.symbol).toUpperCase();
            const quoteFail = p.quoteFailures[qs];
            return (
              <tr key={`${pos.account_id}-${pos.symbol}`} style={{ borderBottom: "1px solid rgb(var(--border))" }}>
                <td style={tdLeft}>
                  <strong>{pos.symbol}</strong>
                  {quoteFail && (
                    <span title={`quote failed: ${quoteFail.reason}`} style={{ marginLeft: 4 }}>
                      <Badge tone="warning">no quote</Badge>
                    </span>
                  )}
                </td>
                <td style={{ ...tdLeft, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={pos.name}>{pos.name}</td>
                <td style={tdLeft}>{accountLabel(pos.account_id)}</td>
                <td style={tdLeft}>{pos.asset_class}</td>
                <td style={tdLeft}>{pos.currency}</td>
                <td style={tdRight}>{pos.shares}</td>
                <td style={tdRight}>{pos.buy_price.toLocaleString()}</td>
                <td style={tdRight}>{pos.current_price.toLocaleString()}</td>
                <td style={tdRight}><strong>{fmtMoney(pos.market_value, pos.currency)}</strong></td>
                <td style={{ ...tdRight, color: pos.return_pct >= 0 ? "rgb(var(--success))" : "rgb(var(--destructive))" }}>{fmtPct(pos.return_pct)}</td>
                <td style={tdRight}>{pos.target_price ? pos.target_price.toLocaleString() : <span style={mutedDot}>—</span>}</td>
                <td style={tdLeft}>{noThesis ? <Badge tone="muted">미작성</Badge> : <code style={{ fontSize: 10 }}>{pos.thesis_id}</code>}</td>
                <td style={tdLeft}>{pos.last_reviewed ? (stale ? <Badge tone="warning">{pos.last_reviewed}</Badge> : <span style={{ color: "rgb(var(--muted-foreground))" }}>{pos.last_reviewed}</span>) : <Badge tone="muted">—</Badge>}</td>
              </tr>
            );
          })}
        </Table>
      </div>
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
