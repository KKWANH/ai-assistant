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

export const HOLDINGS_CSV = `symbol,name,asset_type,sector,currency,shares,buy_price,current_price,target_price,quote_symbol,headline
AAPL,Apple Inc.,주식,기술,USD,40,271.00,309.00,345.00,AAPL,"서비스 매출이 사상 최고치를 기록했고, 새 제품 주기를 앞두고 실적 전망이 상향됐습니다."
MSFT,Microsoft Corp.,주식,기술,USD,25,384.00,419.00,470.00,MSFT,"클라우드와 AI 수주가 견조하며, 마진 가이던스가 재확인됐습니다."
NVDA,NVIDIA Corp.,주식,기술,USD,30,176.00,215.00,250.00,NVDA,"데이터센터 수요가 여전히 공급을 앞서며, 차세대 제품이 양산에 들어가고 있습니다."
VOO,Vanguard S&P 500 ETF,ETF,분산투자,USD,30,617.00,686.00,740.00,VOO,"S&P 500 전체를 추종하는 광범위한 펀드로, 운용 보수가 매우 낮습니다."
GLD,SPDR Gold Shares,원자재,원자재,USD,25,350.00,414.00,450.00,GLD,"중앙은행이 금 보유를 계속 늘리면서 금값이 사상 최고치 부근입니다."
BTC,Bitcoin,암호화폐,디지털 자산,USD,0.4,71500.00,76000.00,88000.00,BTC-USD,"반감기 이후 비트코인이 횡보 중이며, ETF 자금 유입이 주요 변수입니다."
ASML,ASML Holding,주식,기술,EUR,10,1342.00,1409.00,1600.00,ASML.AS,"리소그래피 장비 수주가 회복 중이며, 수출 규제 뉴스가 관전 포인트입니다."
SAP,SAP SE,주식,기술,EUR,20,145.00,152.00,170.00,SAP.DE,"클라우드 수주 잔고가 계속 쌓이고, 영업이익률 추세가 개선되고 있습니다."
MC,LVMH,주식,임의소비재,EUR,5,520.00,473.00,540.00,MC.PA,"주요 시장의 명품 수요가 부진해 단기 전망이 하향 조정됐습니다."
005930,Samsung Electronics,주식,기술,KRW,200,261000,292500,330000,005930.KS,"메모리 가격이 반등하고 있으며, HBM 생산능력이 핵심 변수입니다."
069500,KODEX 200 ETF,ETF,분산투자,KRW,150,114200,123350,138000,069500.KS,"코스피200 펀드로, 한국 대형주에 폭넓게 분산 투자합니다."
035420,NAVER Corp.,주식,커뮤니케이션,KRW,50,216000,203000,235000,035420.KS,"검색 광고 성장세가 둔화 중이며, 시장은 AI 제품 로드맵을 기다리고 있습니다."
`;

export const FX_RATES_CSV = `currency,name,rate,buy_rate
USD,US Dollar,1.0000,1.0000
EUR,Euro,1.1600,1.1000
KRW,Korean Won,0.000659,0.000690
`;

export const HISTORY_CSV = `date,value,fx_effect
2025-06,151200,120
2025-07,153800,-40
2025-08,150400,-260
2025-09,156900,-520
2025-10,159300,-710
2025-11,157600,-980
2025-12,162400,-1180
2026-01,165100,-1360
2026-02,161900,-1520
2026-03,166800,-1450
2026-04,169200,-1510
2026-05,170600,-1531
`;

/**
 * Seed actions for the portfolio starter. Each one is a block-pipeline
 * the user can fire from the 'Create & Run' tab. The macro_brief action
 * is intentionally heavy — it reads holdings, pulls a fresh web slice,
 * then asks the model for a structured monthly write-up. A scheduled
 * trigger for this will arrive in a follow-up batch; today it's manual.
 */
export const ACTIONS_YAML = `# Portfolio starter — seed actions for the 'Create & Run' tab.
# Edit names / prompts / blocks freely; the file lives at .ariadne/actions.yaml.

actions:
  - id: monthly_macro_brief
    name: 월간 거시 분석 브리프
    description: 시장 거시 데이터와 보유 종목 노출도를 종합해 월간 브리프를 한국어로 작성합니다.
    category: finance
    blocks:
      - id: read_holdings
        type: read_file
        config:
          path: holdings.csv
      - id: macro_news
        type: web_analysis
        config:
          query: "this month macroeconomic news Federal Reserve rate decision inflation US Europe Korea sector rotation"
      - id: synthesis
        type: ask_ai
        config:
          prompt: |
            아래는 두 가지 입력입니다 — 내 보유 종목 (holdings.csv) 과 이번 달 거시 뉴스 요약입니다.
            이것을 바탕으로 4개 섹션의 월간 거시 분석 브리프를 한국어로 작성하세요. 마크다운 헤더와 짧은 문단으로.

            1) 이번 달 시장의 핵심 거시 이벤트 (Fed·금리·인플레이션·환율·주요 지정학적 뉴스)
            2) 내 보유 포트폴리오의 섹터·통화 노출도 분석 (어떤 거시 변수에 가장 민감한지)
            3) 다음 1–3개월 동안 주의해야 할 리스크 항목 3개
            4) 보유 종목 단위로 짧은 액션 권고 (보유 유지 / 비중 조정 / 추가 매수 검토 / 관망 등 — 사유 1줄과 함께)

            중요: 단정적인 매수·매도 추천이 아니라 "고려할 수 있는 시나리오" 어조로 작성. 인용은 출처 번호 [1], [2] 형태로 본문에 자연스럽게 섞으세요.

  - id: rebalance_check
    name: 리밸런싱 점검
    description: 현재 자산군 배분이 목표 배분에서 얼마나 벗어났는지 분석합니다.
    category: finance
    blocks:
      - id: read_holdings
        type: read_file
        config:
          path: holdings.csv
      - id: analysis
        type: ask_ai
        config:
          prompt: |
            holdings.csv를 보고 현재 자산군별 비중 (주식 / ETF / 원자재 / 암호화폐) 을 계산하고,
            보편적으로 권장되는 분산 (예: 주식 60% / ETF 25% / 원자재 10% / 암호화폐 5%) 과 비교해
            어느 자산군이 과도하거나 부족한지 표로 보여 주세요. 마지막에 리밸런싱 액션 한 줄을 제안하세요.
`;

export const SURFACE_TSX = `/**
 * Portfolio Analysis — custom Ariadne surface (multi-currency analyst dashboard).
 *
 * Reads holdings.csv, fx_rates.csv and history.csv, then renders KPIs, a value
 * trend, currency exposure, allocation, per-position returns and a sortable
 * holdings table. "Refresh prices" re-reads the CSV files; click any holding to
 * open a detailed asset page. Toggle "Currency analysis" to overlay an
 * FX-neutral baseline on the value trend and break out each position's FX effect.
 *
 * Data model
 *   holdings.csv  symbol,name,asset_type,sector,currency,shares,buy_price,
 *                 current_price,target_price,headline
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

import { useState, useEffect, useCallback, useAriadne, LineChart, BarChart, PieChart } from "@ariadne/surface";

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
  targetPrice: number;
  headline: string;
  quoteSymbol: string;
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
      targetPrice: num(r["target_price"]),
      headline: (r["headline"] || "").trim(),
      quoteSymbol: (r["quote_symbol"] || "").trim(),
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

/** An illustrative price path from average cost to the current price.
 *  Deterministic per symbol — it is a demo trend, not real market history. */
function priceTrend(buy: number, current: number, symbol: string, labels: string[]): Point[] {
  const pts = labels.length >= 2 ? labels : ["", "", "", "", "", "", "", ""];
  const n = pts.length;
  let seed = 0;
  for (let i = 0; i < symbol.length; i++) seed += symbol.charCodeAt(i);
  const span = Math.abs(current - buy) || Math.abs(current) * 0.06 || 1;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 1;
    const baseV = buy + (current - buy) * t;
    const wobble = Math.sin((t * 5.4 + seed) * 1.3) * span * 0.22 * (1 - Math.abs(2 * t - 1));
    out.push({ label: pts[i] || "", value: Math.round((baseV + wobble) * 100) / 100 });
  }
  if (n > 0) out[n - 1] = { label: pts[n - 1] || "현재", value: current };
  return out;
}

function AssetDetail(props: {
  holding: Holding;
  holdings: Holding[];
  baseCurrency: string;
  onBack: () => void;
  trendLabels: string[];
}) {
  const h = props.holding;
  const all = props.holdings;
  const base = props.baseCurrency;
  const upsidePct = h.price > 0 ? ((h.targetPrice - h.price) / h.price) * 100 : 0;
  const trend = priceTrend(h.buyPrice, h.price, h.symbol, props.trendLabels);

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
    { label: "포트폴리오", value: Math.round(portReturn * 10) / 10 },
    { label: best ? best.symbol : "최고", value: best ? Math.round(best.plPctBase * 10) / 10 : 0 },
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
        {"←  포트폴리오로 돌아가기"}
      </button>

      {/* Asset header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: "12px", flexWrap: "wrap", marginTop: "14px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>{h.symbol}</h1>
        <span style={{ fontSize: "15px", ...muted }}>{h.name}</span>
      </div>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
        <Pill text={h.assetType} accent />
        <Pill text={h.sector} />
        <Pill text={h.currency + " · " + h.shares.toLocaleString("en-US") + "단위"} />
        <Pill text={"비중 순위 " + rank + " / 전체 " + all.length} />
      </div>

      {/* KPI row */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", margin: "16px 0" }}>
        <Kpi label={"평가 가치 (" + base + ")"} value={money0(h.valueBase, base)} sub={fmt(h.weight, 1) + "% · 포트폴리오 비중"} />
        <Kpi label={"매입 원가 (" + base + ")"} value={money0(h.costBase, base)} />
        <Kpi
          label="총 수익"
          value={signedMoney(h.plBase, base)}
          sub={signedPct(h.plPctBase)}
          color={plColor(h.plBase)}
        />
        <Kpi label="가격 효과" value={signedMoney(h.priceEffect, base)} color={plColor(h.priceEffect)} sub="자산 가격 변동" />
        <Kpi label="환율 효과" value={signedMoney(h.fxEffect, base)} color={plColor(h.fxEffect)} sub="환율 변동" />
      </div>

      {/* Recent price trend + analyst outlook */}
      <div style={{ ...cardStyle, marginBottom: "16px", overflowX: "auto" }}>
        <SectionTitle>최근 가격과 전망</SectionTitle>
        <LineChart data={trend} title={"가격 추이 (" + h.currency + ")"} width={1080} height={220} />
        <p style={{ fontSize: "11px", margin: "2px 0 10px", ...muted }}>
          평균 매입가에서 현재가까지를 보여 주는 예시 경로입니다 — 실제 가격 이력이 있다면 교체하세요.
        </p>
        <StatRow label={"현재가 (" + h.currency + ")"} value={money(h.price, h.currency)} />
        <StatRow label={"애널리스트 목표가 (" + h.currency + ")"} value={money(h.targetPrice, h.currency)} />
        <StatRow label="목표가까지 여력" value={signedPct(upsidePct)} color={plColor(upsidePct)} />
        <div style={{ marginTop: "10px" }}>
          <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "3px", ...muted }}>
            최근 코멘트
          </div>
          <p style={{ fontSize: "13px", margin: 0, lineHeight: 1.5 }}>
            {h.headline || "holdings.csv에 headline 열을 추가하면 여기에 코멘트가 표시됩니다."}
          </p>
        </div>
      </div>

      {/* Detail cards */}
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "16px" }}>
        <div style={{ ...cardStyle, flex: "1 1 320px" }}>
          <SectionTitle>보유 현황</SectionTitle>
          <StatRow label="보유 수량" value={h.shares.toLocaleString("en-US")} />
          <StatRow label={"평균 매입가 (" + h.currency + ")"} value={money(h.buyPrice, h.currency)} />
          <StatRow label={"현재가 (" + h.currency + ")"} value={money(h.price, h.currency)} />
          <StatRow
            label="가격 수익률 (현지 통화)"
            value={signedPct(h.priceReturnPct)}
            color={plColor(h.priceReturnPct)}
          />
          <StatRow label={"매입 원가 (" + h.currency + ")"} value={money0(h.costLocal, h.currency)} />
          <StatRow label={"평가 가치 (" + h.currency + ")"} value={money0(h.valueLocal, h.currency)} />
        </div>

        <div style={{ ...cardStyle, flex: "1 1 320px" }}>
          <SectionTitle>통화 및 환율</SectionTitle>
          <StatRow label="거래 통화" value={h.currency} />
          <StatRow label={"기준 통화"} value={base} />
          <StatRow label={"매입 시 환율"} value={fmt(h.buyRate, h.buyRate < 0.1 ? 6 : 4)} />
          <StatRow label={"현재 환율"} value={fmt(h.rate, h.rate < 0.1 ? 6 : 4)} />
          <StatRow
            label="매입 후 환율 변동"
            value={fxMoved ? signedPct(fxChangePct) : "변동 없음"}
            color={fxMoved ? plColor(fxChangePct) : "rgb(var(--muted-foreground))"}
          />
          <StatRow label={"환율 효과 (" + base + ")"} value={signedMoney(h.fxEffect, base)} color={plColor(h.fxEffect)} />
        </div>
      </div>

      {/* P/L attribution */}
      <div style={{ ...cardStyle, marginBottom: "16px" }}>
        <SectionTitle>수익 분해</SectionTitle>
        <p style={{ fontSize: "12px", margin: "0 0 8px", ...muted }}>
          매입 원가에서 현재 평가 가치까지의 변화입니다 (기준 통화 {base}).
        </p>
        <StatRow label="매입 원가" value={money0(h.costBase, base)} />
        <StatRow label="자산 가격 효과" value={signedMoney(h.priceEffect, base)} color={plColor(h.priceEffect)} />
        <StatRow label="환율 효과" value={signedMoney(h.fxEffect, base)} color={plColor(h.fxEffect)} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", padding: "8px 0 0" }}>
          <span style={{ fontSize: "13px", fontWeight: 700 }}>현재 평가 가치</span>
          <span style={{ fontSize: "13px", fontWeight: 700 }}>{money0(h.valueBase, base)}</span>
        </div>
      </div>

      {/* Comparison */}
      <div style={{ ...cardStyle, overflowX: "auto" }}>
        <BarChart data={compareData} title="수익률 % — 포트폴리오·최고 종목 대비" width={760} height={240} />
      </div>

      <p style={{ marginTop: "16px", fontSize: "12px", ...muted }}>
        <code>holdings.csv</code>와 <code>fx_rates.csv</code>를 수정한 뒤 <strong>빌드</strong>를 누르면 갱신됩니다.
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
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<View>({ page: "overview" });
  const [fxMode, setFxMode] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("valueBase");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [hoverSym, setHoverSym] = useState<string | null>(null);
  const [baseOverride, setBaseOverride] = useState<string | null>(null);
  const [dataMode, setDataMode] = useState<"live" | "sample">("sample");

  // Read every CSV file, then overlay live market data when available. Called
  // once on mount and again by the Refresh button. holdings.csv / fx_rates.csv
  // carry sample values; live quotes and FX rates replace them best-effort.
  const load = useCallback(
    async (isRefresh: boolean) => {
      if (isRefresh) setRefreshing(true);
      try {
        const csv = await ariadne.readCsv("holdings.csv");
        const holdings = parseHoldings(csv.rows);

        let fx: FxRate[] = [];
        try {
          const fxCsv = await ariadne.readCsv("fx_rates.csv");
          fx = parseFx(fxCsv.rows);
        } catch {
          /* fx_rates.csv is optional — without it everything is base currency */
        }
        try {
          const hist = await ariadne.readCsv("history.csv");
          setHistory(parseHistory(hist.rows));
        } catch {
          /* history.csv is optional */
        }

        // Overlay live data. Best-effort: on any failure the CSV values stand,
        // so the dashboard never breaks just because the market feed is down.
        let liveCount = 0;
        try {
          const symbols = holdings.map((h) => h.quoteSymbol || h.symbol);
          const quotes = await ariadne.getQuotes(symbols);
          const quoteMap: Record<string, { price: number; currency: string }> = {};
          for (const q of quotes) quoteMap[q.symbol.toUpperCase()] = q;
          for (const h of holdings) {
            const q = quoteMap[(h.quoteSymbol || h.symbol).toUpperCase()];
            // Skip a quote whose currency disagrees with the holding (bad mapping).
            if (q && q.price > 0 && (!q.currency || q.currency === h.currency)) {
              h.price = q.price;
              liveCount += 1;
            }
          }
        } catch {
          /* keep CSV prices */
        }
        if (fx.length > 0) {
          try {
            let fxBase = "USD";
            for (const f of fx) {
              if (Math.abs(f.rate - 1) < 1e-9) {
                fxBase = f.currency;
                break;
              }
            }
            const rates = await ariadne.getFxRates(fxBase, fx.map((f) => f.currency));
            for (const f of fx) {
              const r = rates[f.currency];
              if (typeof r === "number" && isFinite(r) && r > 0) {
                f.rate = r;
                liveCount += 1;
              }
            }
          } catch {
            /* keep CSV rates */
          }
        }

        setRawHoldings(holdings);
        setFxRates(fx);
        setDataMode(liveCount > 0 ? "live" : "sample");
        setError(null);
        setLastSync(new Date().toLocaleTimeString("en-US", { hour12: false }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [ariadne]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  if (loading) return <Centered text="포트폴리오를 불러오는 중..." />;
  if (error) return <Centered text={"오류: " + error} tone="error" />;
  if (rawHoldings.length === 0) return <Centered text="holdings.csv에 행이 없습니다" />;

  // Resolve currencies and the base (reporting) currency. The base auto-detects
  // as whichever currency has rate 1; the header dropdown can override it.
  const fxMap: Record<string, FxRate> = {};
  for (const f of fxRates) fxMap[f.currency] = f;
  let autoBase = "USD";
  for (const f of fxRates) {
    if (Math.abs(f.rate - 1) < 1e-9) {
      autoBase = f.currency;
      break;
    }
  }
  if (!fxMap[autoBase] && fxRates.length > 0) autoBase = fxRates[0].currency;
  const baseCurrency = baseOverride && fxMap[baseOverride] ? baseOverride : autoBase;
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
          trendLabels={history.map((p) => p.label).slice(-8)}
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

  // Trend series. constFxSeries removes the currency effect (value − cumulative
  // fx_effect) — the FX-neutral baseline the value chart overlays in FX mode.
  const valueSeries: Point[] = history.map((p) => ({ label: p.label, value: p.value }));
  const constFxSeries: Point[] = history.map((p) => ({ label: p.label, value: p.value - p.fxEffect }));

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
    { key: "symbol", label: "종목", align: "left" },
    { key: "assetType", label: "유형", align: "left" },
    { key: "currency", label: "통화", align: "left" },
    { key: null, label: "수량", align: "right" },
    { key: null, label: "가격", align: "right" },
    { key: "valueBase", label: "평가액", align: "right" },
    { key: "weight", label: "비중", align: "right" },
    { key: "plBase", label: "평가손익", align: "right" },
  ];
  if (fxMode) cols.push({ key: "fxEffect", label: "환율 효과", align: "right" });
  cols.push({ key: "plPctBase", label: "수익률", align: "right" });

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

  const refreshBtn = {
    display: "flex",
    alignItems: "center",
    gap: "7px",
    padding: "7px 13px",
    fontSize: "12px",
    fontWeight: 600,
    cursor: refreshing ? "default" : "pointer",
    borderRadius: "8px",
    border: "1px solid rgb(var(--border))",
    background: "transparent",
    color: "rgb(var(--muted-foreground))",
    opacity: refreshing ? 0.55 : 1,
  };

  const baseSelect = {
    padding: "7px 11px",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
    borderRadius: "8px",
    border: "1px solid rgb(var(--border))",
    background: "transparent",
    color: "rgb(var(--muted-foreground))",
    fontFamily: "inherit",
  };

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", padding: "20px 24px", maxWidth: "1180px", margin: "0 auto", color: "rgb(var(--foreground))" }}>
      {/* Header + toolbar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>포트폴리오 분석</h1>
          <p style={{ fontSize: "12px", margin: "4px 0 0", ...muted }}>
            {holdings.length + "개 종목 · " + currencies.length + "개 통화 · 기준 통화 " + baseCurrency +
              (lastSync ? " · " + lastSync + " 기준가" : "")}
            {" · "}
            <span style={{ fontWeight: 600, color: dataMode === "live" ? "rgb(var(--success))" : "rgb(var(--muted-foreground))" }}>
              {dataMode === "live" ? "● 라이브 시세" : "○ 샘플 데이터"}
            </span>
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {fxRates.length > 1 ? (
            <select
              value={baseCurrency}
              onChange={(e) => setBaseOverride(e.target.value)}
              style={baseSelect}
              title="평가 기준 통화"
            >
              {fxRates.map((f) => (
                <option key={f.currency} value={f.currency}>
                  {"기준 통화: " + f.currency}
                </option>
              ))}
            </select>
          ) : null}
          <button onClick={() => void load(true)} disabled={refreshing} style={refreshBtn}>
            {refreshing ? "⟳  새로고침 중…" : "⟳  현재가 새로고침"}
          </button>
          <button onClick={() => setFxMode(!fxMode)} style={fxBtn}>
            {(fxMode ? "◉" : "○") + "  환율 분석"}
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", margin: "16px 0" }}>
        <Kpi label={"평가 가치 (" + baseCurrency + ")"} value={money0(totalValue, baseCurrency)} />
        <Kpi label={"매입 원가 (" + baseCurrency + ")"} value={money0(totalBasis, baseCurrency)} />
        <Kpi
          label="평가 손익"
          value={signedMoney(totalPL, baseCurrency)}
          sub={signedPct(totalPLPct)}
          color={plColor(totalPL)}
        />
        <Kpi
          label="환율 효과"
          value={signedMoney(totalFx, baseCurrency)}
          sub={totalFx >= 0 ? "환율이 가치를 키움" : "환율이 가치를 줄임"}
          color={plColor(totalFx)}
        />
        <Kpi
          label="최고 수익 종목"
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
            <strong>환율 분석이 켜졌습니다.</strong>{" "}
            <span style={muted}>
              {"환율 변동으로 포트폴리오 가치가 " + signedMoney(totalFx, baseCurrency) +
                "만큼 달라졌습니다. 아래 가치 추이에 환율 영향을 제외한 기준선이 겹쳐 표시되어 환율 효과를 " +
                "바로 볼 수 있고, 보유 종목 표에는 종목별 환율 효과가 분리되어 나옵니다."}
            </span>
          </p>
        </div>
      ) : null}

      {/* Portfolio value trend — in currency mode it overlays the FX-neutral baseline */}
      {valueSeries.length > 1 ? (
        <div style={{ ...cardStyle, marginBottom: "16px", overflowX: "auto" }}>
          <LineChart
            data={valueSeries}
            compare={fxMode ? constFxSeries : undefined}
            seriesLabels={["실제 가치", "환율 고정 시"]}
            title={
              fxMode
                ? "포트폴리오 가치 — 실제 vs 환율 변동 제외 (" + baseCurrency + ")"
                : "포트폴리오 가치 (" + baseCurrency + ")"
            }
            width={1090}
            height={260}
          />
          {fxMode ? (
            <p style={{ fontSize: "12px", margin: "8px 4px 2px", lineHeight: 1.5, ...muted }}>
              {"실선은 실제 가치, 점선은 모든 환율이 매입 시점 그대로였다면의 가치입니다. " +
                "두 선이 벌어지는 간격이 포트폴리오 전체에 누적된 환율 효과이며, " +
                "현재까지 " + signedMoney(totalFx, baseCurrency) + "입니다."}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Allocation: asset type + currency */}
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "16px" }}>
        <div style={{ ...cardStyle, flex: "1 1 300px", overflowX: "auto" }}>
          <PieChart data={typeData} title="자산 유형별 배분" width={340} height={270} />
        </div>
        <div style={{ ...cardStyle, flex: "1 1 300px", overflowX: "auto" }}>
          <PieChart data={curData} title="통화별 노출" width={340} height={270} />
        </div>
      </div>

      {/* Return per position */}
      <div style={{ ...cardStyle, marginBottom: "16px", overflowX: "auto" }}>
        <BarChart data={returnData} title="종목별 수익률 %" width={1090} height={260} />
      </div>

      {/* Holdings table */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "8px" }}>
        <SectionTitle>보유 종목</SectionTitle>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <Chip label="전체" active={typeFilter === "all"} onClick={() => setTypeFilter("all")} />
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
        종목을 누르면 상세 페이지가 열리고, <strong>현재가 새로고침</strong>을 누르면 라이브 시세·환율을
        다시 받아옵니다. 시세를 받지 못하면 CSV의 값을 그대로 씁니다.{" "}
        <code>holdings.csv</code>의 <code>quote_symbol</code> 열은 시세 조회용 티커입니다
        (예: 005930 → 005930.KS, BTC → BTC-USD). 열 머리글을 누르면 정렬됩니다.
      </p>
    </div>
  );
}
`;
