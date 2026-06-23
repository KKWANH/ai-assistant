/**
 * 자산 현황 — 통화별(Original) 우선 · 표+차트 · 분석 깊이.
 *
 * 핵심: 평균단가+수량만 저장, 가격·수익률은 store(quotes)에서 계산(API 최신).
 * 읽기: `.ariadne/store/view.json` + value_history.csv + targets/{plan,todos,watchlist}.json + briefs/latest.md
 * 갱신: node .ariadne/jobs/{collect_fx,collect_prices,build_view,snapshot_daily}.mjs
 */
import { useState, useEffect, useMemo, useRef, useAriadne, usePoll, LineChart, BarChart, PieChart } from "@ariadne/surface";

const T = (n: string) => `rgb(var(--${n}))`;
const TA = (n: string, a: number) => `rgb(var(--${n}) / ${a})`;
const SYM: Record<string, string> = { KRW: "₩", USD: "$", EUR: "€" };
const CCYS = ["KRW", "USD", "EUR"];
// 거래소 접미사 제거 → 기본 티커 (프로필·보유 매칭용). SG=슈투트가르트(TR 매칭) 등 포함.
const EXSFX = /\.(KS|KQ|DE|SG|MU|F|DU|BE|HM|HA|L|AS|PA|MI|SW|VI|BR|ST|HE|CO|OL|MC|TO|HK|T|SI|AX|NZ)$/i;
const baseSym = (s: any) => `${s || ""}`.toUpperCase().replace(EXSFX, "");
const IDX = [
  { sym: "^GSPC", name: "S&P500", ccy: "USD" },
  { sym: "^IXIC", name: "나스닥", ccy: "USD" },
  { sym: "^KS11", name: "코스피", ccy: "KRW" },
  { sym: "^STOXX50E", name: "유로스톡스", ccy: "EUR" },
];
const GROUPS = [
  { value: "account", label: "계좌" },
  { value: "sector", label: "섹터" },
  { value: "region", label: "지역" },
  { value: "currency", label: "통화" },
  { value: "class", label: "자산군" },
  { value: "none", label: "전체" },
];
const CUR_META: Record<string, { flag: string; name: string; color: string }> = {
  KRW: { flag: "🇰🇷", name: "원화", color: "accent" },
  USD: { flag: "🇺🇸", name: "달러", color: "success" },
  EUR: { flag: "🇪🇺", name: "유로", color: "info" },
};
const ASSET_KO: Record<string, string> = { etf: "ETF", stock: "주식", commodity: "원자재", fund: "펀드", crypto: "코인" };
const REGION_KO: Record<string, string> = { US: "🇺🇸 미국", KR: "🇰🇷 한국", GLOBAL: "🌐 글로벌", EU: "🇪🇺 유럽", "": "기타" };
// PieChart 내부 PALETTE 순서와 동일 — 범례 색 매칭용
const PIE = ["accent", "info", "warning", "success", "destructive", "ring", "info", "success", "warning", "accent"];
const pal = (i: number) => T(PIE[i % PIE.length]);
// AI·반도체 집중(거시 리스크) 섹터
const AI_SECTORS = new Set(["미국빅테크", "반도체AI", "반도체", "소프트웨어AI"]);

const dec = (c: string) => (c === "KRW" ? 0 : 2);
const money = (n: number, c: string) => (n < 0 ? "-" : "") + (SYM[c] || "") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: dec(c) });
const money0 = (n: number, c: string) => (n < 0 ? "-" : "") + (SYM[c] || "") + Math.round(Math.abs(n)).toLocaleString("en-US");
const signPct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
const retC = (r: number) => (r >= 0 ? T("success") : T("destructive"));

function CountUp({ value, fmt, ms = 750 }: any) {
  const [disp, setDisp] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    const from = ref.current, to = value || 0;
    ref.current = to;
    if (from === to) { setDisp(to); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / ms); const e = 1 - Math.pow(1 - p, 3); setDisp(from + (to - from) * e); if (p < 1) raf = requestAnimationFrame(tick); else setDisp(to); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{fmt(disp)}</>;
}

const AXS_CSS = `
.axs .fin>div>*{animation:axsIn .55s cubic-bezier(.2,.85,.25,1) both}
.axs .fin>div>*:nth-child(1){animation-delay:.02s}
.axs .fin>div>*:nth-child(2){animation-delay:.07s}
.axs .fin>div>*:nth-child(3){animation-delay:.12s}
.axs .fin>div>*:nth-child(4){animation-delay:.17s}
.axs .fin>div>*:nth-child(5){animation-delay:.22s}
.axs .fin>div>*:nth-child(6){animation-delay:.27s}
.axs .fin>div>*:nth-child(n+7){animation-delay:.32s}
@keyframes axsIn{from{opacity:0;transform:translateY(16px) scale(.985)}to{opacity:1;transform:none}}
@keyframes axsPulse{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes axsPop{from{opacity:0;transform:scale(.96) translateY(10px)}to{opacity:1;transform:none}}
.axs .pop{animation:axsPop .32s cubic-bezier(.2,1.3,.4,1)}
.axs .ah{transition:transform .24s cubic-bezier(.2,.85,.25,1),box-shadow .24s ease,border-color .24s ease}
.axs .ah::before{content:"";position:absolute;inset:0;border-radius:18px;background:radial-gradient(240px circle at var(--mx,50%) var(--my,50%),rgb(255 255 255 / .11),transparent 55%);opacity:0;transition:opacity .3s ease;pointer-events:none;z-index:0}
.axs .ah:hover::before{opacity:1}
.axs .ah>*{position:relative;z-index:1}
.axs .ah:hover{transform:translateY(-4px);border-color:rgb(255 255 255 / .24);box-shadow:inset 0 1px 0 rgb(255 255 255 / .24),0 24px 56px rgb(0 0 0 / .62)}
.axs .grad{background:linear-gradient(120deg,rgb(var(--foreground)) 35%,rgb(var(--accent)));-webkit-background-clip:text;background-clip:text;color:transparent}
.axs .live{animation:axsPulse 1.7s ease-in-out infinite}
.axs .wbsheen{animation:axsSheen 5s ease-in-out infinite}
@keyframes axsSheen{0%{transform:translateX(-220px)}55%,100%{transform:translateX(900px)}}
.axs .chev{display:inline-block;transition:transform .22s cubic-bezier(.2,.85,.25,1)}
.axs .gh{transition:background .16s ease}
.axs .gh:hover{background:rgb(255 255 255 / .08)!important}
.axs button{transition:transform .16s cubic-bezier(.2,1.5,.4,1),filter .14s ease,box-shadow .14s ease}
.axs button:hover{filter:brightness(1.17)}
.axs button:active{transform:scale(.9)}
.axs input{transition:border-color .15s ease,box-shadow .15s ease}
.axs input:focus{outline:none;border-color:rgb(var(--accent));box-shadow:0 0 0 3px rgb(var(--accent) / .2)}
.axs tbody tr{transition:background .14s ease}
.axs tbody tr:hover{background:rgb(255 255 255 / .05)}
@media (prefers-reduced-motion:reduce){.axs *{animation-duration:.01ms!important;transition-duration:.01ms!important}}
@keyframes lineIn{from{transform:scaleX(0);opacity:.3}to{transform:scaleX(1);opacity:1}}
@keyframes barGrow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes donutIn{from{opacity:0;transform:rotate(-25deg) scale(.7)}to{opacity:1;transform:none}}
.axs svg polyline:not([opacity]){transform-box:fill-box;transform-origin:left;animation:lineIn .95s cubic-bezier(.2,.85,.25,1) both}
.axs svg rect[opacity]{transform-box:fill-box;transform-origin:bottom;animation:barGrow .85s cubic-bezier(.2,.85,.25,1) both}
.axs .donut{transform-origin:center;animation:donutIn .9s cubic-bezier(.2,.85,.25,1) both}
@keyframes areaIn{from{opacity:0}to{opacity:1}}
.axs .areafill{animation:areaIn 1.2s ease both}
.axs .donut circle{transition:opacity .15s ease}
.axs .donut:hover circle{opacity:.55}
.axs .donut circle:hover{opacity:1}
`;

const card: any = { background: "linear-gradient(180deg, rgb(255 255 255 / 0.1), rgb(255 255 255 / 0.035))", backdropFilter: "blur(26px) saturate(1.7)", WebkitBackdropFilter: "blur(26px) saturate(1.7)", border: "1px solid rgb(255 255 255 / 0.13)", borderRadius: 18, padding: 16, position: "relative", boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.2), 0 12px 40px rgb(0 0 0 / 0.55)" };
const muted: any = { color: T("muted-foreground") };
const td: any = { padding: "7px 9px", textAlign: "right", borderBottom: `1px solid ${TA("border", 0.45)}` };
const thS: any = { padding: "6px 9px", textAlign: "right", fontSize: 11, fontWeight: 600, color: T("muted-foreground"), borderBottom: `1px solid ${T("border")}` };

// top-N 슬라이스로 축약 (나머지 → 기타)
function topSlices(entries: Array<{ label: string; value: number }>, n = 6) {
  const s = [...entries].filter((e) => e.value > 0).sort((a, b) => b.value - a.value);
  if (s.length <= n) return s;
  const head = s.slice(0, n - 1);
  const rest = s.slice(n - 1).reduce((a, b) => a + b.value, 0);
  return [...head, { label: "기타", value: rest }];
}

function Seg({ value, options, onChange, sm }: any) {
  return (
    <div style={{ display: "inline-flex", gap: 2, padding: 3, background: TA("muted", 0.4), borderRadius: 10 }}>
      {options.map((o: any) => {
        const v = o.value ?? o, l = o.label ?? o, on = v === value;
        return <button key={v} onClick={() => onChange(v)} style={{ padding: sm ? "3px 9px" : "5px 13px", fontSize: sm ? 12 : 13, fontWeight: 600, border: "none", borderRadius: 8, cursor: "pointer", background: on ? T("background") : "transparent", color: on ? T("foreground") : T("muted-foreground"), boxShadow: on ? `0 1px 3px ${TA("foreground", 0.1)}` : "none" }}>{l}</button>;
      })}
    </div>
  );
}
function Bar({ pct, color }: any) {
  return (
    <div style={{ position: "relative", minWidth: 50 }}>
      <div style={{ position: "absolute", inset: 0, width: `${Math.min(100, pct)}%`, background: TA(color || "accent", 0.25), borderRadius: 3, transition: "width .6s cubic-bezier(.4,0,.2,1)" }} />
      <span style={{ position: "relative", paddingRight: 4 }}>{pct.toFixed(1)}%</span>
    </div>
  );
}
function Metric({ label, value, sub, tone }: any) {
  return (
    <div className="ah" style={{ ...card, flex: 1, minWidth: 150, padding: 13 }}>
      <div style={{ fontSize: 11, ...muted, textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.15, marginTop: 3, color: tone ? T(tone) : T("foreground") }}>{value}</div>
      {sub != null ? <div style={{ fontSize: 11.5, ...muted, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}
function AreaTrend({ series, base, indexMode, labels }: any) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 880, H = 232, PL = 52, PR = 16, PT = 16, PB = 28;
  const iw = W - PL - PR, ih = H - PT - PB;
  if (!series || series.length < 2) return <div style={{ color: "rgb(var(--muted-foreground))", fontSize: 12, padding: 10 }}>추이 데이터 불러오는 중…</div>;
  const sec = (s: any) => (indexMode ? s.b : s.cost);          // second line: benchmark (index) or principal (money)
  const vals = series.flatMap((s: any) => [s.value, sec(s)]);
  const mn = Math.min(...vals), mx = Math.max(...vals), rng = (mx - mn) || 1;
  const x = (i: number) => PL + (i / (series.length - 1)) * iw;
  const y = (v: number) => PT + ih - ((v - mn) / rng) * ih;
  const valPts = series.map((s: any, i: number) => `${x(i).toFixed(1)},${y(s.value).toFixed(1)}`).join(" ");
  const secPts = series.map((s: any, i: number) => `${x(i).toFixed(1)},${y(sec(s)).toFixed(1)}`).join(" ");
  const area = `M ${x(0).toFixed(1)},${(PT + ih).toFixed(1)} ` + series.map((s: any, i: number) => `L ${x(i).toFixed(1)},${y(s.value).toFixed(1)}`).join(" ") + ` L ${x(series.length - 1).toFixed(1)},${(PT + ih).toFixed(1)} Z`;
  const last = series[series.length - 1];
  const sc = base === "KRW" ? 1e6 : 1e3;
  const yfmt = (v: number) => (indexMode ? v.toFixed(0) : (v / sc).toFixed(0));
  const gain = last.value - last.cost, gpct = last.cost ? (gain / last.cost) * 100 : 0;   // money mode
  const op = indexMode ? last.value - last.b : 0;                                         // index mode 초과(%p)
  const pp = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%p`;
  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H} style={{ display: "block", maxWidth: "100%" }} onMouseMove={(e: any) => { const r = e.currentTarget.getBoundingClientRect(); const px = (e.clientX - r.left) * (W / r.width); const i = Math.round(((px - PL) / iw) * (series.length - 1)); setHi(i >= 0 && i < series.length ? i : null); }} onMouseLeave={() => setHi(null)}>
        <defs><linearGradient id="atg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.38" /><stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0" /></linearGradient></defs>
        {[0, 0.5, 1].map((t) => { const v = mn + t * rng, yp = y(v); return <g key={t}><line x1={PL} y1={yp} x2={W - PR} y2={yp} stroke="rgb(255 255 255 / 0.07)" strokeDasharray="3 3" /><text x={PL - 6} y={yp + 4} textAnchor="end" fontSize={10} fill="rgb(var(--muted-foreground))">{yfmt(v)}</text></g>; })}
        <path d={area} fill="url(#atg)" className="areafill" />
        <polyline points={secPts} fill="none" stroke={indexMode ? "rgb(var(--info))" : "rgb(var(--muted-foreground))"} strokeWidth={indexMode ? 2.3 : 1.5} strokeDasharray={indexMode ? undefined : "5 4"} strokeLinejoin="round" strokeLinecap="round" opacity={indexMode ? 0.95 : 0.65} style={indexMode ? { filter: "drop-shadow(0 0 5px rgb(var(--info) / 0.4))" } : undefined} />
        <polyline points={valPts} fill="none" stroke="rgb(var(--accent))" strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 7px rgb(var(--accent) / 0.55))" }} />
        {[0, Math.floor(series.length / 2), series.length - 1].map((i) => <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="rgb(var(--muted-foreground))">{series[i].label}</text>)}
        {hi != null && series[hi] && (<g><line x1={x(hi)} y1={PT} x2={x(hi)} y2={PT + ih} stroke="rgb(255 255 255 / 0.25)" />{indexMode ? <circle cx={x(hi)} cy={y(series[hi].b)} r={4} fill="rgb(var(--info))" stroke="rgb(var(--background))" strokeWidth={2} /> : null}<circle cx={x(hi)} cy={y(series[hi].value)} r={4.5} fill="rgb(var(--accent))" stroke="rgb(var(--background))" strokeWidth={2} /></g>)}
      </svg>
      <div style={{ fontSize: 11.5, color: "rgb(var(--muted-foreground))", marginTop: 3 }}>
        {indexMode
          ? (hi != null && series[hi]
              ? <span>{series[hi].label} · <span style={{ color: "rgb(var(--accent))" }}>{labels[0]} {series[hi].value.toFixed(1)}</span> · <span style={{ color: "rgb(var(--info))" }}>{labels[1]} {series[hi].b.toFixed(1)}</span> · 초과 <b style={{ color: retC(series[hi].value - series[hi].b) }}>{pp(series[hi].value - series[hi].b)}</b></span>
              : <span><span style={{ color: "rgb(var(--accent))" }}>● {labels[0]}</span> · <span style={{ color: "rgb(var(--info))" }}>● {labels[1]}</span> · 구간 시작=100 · 현재 초과 <b style={{ color: retC(op) }}>{pp(op)}</b></span>)
          : (hi != null && series[hi]
              ? <span>{series[hi].label} · 순자산 {money0(series[hi].value, base)} · 원금 {money0(series[hi].cost, base)} · <span style={{ color: retC(series[hi].value - series[hi].cost) }}>수익 {money0(series[hi].value - series[hi].cost, base)}</span></span>
              : <span>실선=순자산 · 점선=원금(현 보유량 가정) · 영역=수익 <b style={{ color: retC(gain) }}>{signPct(gpct)}</b> · 같은 수량·현재 환율, 1월~현재</span>)}
      </div>
    </div>
  );
}

function Donut({ data, size = 200, thickness = 28, center }: any) {
  const total = data.reduce((s: number, d: any) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2 - 1;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg className="donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transformBox: "fill-box" } as any}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgb(255 255 255 / 0.06)" strokeWidth={thickness} />
      <g transform={`rotate(-90 ${c} ${c})`}>
        {data.map((d: any, i: number) => { const frac = d.value / total; const dash = Math.max(0, frac * circ - 2.5); const off = -acc * circ; acc += frac; return <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={pal(i)} strokeWidth={thickness} strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={off} strokeLinecap="round" style={{ filter: "drop-shadow(0 2px 5px rgb(0 0 0 / 0.35))" }} />; })}
      </g>
      {center ? <text x={c} y={c - 2} textAnchor="middle" fontSize={10.5} fill="rgb(var(--muted-foreground))">{center.top}</text> : null}
      {center ? <text x={c} y={c + 15} textAnchor="middle" fontSize={15} fontWeight={800} fill="rgb(var(--foreground))">{center.val}</text> : null}
    </svg>
  );
}

// 가로 물결 막대 — 배분을 두꺼운 사각형에 비율 세그먼트로. 경계는 맞물리는 사인 물결.
function WaveBar({ slices }: any) {
  const tot = slices.reduce((s: number, x: any) => s + x.value, 0) || 1;
  const W = 720, H = 60, amp = 6.5, N = 20;
  let acc = 0;
  const segs = slices.map((s: any, i: number) => { const x0 = (acc / tot) * W; acc += s.value; const x1 = (acc / tot) * W; return { ...s, i, x0, x1, frac: s.value / tot }; });
  const off = (x: number, y: number) => ((x <= 0.5 || x >= W - 0.5) ? 0 : amp) * Math.sin((y / H) * Math.PI * 2);
  const edge = (x: number, dir: 1 | -1) => { const p: string[] = []; for (let k = 0; k <= N; k++) { const y = dir === 1 ? (k / N) * H : H - (k / N) * H; p.push(`L ${(x + off(x, y)).toFixed(1)},${y.toFixed(1)}`); } return p.join(" "); };
  const dpath = (s: any) => `M ${s.x0.toFixed(1)},0 L ${s.x1.toFixed(1)},0 ${edge(s.x1, 1)} ${edge(s.x0, -1)} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", height: "auto" }}>
      <defs>
        <clipPath id="wbclip"><rect x="0" y="0" width={W} height={H} rx="15" /></clipPath>
        <linearGradient id="wbgloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgb(255 255 255 / 0.24)" /><stop offset="44%" stopColor="rgb(255 255 255 / 0.04)" /><stop offset="100%" stopColor="rgb(0 0 0 / 0.20)" /></linearGradient>
      </defs>
      <g clipPath="url(#wbclip)">
        {segs.map((s: any) => <path key={s.i} d={dpath(s)} fill={pal(s.i)} />)}
        <rect x="0" y="0" width={W} height={H} fill="url(#wbgloss)" />
        <rect className="wbsheen" x="0" y="0" width={W * 0.22} height={H} fill="rgb(255 255 255 / 0.12)" />
        {segs.filter((s: any) => s.frac >= 0.07).map((s: any) => (
          <text key={s.i} x={(s.x0 + s.x1) / 2} y={H / 2 + 4.5} textAnchor="middle" fontSize={13} fontWeight={800} fill="rgb(255 255 255 / 0.96)" style={{ paintOrder: "stroke", stroke: "rgb(0 0 0 / 0.28)", strokeWidth: 2.5 } as any}>{(s.frac * 100).toFixed(0)}%</text>
        ))}
      </g>
    </svg>
  );
}

function Legend({ slices, base }: any) {
  const tot = slices.reduce((s: number, x: any) => s + x.value, 0) || 1;
  return (
    <div style={{ minWidth: 150, maxWidth: 340, display: "grid", gap: 8, alignContent: "center" }}>
      {slices.map((s: any, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, padding: "1px 0" }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: pal(i), flexShrink: 0 }} />
          <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</span>
          {base ? <span style={{ color: "rgb(var(--muted-foreground))", fontVariantNumeric: "tabular-nums" }}>{money0(s.value, base)}</span> : null}
          <span style={{ fontWeight: 700, minWidth: 46, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{((s.value / tot) * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

// 최소 마크다운 렌더러 (# ## - > --- **bold**)
function MD({ src }: any) {
  const inline = (t: string) => t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>));
  const out: any[] = []; let li: any[] = [];
  const flush = () => { if (li.length) { out.push(<ul key={"u" + out.length} style={{ margin: "4px 0 8px", paddingLeft: 18 }}>{li}</ul>); li = []; } };
  (src || "").split("\n").forEach((ln: string, i: number) => {
    if (/^#\s/.test(ln)) { flush(); out.push(<div key={i} style={{ fontSize: 17, fontWeight: 800, margin: "12px 0 6px" }}>{inline(ln.slice(2))}</div>); }
    else if (/^##\s/.test(ln)) { flush(); out.push(<div key={i} style={{ fontSize: 14, fontWeight: 700, margin: "12px 0 4px" }}>{inline(ln.slice(3))}</div>); }
    else if (/^[-*]\s/.test(ln)) { li.push(<li key={i} style={{ fontSize: 13, lineHeight: 1.65 }}>{inline(ln.replace(/^[-*]\s/, ""))}</li>); }
    else if (/^>\s/.test(ln)) { flush(); out.push(<div key={i} style={{ borderLeft: `3px solid rgb(var(--border))`, paddingLeft: 10, color: "rgb(var(--muted-foreground))", fontSize: 12.5, margin: "6px 0" }}>{inline(ln.slice(2))}</div>); }
    else if (/^---+/.test(ln)) { flush(); out.push(<hr key={i} style={{ border: "none", borderTop: `1px solid rgb(var(--border))`, margin: "10px 0" }} />); }
    else if (ln.trim()) { flush(); out.push(<div key={i} style={{ fontSize: 13, lineHeight: 1.65, margin: "3px 0" }}>{inline(ln)}</div>); }
    else flush();
  });
  flush();
  return <div>{out}</div>;
}

export default function App() {
  const ariadne = useAriadne();
  const [view, setView] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [hist, setHist] = useState<any[]>([]);
  const [base, setBase] = useState("KRW");
  const [nativeMode, setNativeMode] = useState(false);
  const [page, setPage] = useState("assets");
  const [alloc, setAlloc] = useState("ccy");
  const [spx, setSpx] = useState<any[]>([]);
  const [trendMode, setTrendMode] = useState("amt");
  const [trendRange, setTrendRange] = useState("all");
  const [deploy, setDeploy] = useState<any>(null);
  const [groupBy, setGroupBy] = useState("account");
  const [fAcct, setFAcct] = useState<string[]>([]);
  const [fSector, setFSector] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [pnlF, setPnlF] = useState("all");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [secC, setSecC] = useState<string[]>([]);
  const [showFilter, setShowFilter] = useState(false);
  const [ks, setKs] = useState<any[]>([]);
  const [idxHist, setIdxHist] = useState<Record<string, any[]>>({});
  const [detail, setDetail] = useState<any>(null);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailRange, setDetailRange] = useState("6mo");
  const [tsForm, setTsForm] = useState<any>({ target: "", stop: "" });
  const [edF, setEdF] = useState<any>({ shares: "", avg: "", ccy: "" });
  const [edMsg, setEdMsg] = useState("");
  const [tsMsg, setTsMsg] = useState("");
  const [sortBy, setSortBy] = useState("value");
  const [div, setDiv] = useState<Record<string, number>>({});
  const [hist1y, setHist1y] = useState<Record<string, any[]>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [addF, setAddF] = useState<any>({ tk: "", avg: "", amt: "", mode: "total", acct: "", ccy: "", recur: false });
  const [addQ, setAddQ] = useState<any>(null);
  const [addMsg, setAddMsg] = useState("");
  const [addCand, setAddCand] = useState<any[]>([]);
  const [aiOp, setAiOp] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [prof, setProf] = useState<any>(null);
  const [sparplan, setSparplan] = useState<any[]>([]);
  const [wAdd, setWAdd] = useState<any>(null);
  const [todos, setTodos] = useState<any>(null);
  const [brief, setBrief] = useState("");
  const [done, setDone] = useState<any>({});
  const [saveMsg, setSaveMsg] = useState("");
  const [briefMsg, setBriefMsg] = useState("");
  const [geo, setGeo] = useState("");
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoMsg, setGeoMsg] = useState("");
  const [watch, setWatch] = useState<any>(null);
  const [watchT, setWatchT] = useState<any[]>([]);
  const [watchG, setWatchG] = useState<any[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setView(JSON.parse(await ariadne.readText(".ariadne/store/view.json")));
        try { setPlan(JSON.parse(await ariadne.readText("targets/plan.json"))); } catch {}
        try { setTodos(JSON.parse(await ariadne.readText("targets/todos.json"))); } catch {}
        try { setBrief(await ariadne.readText("briefs/latest.md")); } catch {}
        try { setGeo(await ariadne.readText("targets/geo.md")); } catch {}
        try { setWatch(JSON.parse(await ariadne.readText("targets/watchlist.json"))); } catch {}
        try { const wj = JSON.parse(await ariadne.readText("targets/watch.json")) || {}; const gs = wj.groups || (wj.tickers ? [{ name: "★ 관심 종목", tickers: wj.tickers }] : []); setWatchG(gs); setWatchT(gs.flatMap((g: any) => g.tickers || [])); } catch {}
        try { setProf(JSON.parse(await ariadne.readText("targets/profiles.json"))); } catch {}
        try { setSparplan((JSON.parse(await ariadne.readText("targets/sparplan.json")) || {}).plans || []); } catch {}
        try { setDeploy(JSON.parse(await ariadne.readText("targets/deploy.json"))); } catch {}
        try {
          const csv = await ariadne.readText(".ariadne/store/value_history.csv");
          const rows = csv.trim().split("\n").slice(1).map((l: string) => { const [date, krw, usd, eur] = l.split(","); return { date, krw: +krw, usd: +usd, eur: +eur }; });
          setHist(rows);
        } catch {}
        try { setSpx(await ariadne.getQuoteHistory("^GSPC", "1y", "1d")); } catch {}
        try { setKs(await ariadne.getQuoteHistory("^KS11", "1y", "1d")); } catch {}
        try { const h: Record<string, any[]> = {}; for (const i of IDX) { try { h[i.sym] = await ariadne.getQuoteHistory(i.sym, "1mo", "1d"); } catch {} } setIdxHist(h); } catch {}
      } catch (e: any) { setErr(String(e?.message || e)); }
    })();
  }, []);

  useEffect(() => {
    if (!detail) { setDetailData(null); return; }
    let alive = true;
    setDetailData({ loading: true });
    (async () => {
      let hist: any[] = [], news: any[] = [];
      try { hist = await ariadne.getQuoteHistory(detail.quote_symbol, detailRange, "1d"); } catch {}
      try { news = await ariadne.getQuoteNews(detail.quote_symbol, 6); } catch {}
      if (alive) setDetailData({ loading: false, hist, news });
    })();
    return () => { alive = false; };
  }, [detail, detailRange]);
  useEffect(() => { if (detail) { setDetailRange("6mo"); setTsForm({ target: detail.target_price || "", stop: detail.stop_loss || "" }); setTsMsg(""); setAiOp(""); setAiBusy(false); setEdF({ shares: detail.shares ?? "", avg: detail.avg_cost ?? "", ccy: detail.cost_currency || detail.currency || "" }); setEdMsg(""); } }, [detail]);
  useEffect(() => {
    try { const p = JSON.parse(localStorage.getItem("axsPrefs") || "{}"); if (p.groupBy) setGroupBy(p.groupBy); if (p.sortBy) setSortBy(p.sortBy); if (Array.isArray(p.collapsed)) setCollapsed(p.collapsed); if (Array.isArray(p.secC)) setSecC(p.secC); if (Array.isArray(p.fAcct)) setFAcct(p.fAcct); if (Array.isArray(p.fSector)) setFSector(p.fSector); if (p.pnlF) setPnlF(p.pnlF); } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("axsPrefs", JSON.stringify({ groupBy, sortBy, collapsed, secC, fAcct, fSector, pnlF })); } catch {}
  }, [groupBy, sortBy, collapsed, secC, fAcct, fSector, pnlF]);
  useEffect(() => {
    if (!view) return;
    let alive = true;
    (async () => {
      const syms = Array.from(new Set(view.positions.map((p: any) => p.quote_symbol).filter(Boolean)));
      const yrAgo = Date.now() - 365 * 864e5;
      const out: Record<string, number> = {};
      const ph: Record<string, any[]> = {};
      // Bounded concurrency: fetching dividend + 1y history for EVERY position at
      // once is 2×N requests (~82 for a 41-position portfolio) — that network +
      // memory spike on load helped wedge the webview. Process in small batches;
      // same data, set once at the end.
      const LIMIT = 6;
      for (let i = 0; i < syms.length && alive; i += LIMIT) {
        await Promise.all(syms.slice(i, i + LIMIT).map(async (s: any) => {
          try { const h = await ariadne.getDividendHistory(s, "2y"); const sum = (h || []).filter((d: any) => new Date(d.date).getTime() >= yrAgo).reduce((a: number, b: any) => a + (b.amount || 0), 0); if (sum > 0) out[s] = sum; } catch {}
          try { ph[s] = await ariadne.getQuoteHistory(s, "1y", "1d"); } catch {}
        }));
      }
      if (alive) { setDiv(out); setHist1y(ph); }
    })();
    return () => { alive = false; };
  }, [view]);

  const symbols = useMemo(() => { const b = view ? view.positions.map((p: any) => p.quote_symbol).filter(Boolean) : []; return Array.from(new Set([...b, ...IDX.map((i) => i.sym), ...watchT.map((w: any) => w.sym)])); }, [view, watchT]);
  const { data: liveQ } = usePoll(() => ariadne.getQuotes(symbols as string[]), 60000, [symbols.join()]);
  const livePx = useMemo(() => { const o: Record<string, number> = {}; for (const q of (liveQ || [])) o[q.symbol] = q.price; return o; }, [liveQ]);
  const livePxCcy = useMemo(() => { const o: Record<string, string> = {}; for (const q of (liveQ || [])) if (q.currency) o[q.symbol] = q.currency; return o; }, [liveQ]);
  const liveCount = Object.keys(livePx).length;

  const m = useMemo(() => {
    if (!view) return null;
    const per = view.fx.perEur;
    const toBase = (amt: number, c: string) => (per[c] ? amt * (per[base] / per[c]) : 0);
    const toCur = (amt: number, from: string, to: string) => (per[from] && per[to] ? amt * (per[to] / per[from]) : amt);
    // 포지션별 계산 (수익률·손익은 통화 보정)
    const inv: any[] = [];
    for (const p of view.positions) {
      const px = livePx[p.quote_symbol] != null ? livePx[p.quote_symbol] : p.price_native;
      const nv = p.shares * px;
      const valBase = toBase(nv, p.currency);
      const natCcy = p.cost_currency || p.currency;                 // 실제 보유/결제 통화 (TR=EUR)
      const valNative = toCur(nv, p.currency, natCcy);
      const acPx = p.avg_cost && per[p.cost_currency] ? p.avg_cost * (per[p.currency] / per[p.cost_currency]) : null;
      const real = acPx != null && acPx > 0 && p.live;
      const retPct = real ? (px / acPx - 1) * 100 : null;
      const plNat = real ? (px - acPx) * p.shares : 0;
      const costBase = real ? toBase(acPx * p.shares, p.currency) : valBase;
      let flag: string | null = null;
      if (p.target_price && px >= p.target_price * 0.97) flag = "target";
      else if (p.stop_loss && px <= p.stop_loss * 1.03) flag = "stop";
      else if (real && (retPct as number) <= -15) flag = "loss";
      else if (real && (retPct as number) >= 50) flag = "profit";
      inv.push({ ...p, price_native: px, live_now: livePx[p.quote_symbol] != null, nv, valBase, valNative, natCcy, acPx, real, retPct, plNat, plBase: toBase(plNat, p.currency), costBase, flag });
    }
    inv.sort((a, b) => b.valBase - a.valBase);
    // 통화별
    const byCur: Record<string, any> = {};
    const blank = () => ({ invested: 0, cash: 0, positions: [], cashList: [], pl: 0, cost: 0 });
    for (const c of CCYS) byCur[c] = blank();
    for (const p of inv) { const c = p.currency; if (!byCur[c]) byCur[c] = blank(); byCur[c].invested += p.nv; byCur[c].positions.push(p); byCur[c].pl += p.plNat; byCur[c].cost += p.real ? p.acPx * p.shares : 0; }
    for (const b of view.cash) { const c = b.currency; if (!byCur[c]) byCur[c] = blank(); byCur[c].cash += b.amount; byCur[c].cashList.push(b); }
    for (const c in byCur) { byCur[c].positions.sort((a: any, b: any) => b.nv - a.nv); byCur[c].cashList.sort((a: any, b: any) => b.amount - a.amount); byCur[c].total = byCur[c].invested + byCur[c].cash; byCur[c].baseTotal = toBase(byCur[c].total, c); byCur[c].plRet = byCur[c].cost ? (byCur[c].pl / byCur[c].cost) * 100 : 0; }
    const order = CCYS.filter((c) => byCur[c] && byCur[c].total > 0);
    const netBase = order.reduce((s, c) => s + byCur[c].baseTotal, 0) || 1;
    const investedBase = inv.reduce((s, p) => s + p.valBase, 0);
    const cashBase = netBase - investedBase;
    // 그룹 합계 (base)
    const grp = (key: (p: any) => string) => { const o: Record<string, number> = {}; for (const p of inv) { const k = key(p); o[k] = (o[k] || 0) + p.valBase; } return o; };
    const mapArr = (o: Record<string, number>, ko?: (k: string) => string) => Object.entries(o).map(([k, v]) => ({ label: ko ? ko(k) : k, value: v })).sort((a, b) => b.value - a.value);
    const clsObj = grp((p) => ASSET_KO[p.asset_class] || p.asset_class); clsObj["현금"] = cashBase;
    const byClass = mapArr(clsObj);
    const byRegion = mapArr({ ...grp((p) => REGION_KO[p.region] || p.region), 현금: cashBase });
    const bySector = mapArr(grp((p) => p.sector || "기타"));
    const byAcct = mapArr(grp((p) => p.account_label));
    // 집중도
    const topVal = (n: number) => inv.slice(0, n).reduce((s, p) => s + p.valBase, 0);
    const conc = { top1: (topVal(1) / investedBase) * 100, top5: (topVal(5) / investedBase) * 100, top10: (topVal(10) / investedBase) * 100 };
    const aiBase = inv.filter((p) => AI_SECTORS.has(p.sector)).reduce((s, p) => s + p.valBase, 0);
    // 전체 수익률
    const totCost = inv.reduce((s, p) => s + (p.real ? p.costBase : 0), 0);
    const totPL = inv.reduce((s, p) => s + p.plBase, 0);
    const overallRet = totCost ? (totPL / totCost) * 100 : 0;
    const realPos = inv.filter((p) => p.real);
    const best = [...realPos].sort((a, b) => b.retPct - a.retPct);
    void livePx;
    const secMap: Record<string, any> = {};
    for (const p of inv) { const s = p.sector || "기타"; const o = secMap[s] || (secMap[s] = { sector: s, pl: 0, cost: 0, val: 0 }); o.pl += p.plBase; o.cost += p.real ? p.costBase : 0; o.val += p.valBase; }
    const bySectorPL = Object.values(secMap).map((o: any) => ({ ...o, ret: o.cost ? (o.pl / o.cost) * 100 : 0 })).sort((a: any, b: any) => b.pl - a.pl);
    return { per, toBase, inv, byCur, order, netBase, investedBase, cashBase, byClass, byRegion, bySector, byAcct, conc, aiBase, totPL, overallRet, best, bySectorPL };
  }, [view, base, livePx]);

  const trendSeries = useMemo(() => {
    if (!view || !spx.length) return [];
    const per = view.fx.perEur;
    const toBase = (amt: number, c: string) => (per[c] ? amt * (per[base] / per[c]) : 0);
    const cashB = (view.cash || []).reduce((s: number, b: any) => s + toBase(b.amount, b.currency), 0);
    const acPxOf = (p: any) => (p.avg_cost && per[p.cost_currency] ? p.avg_cost * (per[p.currency] / per[p.cost_currency]) : (p.price_native || 0));
    let costB = cashB;
    for (const p of view.positions) costB += toBase(p.shares * acPxOf(p), p.currency);
    const dates = spx.map((r: any) => r.date).filter((d: string) => d >= "2026-01-01");
    // Pre-align each position's price history to `dates` in ONE merge pass (both
    // are date-sorted ascending), carrying the last close ≤ each date. This makes
    // the per-date net-worth sum O(dates × positions) instead of re-scanning each
    // full history per date — O(dates × positions × historyPoints) — which froze
    // the webview on large portfolios. Output is identical.
    const aligned = view.positions.map((p: any) => {
      const e = hist1y[p.quote_symbol] || [];
      const fallback = acPxOf(p);
      const prices: number[] = new Array(dates.length);
      let j = 0;
      let last: number | null = null;
      for (let di = 0; di < dates.length; di++) {
        while (j < e.length && e[j].date <= dates[di]) { last = e[j].close; j++; }
        prices[di] = last != null ? last : fallback;
      }
      return { p, prices };
    });
    const out: any[] = [];
    for (let di = 0; di < dates.length; di++) {
      let val = cashB;
      for (const a of aligned) val += toBase(a.p.shares * a.prices[di], a.p.currency);
      out.push({ d: dates[di], label: dates[di].slice(5), value: val, cost: costB });
    }
    return out;
  }, [view, hist1y, base, spx]);

  if (err) return <div style={{ padding: 28, color: T("destructive") }}>view.json 로드 실패: {err}</div>;
  if (!view || !m) return <div style={{ padding: 28, ...muted }}>로딩…</div>;
  const cashPct = (m.cashBase / m.netBase) * 100;

  // ── 통화 카드 ──
  function CurCard({ c }: any) {
    const d = m.byCur[c], me = CUR_META[c];
    return (
      <div className="ah" style={{ ...card, flex: 1, minWidth: 220, borderTop: `3px solid ${T(me.color)}` }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{me.flag} {SYM[c]} {me.name}</div>
        <div className="grad" style={{ fontSize: 27, fontWeight: 800, marginTop: 4, lineHeight: 1.1, letterSpacing: "-0.01em" }}><CountUp value={d.total} fmt={(n: number) => money0(n, c)} /></div>
        <div style={{ fontSize: 12, ...muted, marginTop: 5 }}>투자 {money0(d.invested, c)} · 현금 {money0(d.cash, c)}</div>
        <div style={{ fontSize: 12, marginTop: 3, color: retC(d.plRet) }}>
          평가손익 {d.pl >= 0 ? "+" : "-"}{money0(Math.abs(d.pl), c)} ({signPct(d.plRet)})
        </div>
      </div>
    );
  }

  // ── 통화별 보유표 (수익률·손익 포함) ──
  async function genBrief() {
    setBriefMsg("생성 중…(10~30초)");
    try { await ariadne.runAction("macro_brief_monthly"); setBriefMsg("생성 완료 — 새로고침"); } catch { setBriefMsg("실패"); }
  }
  async function geoRun() {
    setGeoBusy(true); setGeoMsg("");
    try { await runActionText("geo_radar"); try { setGeo(await ariadne.readText("targets/geo.md")); } catch {} }
    catch (e: any) { setGeoMsg("실패: " + (e?.message || "오류")); }
    setGeoBusy(false);
  }
  async function saveTodos() {
    if (!todos) return;
    const next = { ...todos, updated: new Date().toISOString().slice(0, 10), groups: todos.groups.map((g: any, gi: number) => ({ ...g, items: g.items.map((it: any, ii: number) => { const key = gi + "-" + ii; return { ...it, done: key in done ? done[key] : it.done }; }) })) };
    try { await ariadne.stageFile("targets/todos.json", JSON.stringify(next, null, 2) + "\n"); setSaveMsg("저장됨"); } catch { setSaveMsg("실패"); }
  }

  // ── 지표 스트립 ──
  function Strip() {
    return (
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Metric label="순자산" value={<CountUp value={m.netBase} fmt={(n: number) => money0(n, base)} />} sub={`투자 ${(100 - cashPct).toFixed(0)}% · 현금 ${cashPct.toFixed(0)}%`} />
        <Metric label="평가손익(투자분)" value={signPct(m.overallRet)} tone={m.overallRet >= 0 ? "success" : "destructive"} sub={`${m.totPL >= 0 ? "+" : "-"}${money0(Math.abs(m.totPL), base)}`} />
        <Metric label="현금 비중" value={`${cashPct.toFixed(0)}%`} tone={cashPct > 30 ? "warning" : undefined} sub={cashPct > 25 ? "목표 15~20% ↓" : "적정"} />
        <Metric label="최대 단일 비중" value={`${m.conc.top1.toFixed(0)}%`} sub={`${m.inv[0]?.name || ""}`} />
        <Metric label="AI·반도체 익스포저" value={`${((m.aiBase / m.investedBase) * 100).toFixed(0)}%`} tone="warning" sub="거시 집중 리스크" />
      </div>
    );
  }

  // ── 배분 도넛 ──
  const secOpen = (id: string) => !secC.includes(id);
  const secHead = (id: string, title: any, right?: any) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <div onClick={() => setSecC(secOpen(id) ? [...secC, id] : secC.filter((k) => k !== id))} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", userSelect: "none", flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 10, color: T("muted-foreground"), display: "inline-block", transition: "transform .22s ease", transform: secOpen(id) ? "rotate(90deg)" : "none" }}>▶</span>
        {title}
      </div>
      {right}
    </div>
  );

  function Alloc() {
    const src = alloc === "ccy" ? m.order.map((c) => ({ label: `${SYM[c]} ${CUR_META[c].name}`, value: m.byCur[c].baseTotal })) : alloc === "class" ? m.byClass : alloc === "region" ? m.byRegion : m.byAcct;
    const slices = topSlices(src, 6);
    return (
      <div style={card}>
        {secHead("alloc", <span style={{ fontSize: 15, fontWeight: 800 }}>자산 배분</span>, secOpen("alloc") ? <Seg sm value={alloc} onChange={setAlloc} options={[{ value: "ccy", label: "통화" }, { value: "class", label: "자산군" }, { value: "region", label: "지역" }, { value: "acct", label: "계좌" }]} /> : null)}
        {secOpen("alloc") && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, ...muted, marginBottom: 7 }}>합계 <b style={{ color: T("foreground"), fontSize: 13.5 }}>{money0(slices.reduce((s: number, x: any) => s + x.value, 0), base)}</b></div>
          {WaveBar({ slices })}
          <div style={{ marginTop: 12 }}><Legend slices={slices} base={base} /></div>
        </div>)}
      </div>
    );
  }

  // ── 순자산 추이 ──
  function Trend() {
    const unit = base === "KRW" ? "백만₩" : "천" + SYM[base];
    const RANGES = [{ v: "1m", label: "1M", d: 31 }, { v: "3m", label: "3M", d: 92 }, { v: "6m", label: "6M", d: 183 }, { v: "all", label: "전체", d: 99999 }];
    const rsel = RANGES.find((r) => r.v === trendRange) || RANGES[3];
    const cutISO = new Date(Date.now() - rsel.d * 864e5).toISOString().slice(0, 10);
    const win = trendSeries.filter((p: any) => p.d >= cutISO);
    const sliced = win.length >= 2 ? win : trendSeries;            // fallback if window too short
    const benchHist = trendMode === "spx" ? spx : trendMode === "ks" ? ks : null;
    const onDate = (s: any[], d: string) => { let v: any = null; for (const r of s) { if (r.date <= d) v = r.close; else break; } return v; };
    let chartSeries: any[] = sliced, indexMode = false, labels: any = null;
    if (benchHist && benchHist.length && sliced.length >= 2) {
      const p0 = sliced[0].value, b0 = onDate(benchHist, sliced[0].d);
      if (p0 > 0 && b0 > 0) {
        chartSeries = sliced.map((p: any) => ({ label: p.label, value: (p.value / p0) * 100, b: (onDate(benchHist, p.d) / b0) * 100 }));
        indexMode = true; labels = ["내 포트", trendMode === "ks" ? "코스피" : "S&P500"];
      }
    }
    const opts: any[] = [{ value: "amt", label: "금액" }];
    if (spx.length) opts.push({ value: "spx", label: "vs S&P500" });
    if (ks.length) opts.push({ value: "ks", label: "vs 코스피" });
    return (
      <div style={card}>
        {secHead("trend", <span style={{ fontSize: 15, fontWeight: 800 }}>📈 순자산 추이 <span style={{ fontSize: 11, fontWeight: 400, ...muted }}>({indexMode ? "시작=100" : unit})</span></span>, secOpen("trend") && opts.length > 1 ? <Seg sm value={trendMode} onChange={setTrendMode} options={opts} /> : null)}
        {secOpen("trend") && (<div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}><Seg sm value={trendRange} onChange={setTrendRange} options={RANGES.map((r) => ({ value: r.v, label: r.label }))} /></div>
          {trendSeries.length >= 2 ? (
            <AreaTrend series={chartSeries} base={base} indexMode={indexMode} labels={labels} />
          ) : (
            <div style={{ ...muted, fontSize: 12, padding: "10px 2px" }}>추이 데이터 불러오는 중… (S&P500 히스토리 대기 — 같은 보유량 가정 1월~현재).</div>
          )}
          {indexMode ? <div style={{ ...muted, fontSize: 11, marginTop: 4 }}>둘 다 구간 시작=100 기준 성장 비교 (포트는 {base} 환산 — 환율 영향 포함).</div> : null}
        </div>)}
      </div>
    );
  }

  function Hub() {
    const alerts: any[] = [];
    if (cashPct > 25) alerts.push({ icon: "💰", tone: "warning", t: `현금 ${cashPct.toFixed(0)}% 과다`, b: `목표 15~20% → 약 ${money0(Math.max(0, m.cashBase - m.netBase * 0.18), base)} 일을 시켜야` });
    for (const a of view.accounts) if (a.status === "closing" && a.closing?.date) {
      const d = Math.ceil((new Date(a.closing.date).getTime() - Date.now()) / 864e5);
      alerts.push({ icon: "🚨", tone: "destructive", t: `${a.label} 폐쇄 D-${d}`, b: `${a.closing.date} — 현금·주식 이전/청산` });
    }
    if ((m.aiBase / m.investedBase) * 100 > 40) alerts.push({ icon: "⚠️", tone: "warning", t: `AI·반도체 ${((m.aiBase / m.investedBase) * 100).toFixed(0)}% 집중`, b: "거시 핵심 리스크 — ETF로 일원화 + 분산 권장" });
    const capAcc = view.accounts.find((a: any) => a.cap);
    if (capAcc) { const c = capAcc.cap; const left = (c.annual_limit || 0) - (c.used_this_year || 0); alerts.push({ icon: "🛡️", tone: "info", t: `연간 한도 ${money0(left, "KRW")} 남음`, b: `한도 내 적립 권장 (올해 ${money0(c.used_this_year || 0, "KRW")} / ${money0(c.annual_limit, "KRW")})` }); }
    const days = Math.floor((Date.now() - new Date(view.fx.date + "T00:00:00").getTime()) / 864e5);
    if (days > 1) alerts.push({ icon: "🔄", tone: "accent", t: `가격 ${days}일 전 (${view.fx.date})`, b: "실시간 갱신은 KIS API 연동 후 — 현재 수동/일배치" });
    for (const h of m.inv.filter((p: any) => p.flag === "target" || p.flag === "stop").slice(0, 4)) alerts.push({ icon: h.flag === "target" ? "🎯" : "🛑", tone: h.flag === "target" ? "success" : "destructive", t: `${h.name} ${h.flag === "target" ? "목표가 도달/근접" : "손절선 근접/이탈"}`, b: `현재 ${money(h.price_native, h.currency)} · ${h.flag === "target" ? "목표 " + money(h.target_price, h.currency) : "손절 " + money(h.stop_loss, h.currency)}` });
    const bigLoss = m.inv.filter((p: any) => p.flag === "loss").length, bigProfit = m.inv.filter((p: any) => p.flag === "profit").length;
    if (bigLoss || bigProfit) alerts.push({ icon: "📊", tone: "info", t: `정리·익절 검토 ${bigLoss + bigProfit}종`, b: `큰 손실 ${bigLoss}(−15%↓) · 큰 이익 ${bigProfit}(+50%↑) — 정리 탭에서` });
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <Strip />
        <div style={card}>
          {secHead("alerts", <span style={{ fontSize: 16, fontWeight: 800 }}>🤖 자산 비서 · 알림 <span style={{ fontSize: 11, fontWeight: 400, ...muted }}>{alerts.length}</span></span>)}
          {secOpen("alerts") && (
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {alerts.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "9px 11px", borderRadius: 9, background: TA(a.tone, 0.08), borderLeft: `3px solid ${T(a.tone)}` }}>
                <span style={{ fontSize: 16 }}>{a.icon}</span>
                <div><div style={{ fontWeight: 700, fontSize: 13.5 }}>{a.t}</div><div style={{ fontSize: 12, ...muted }}>{a.b}</div></div>
              </div>
            ))}
          </div>)}
        </div>
        <div style={card}>
          {secHead("todos", <span style={{ fontSize: 16, fontWeight: 800 }}>✅ 할 일</span>, secOpen("todos") ? <button onClick={saveTodos} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, border: `1px solid ${T("border")}`, borderRadius: 8, background: "transparent", color: T("foreground"), cursor: "pointer" }}>💾 {saveMsg || "변경 저장"}</button> : null)}
          {secOpen("todos") && <div style={{ marginTop: 10 }}>
          {todos ? todos.groups.map((g: any, gi: number) => (
            <div key={gi} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, ...muted, marginBottom: 5 }}>{g.title}</div>
              {g.items.map((it: any, ii: number) => {
                const key = gi + "-" + ii; const d = key in done ? done[key] : it.done;
                return (
                  <div key={ii} onClick={() => setDone({ ...done, [key]: !d })} style={{ display: "flex", gap: 9, padding: "5px 0", cursor: "pointer", alignItems: "center" }}>
                    <span style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${d ? T("success") : T("border")}`, background: d ? T("success") : "transparent", color: T("background"), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0 }}>{d ? "✓" : ""}</span>
                    <span style={{ fontSize: 13, textDecoration: d ? "line-through" : "none", color: d ? T("muted-foreground") : T("foreground") }}>{it.t}</span>
                  </div>
                );
              })}
            </div>
          )) : <div style={muted}>targets/todos.json 없음</div>}
          </div>}
        </div>
        <div style={card}>
          {secHead("brief", <span style={{ fontSize: 16, fontWeight: 800 }}>📋 최근 브리핑</span>, secOpen("brief") ? <button onClick={genBrief} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 700, border: "none", borderRadius: 8, background: T("accent"), color: T("accent-foreground"), cursor: "pointer" }}>📝 {briefMsg || "새로 생성 (AI)"}</button> : null)}
          {secOpen("brief") && <div style={{ marginTop: 8 }}>{brief ? <MD src={brief} /> : <div style={muted}>브리핑 없음 — [Create & runs]에서 생성</div>}</div>}
        </div>
        <div style={{ ...card, borderTop: `3px solid ${T("info")}` }}>
          {secHead("geo", <span style={{ fontSize: 16, fontWeight: 800 }}>🌍 지정학 레이더 <span style={{ fontSize: 11, fontWeight: 400, ...muted }}>이벤트 → 내 보유 노출</span></span>, secOpen("geo") ? <button onClick={geoRun} disabled={geoBusy} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 700, border: "none", borderRadius: 8, background: geoBusy ? TA("accent", 0.4) : T("accent"), color: T("accent-foreground"), cursor: geoBusy ? "default" : "pointer" }}>{geoBusy ? "분석 중…(~30초)" : geoMsg || "🛰️ 분석"}</button> : null)}
          {secOpen("geo") && <div style={{ marginTop: 8 }}>{geo ? <MD src={geo} /> : <div style={muted}>아직 없음 — 🛰️ 분석을 눌러 최근 지정학 이벤트를 내 보유에 매핑.</div>}</div>}
        </div>
        {watch ? watch.themes.map((th: any, ti: number) => (
          <div key={ti} style={card}>
            {secHead("wl" + ti, <span style={{ fontSize: 16, fontWeight: 800 }}>{th.name} <span style={{ fontSize: 11, fontWeight: 400, ...muted }}>워치리스트 · 미보유</span></span>)}
            {secOpen("wl" + ti) && <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, ...muted, margin: "0 0 10px", lineHeight: 1.55 }}>{th.context}</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <tbody>
                {th.items.map((it: any, ii: number) => {
                  const c = /^(보유|S|A)/.test(it.tier) ? "success" : /^(코어|안전)/.test(it.tier) ? "accent" : "warning";
                  return (
                    <tr key={ii} style={{ borderBottom: `1px solid ${TA("border", 0.4)}` }}>
                      <td style={{ padding: "6px 6px", width: 80, verticalAlign: "top" }}><span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 5, background: TA(c, 0.18), color: T(c), whiteSpace: "nowrap" }}>{it.tier}</span></td>
                      <td style={{ padding: "6px 6px", fontWeight: 600, verticalAlign: "top" }}>{it.name}<br /><span style={{ ...muted, fontSize: 10 }}>{it.code}</span></td>
                      <td style={{ padding: "6px 6px", ...muted, verticalAlign: "top" }}>{it.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>}
          </div>
        )) : null}
        <div style={{ ...card, borderStyle: "dashed" }}>
          <div style={{ fontSize: 13 }}>💬 <b>대화창구</b> — 상단 <b>Chat</b> 탭에서 무엇이든.<br /><span style={muted}>예: "내 포트폴리오 거시 리스크는?" · "Revolut 청산 순서?"</span></div>
        </div>
      </div>
    );
  }

  function DetailPanel() {
    if (!detail) return null;
    const p = detail, dd = detailData || {};
    const histData = (dd.hist || []).map((h: any) => ({ label: `${h.date}`.slice(5), value: h.close }));
    return (
      <div onClick={() => setDetail(null)} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgb(0 0 0 / 0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div onClick={(e: any) => e.stopPropagation()} className="pop" style={{ ...card, width: 600, maxWidth: "94%", maxHeight: "88vh", overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{p.name} <span style={{ ...muted, fontSize: 12 }}>{p.ticker}</span></div>
              <div style={{ fontSize: 12, ...muted, marginTop: 2 }}>{REGION_KO[p.region] || p.region} · {p.sector} · {p.account_label}</div>
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <button onClick={() => { const s = p.quote_symbol || p.ticker; setDetail(null); openAdd(s, p.name); }} style={{ border: "none", background: T("accent"), color: T("accent-foreground"), borderRadius: 8, padding: "0 12px", height: 30, cursor: "pointer", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>매수</button>
              <button onClick={() => setDetail(null)} style={{ border: `1px solid ${T("border")}`, background: "transparent", color: T("foreground"), borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: 14 }}>✕</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 20, marginTop: 12, flexWrap: "wrap" }}>
            <div><div style={{ fontSize: 11, ...muted }}>현재가</div><div style={{ fontSize: 19, fontWeight: 800 }}>{money(p.price_native, p.currency)}{p.live_now ? <span className="live" style={{ color: T("success"), fontSize: 9, marginLeft: 5 }}>●</span> : null}</div></div>
            <div><div style={{ fontSize: 11, ...muted }}>평가액</div><div style={{ fontSize: 19, fontWeight: 800 }}>{nativeMode && p.valNative != null ? money0(p.valNative, p.natCcy) : money0(p.valBase, base)}</div></div>
            <div><div style={{ fontSize: 11, ...muted }}>수익률</div><div style={{ fontSize: 19, fontWeight: 800, color: p.real ? retC(p.retPct) : T("muted-foreground") }}>{p.real ? signPct(p.retPct) : "—"}</div></div>
            <div><div style={{ fontSize: 11, ...muted }}>보유</div><div style={{ fontSize: 19, fontWeight: 800 }}>{p.shares}</div></div>
          </div>
          {(() => {
            const key = baseSym(p.ticker || p.quote_symbol || p.instrument_id || "");
            const pr = prof && prof.p && prof.p[key];
            if (!pr) return null;
            const tc = pr.type === "etf" ? "info" : pr.type === "fund" ? "warning" : "accent";
            return (
              <div style={{ marginTop: 14, padding: "11px 13px", borderRadius: 11, background: TA("muted", 0.22), border: `1px solid ${TA("border", 0.5)}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800 }}>📋 프로필</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: TA(tc, 0.18), color: T(tc) }}>{pr.type === "etf" ? "ETF" : pr.type === "fund" ? "펀드" : "주식"}</span>
                  <span style={{ fontSize: 11, ...muted }}>{pr.sector}</span>
                </div>
                {pr.tag ? <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 6, lineHeight: 1.5 }}>{pr.tag}</div> : null}
                <div style={{ display: "grid", gap: 5, marginTop: 8, fontSize: 12, lineHeight: 1.55 }}>
                  {pr.recent ? <div><b style={{ ...muted, fontWeight: 700 }}>📈 최근 </b>{pr.recent}</div> : null}
                  {pr.outlook ? <div><b style={{ ...muted, fontWeight: 700 }}>🧭 전망 </b>{pr.outlook}</div> : null}
                  {pr.risk ? <div><b style={{ color: T("warning"), fontWeight: 700 }}>⚠️ 리스크 </b>{pr.risk}</div> : null}
                  {pr.fee ? <div><b style={{ ...muted, fontWeight: 700 }}>💸 수수료 </b>{pr.fee}</div> : null}
                  {pr.method ? <div><b style={{ ...muted, fontWeight: 700 }}>⚙️ 산정 </b>{pr.method}</div> : null}
                </div>
                <div style={{ fontSize: 10, ...muted, marginTop: 7 }}>AI 리서치 · {prof.updated || ""} 기준</div>
              </div>
            );
          })()}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>📈 추이 <span style={{ fontSize: 11, fontWeight: 400, ...muted }}>({p.currency})</span></span>
            <Seg sm value={detailRange} onChange={setDetailRange} options={[{ value: "1mo", label: "1M" }, { value: "6mo", label: "6M" }, { value: "1y", label: "1Y" }, { value: "5y", label: "5Y" }]} />
          </div>
          {dd.loading ? <div style={{ ...muted, fontSize: 12, padding: 10 }}>불러오는 중…</div> : histData.length >= 2 ? <div style={{ overflowX: "auto" }}><LineChart data={histData} width={552} height={180} color={T("accent")} /></div> : <div style={{ ...muted, fontSize: 12, padding: 10 }}>차트 데이터 없음</div>}
          {(p.account_id && p.instrument_id) ? (<>
            <div style={{ marginTop: 16, fontSize: 13, fontWeight: 700 }}>✏️ 보유 수정 <span style={{ fontSize: 10.5, fontWeight: 400, ...muted }}>평단·수량·결제통화</span></div>
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
              <input value={edF.avg} onChange={(e: any) => setEdF({ ...edF, avg: e.target.value })} placeholder="평균단가" inputMode="decimal" style={{ flex: 1, minWidth: 96, padding: "7px 9px", borderRadius: 8, border: `1px solid ${T("border")}`, background: T("background"), color: T("foreground"), fontSize: 13, boxSizing: "border-box" }} />
              <input value={edF.shares} onChange={(e: any) => setEdF({ ...edF, shares: e.target.value })} placeholder="수량" inputMode="decimal" style={{ flex: 1, minWidth: 80, padding: "7px 9px", borderRadius: 8, border: `1px solid ${T("border")}`, background: T("background"), color: T("foreground"), fontSize: 13, boxSizing: "border-box" }} />
              <select value={edF.ccy} onChange={(e: any) => setEdF({ ...edF, ccy: e.target.value })} style={{ width: 84, flexShrink: 0, padding: "7px 9px", borderRadius: 8, border: `1px solid ${T("border")}`, background: T("background"), color: T("foreground"), fontSize: 13, boxSizing: "border-box" }}>{["EUR", "USD", "KRW"].map((c) => <option key={c} value={c}>{c}</option>)}</select>
              <button onClick={editHolding} style={{ padding: "7px 13px", borderRadius: 8, border: "none", background: T("foreground"), color: T("background"), fontWeight: 700, fontSize: 13, cursor: "pointer" }}>저장</button>
            </div>
            {edMsg ? <div style={{ fontSize: 11.5, ...muted, marginTop: 4 }}>{edMsg}</div> : null}
          </>) : null}
          <div style={{ marginTop: 16, fontSize: 13, fontWeight: 700 }}>🎯 목표가 · 손절 {p.flag ? <span style={{ fontSize: 11, marginLeft: 4 }}>{p.flag === "target" ? "🎯 도달/근접" : p.flag === "stop" ? "🛑 이탈/근접" : p.flag === "loss" ? "⚠️ 큰손실" : "✨ 큰이익"}</span> : null}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input value={tsForm.target} onChange={(e: any) => setTsForm({ ...tsForm, target: e.target.value })} placeholder={`목표가 (${p.currency})`} inputMode="decimal" style={{ flex: 1, minWidth: 110, padding: "7px 9px", borderRadius: 8, border: `1px solid ${T("border")}`, background: T("background"), color: T("foreground"), fontSize: 13, boxSizing: "border-box" }} />
            <input value={tsForm.stop} onChange={(e: any) => setTsForm({ ...tsForm, stop: e.target.value })} placeholder={`손절가 (${p.currency})`} inputMode="decimal" style={{ flex: 1, minWidth: 110, padding: "7px 9px", borderRadius: 8, border: `1px solid ${T("border")}`, background: T("background"), color: T("foreground"), fontSize: 13, boxSizing: "border-box" }} />
            <button onClick={tsSave} style={{ padding: "7px 13px", borderRadius: 8, border: "none", background: T("accent"), color: T("accent-foreground"), fontWeight: 700, fontSize: 13, cursor: "pointer" }}>저장</button>
          </div>
          {tsMsg ? <div style={{ fontSize: 11.5, ...muted, marginTop: 4 }}>{tsMsg}</div> : null}
          <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>🤖 AI 의견 <span style={{ fontSize: 10.5, fontWeight: 400, ...muted }}>매수/관망 · 목표가 · 보조판단</span></span>
            <button onClick={aiOpinion} disabled={aiBusy} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: aiBusy ? TA("accent", 0.4) : T("accent"), color: T("accent-foreground"), fontWeight: 700, fontSize: 12.5, cursor: aiBusy ? "default" : "pointer" }}>{aiBusy ? "분석 중… (~30초)" : "의견 생성"}</button>
          </div>
          {aiOp ? <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 10, background: TA("muted", 0.22), border: `1px solid ${TA("border", 0.5)}` }}><MD src={aiOp} /></div> : null}
          <div style={{ marginTop: 16, fontSize: 13, fontWeight: 700 }}>📰 뉴스</div>
          {dd.loading ? <div style={{ ...muted, fontSize: 12, padding: 10 }}>불러오는 중…</div> : (dd.news && dd.news.length) ? <div style={{ display: "grid", gap: 9, marginTop: 6 }}>{dd.news.map((n: any, i: number) => (<div key={i} style={{ borderLeft: `2px solid ${TA("accent", 0.5)}`, paddingLeft: 10 }}><div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.4 }}>{n.title}</div><div style={{ fontSize: 11, ...muted, marginTop: 2 }}>{n.publisher}{n.publishedAt ? ` · ${`${n.publishedAt}`.slice(0, 10)}` : ""}</div></div>))}</div> : <div style={{ ...muted, fontSize: 12, padding: 10 }}>뉴스 없음 (주로 미국 종목 제공)</div>}
        </div>
      </div>
    );
  }

  async function tsSave() {
    if (!detail) return;
    try {
      const txt = await ariadne.readText("positions/current.csv");
      let found = false;
      const out = txt.split("\n").map((l: string, i: number) => {
        if (i === 0 || !l.trim()) return l;
        const c = l.split(",");
        if (c[0] === detail.account_id && c[1] === detail.instrument_id) { c[7] = `${tsForm.target}`.trim(); c[8] = `${tsForm.stop}`.trim(); found = true; return c.join(","); }
        return l;
      });
      if (!found) { setTsMsg("positions 행을 못 찾음"); return; }
      await ariadne.stageFile("positions/current.csv", out.join("\n"));
      setTsMsg("✓ 스테이징 — Apply 후 build_view 시 🎯/🛑 알림 작동");
    } catch { setTsMsg("저장 실패"); }
  }
  async function editHolding() {
    if (!detail || !detail.account_id || !detail.instrument_id) return;
    const sh = +edF.shares, av = +edF.avg;
    if (!isFinite(sh) || sh <= 0 || !isFinite(av) || av <= 0) { setEdMsg("수량·평균단가를 확인하세요"); return; }
    try {
      const txt = await ariadne.readText("positions/current.csv");
      let found = false;
      const out = txt.split("\n").map((l: string, i: number) => {
        if (i === 0 || !l.trim()) return l;
        const c = l.split(",");
        if (c[0] === detail.account_id && c[1] === detail.instrument_id) { c[2] = `${+sh.toFixed(4)}`; c[3] = `${av}`; c[4] = edF.ccy || c[4]; found = true; return c.join(","); }
        return l;
      });
      if (!found) { setEdMsg("positions 행을 못 찾음"); return; }
      await ariadne.stageFile("positions/current.csv", out.join("\n"));
      setEdMsg("✓ 스테이징 — Apply 후 가격갱신 시 반영");
    } catch { setEdMsg("저장 실패"); }
  }
  async function addResolve(over?: any): Promise<boolean> {
    const raw = (typeof over === "string" ? over : addF.tk).trim();
    if (!raw) return false;
    setAddQ("loading"); setAddMsg("");
    const tk = raw.toUpperCase();
    // 유럽 UCITS ETF(예: IWDA·VWCE …)는 Yahoo가 거래소 접미사를 요구 → bare가 실패하면
    // 주요 유럽 거래소 접미사를 함께 시도(한 번에 병렬). 접미사/하이픈이 이미 있으면 그대로.
    const cands = /[.\-=]/.test(tk) ? [tk] : [tk, `${tk}.SG`, `${tk}.DE`, `${tk}.MU`, `${tk}.L`, `${tk}.AS`, `${tk}.PA`, `${tk}.MI`, `${tk}.SW`];
    try {
      const r: any = await ariadne.getQuotesDetailed(cands);
      const quotes = ((r && r.quotes) || []).filter((q: any) => q && q.price);
      const pick = (c: string) => quotes.find((q: any) => `${q.inputSymbol || ""}`.toUpperCase() === c || `${q.resolvedSymbol || q.symbol || ""}`.toUpperCase() === c);
      let hit: any = null;
      for (const c of cands) { hit = pick(c); if (hit) break; }
      if (!hit) hit = quotes[0] || null;
      if (hit) { setAddQ({ symbol: hit.resolvedSymbol || hit.symbol || tk, price: hit.price, currency: hit.currency || "USD" }); setAddF((f: any) => ({ ...f, ccy: f.ccy || hit.currency || "USD" })); return true; }
      setAddQ("miss"); return false;
    } catch { setAddQ("miss"); return false; }
  }
  // 확인 = 티커 해석 우선, 실패(또는 이름 입력)면 이름 검색으로 자동 폴백.
  async function addLookup() {
    const raw = addF.tk.trim();
    if (!raw) return;
    setAddCand([]);
    // ISIN(IE00B53SZB19 등)·이름·공백/한글이면 검색으로. 그 외엔 티커 해석 우선, 실패 시 검색.
    const isISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(raw.toUpperCase());
    const looksName = /\s/.test(raw) || /[가-힣]/.test(raw);
    if (isISIN || looksName) { await addSearchName(); return; }
    const ok = await addResolve();
    if (!ok) await addSearchName();
  }
  async function addSearchName() {
    const q = addF.tk.trim();
    if (!q) return;
    setAddMsg("🔎 이름으로 검색 중…");
    try {
      const matches: any[] = await (ariadne as any).searchSymbols(q, 7);
      const cand = (matches || []).map((m: any) => ({ sym: m.symbol, nm: m.name, ex: m.exchange, why: m.type }));
      if (!cand.length) { setAddMsg("이름 검색 결과 없음 — 정확한 티커를 입력하거나 🤖 AI 후보를 시도하세요."); return; }
      setAddCand(cand); setAddMsg("후보를 눌러 자동 입력 → 가격 확인");
    } catch { setAddMsg("이름 검색을 아직 못 씀(서버/웹 업데이트 대기) — 🤖 AI 후보를 시도하세요."); }
  }
  // Fire an action, then poll getRun until it finishes; return the last block's text.
  async function runActionText(actionId: string, input?: any): Promise<string> {
    const r: any = await ariadne.runAction(actionId, input || {});
    const id = r && (r.id || r.runId);
    if (!id) throw new Error("run id 없음");
    for (let i = 0; i < 60; i++) {
      await new Promise((res) => setTimeout(res, 2000));
      const run: any = await ariadne.getRun(id);
      if (run && (run.status === "completed" || run.status === "failed")) {
        if (run.status === "failed") throw new Error(run.error || "run 실패");
        const br = run.blockResults || [];
        return (br.length ? br[br.length - 1].output : "") || "";
      }
    }
    throw new Error("시간 초과 (서버 미응답)");
  }
  async function addFindTicker() {
    const name = addF.tk.trim();
    if (!name) return;
    setAddCand([]); setAddMsg("🤖 AI가 후보 찾는 중… (~25초)");
    try {
      const txt = await runActionText("find_ticker", { name });
      const cand = txt.split("\n").map((l: string) => l.trim()).filter((l: string) => l.includes("|"))
        .map((l: string) => l.split("|").map((s: string) => s.trim()))
        .filter((c: string[]) => c[0] && !/^NONE$/i.test(c[0]) && !/ticker/i.test(c[0]))
        .map((c: string[]) => ({ sym: c[0], nm: c[1] || "", ex: c[2] || "", why: c[3] || "" }));
      if (!cand.length) { setAddMsg("AI가 확실한 후보를 못 찾음 — 정확한 티커를 입력해 주세요."); return; }
      setAddCand(cand); setAddMsg("후보를 눌러 자동 입력 → 가격 확인");
    } catch (e: any) { setAddMsg("AI 후보 실패: " + (e?.message || "오류") + " — 서버 재시작 후 사용 가능."); }
  }
  async function aiOpinion() {
    if (!detail) return;
    setAiBusy(true); setAiOp("");
    try { setAiOp(await runActionText("analyze_stock", { symbol: detail.quote_symbol || detail.ticker || "", name: detail.name || "" })); }
    catch (e: any) { setAiOp("실패: " + (e?.message || "오류") + "\n\n_AI 액션은 서버 재시작 후 활성화됩니다._"); }
    setAiBusy(false);
  }
  // 한 종목을 미리 채우고 보유추가 모달 열기 (관심종목 → 구매 바로가기)
  function openAdd(sym?: string, name?: string) {
    setAddOpen(true); setAddQ(null); setAddMsg(""); setAddCand([]);
    setAddF({ tk: sym || "", avg: "", amt: "", mode: "total", acct: "", ccy: "", recur: false });
    if (sym) setTimeout(() => addResolve(sym), 0);
  }
  async function addSave() {
    const av = +addF.avg;
    const sh = addF.mode === "shares" ? +addF.amt : (+addF.amt) / av;
    if (!addQ || addQ === "miss" || addQ === "loading" || !addF.avg || !addF.amt || !addF.acct || !isFinite(sh) || sh <= 0) { setAddMsg("티커 확인·평균단가·금액(또는 수량)·계좌를 채워주세요"); return; }
    const id = `${addQ.symbol}`.replace(/\..*/, "").toLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    const shares = +sh.toFixed(4);
    const ccy = addF.ccy || addQ.currency;
    const pRow = `${addF.acct},${id},${shares},${addF.avg},${ccy},24,,,,${today},추가,수동추가`;
    const iRow = `${id},${id},${id},stock,?,?,${addQ.currency},,,,${addQ.symbol},active,수동추가`;
    try {
      const pos = await ariadne.readText("positions/current.csv");
      await ariadne.stageFile("positions/current.csv", pos.replace(/\n+$/, "") + "\n" + pRow + "\n");
      const ins = await ariadne.readText("instruments/_index.csv");
      if (!ins.split("\n").some((l: string) => l.startsWith(id + ","))) await ariadne.stageFile("instruments/_index.csv", ins.replace(/\n+$/, "") + "\n" + iRow + "\n");
      setAddMsg(`✓ ${addQ.symbol} 스테이징 — 상단 Apply 후 가격갱신(collect_prices→build_view) 시 반영`);
    } catch { setAddMsg("저장 실패"); }
  }
  // 정기구매(Sparplan) 계획 등록 → sparplan.json
  async function addSparplan() {
    if (!addQ || addQ === "miss" || addQ === "loading" || !addF.amt || !addF.acct) { setAddMsg("티커 확인·월 금액·계좌를 채워주세요"); return; }
    const today = new Date().toISOString().slice(0, 10);
    const acctLabel = (view.accounts.find((a: any) => a.id === addF.acct) || {}).label || addF.acct;
    const plan = { id: `${addQ.symbol}-${addF.acct}`, sym: addQ.symbol, name: addQ.symbol, monthly: +addF.amt, ccy: addF.ccy || addQ.currency, account: addF.acct, acctLabel, started: today, lastDone: "" };
    try {
      let sp: any = {}; try { sp = JSON.parse(await ariadne.readText("targets/sparplan.json")) || {}; } catch {}
      const plans = [...(sp.plans || []).filter((p: any) => p.id !== plan.id), plan];
      await ariadne.stageFile("targets/sparplan.json", JSON.stringify({ ...sp, plans }, null, 2) + "\n");
      setSparplan(plans);
      setAddMsg(`✓ 정기구매 등록됨 (월 ${money(+addF.amt, plan.ccy)}) — '🔁 정기구매'에 표시`);
    } catch { setAddMsg("저장 실패"); }
  }
  // 정기구매 이번 주기 체결 토글 (lastDone = 이번 달 YYYY-MM)
  async function sparToggle(id: string) {
    const cur = new Date().toISOString().slice(0, 7);
    const plans = sparplan.map((p: any) => p.id === id ? { ...p, lastDone: p.lastDone === cur ? "" : cur } : p);
    setSparplan(plans);
    try { let sp: any = {}; try { sp = JSON.parse(await ariadne.readText("targets/sparplan.json")) || {}; } catch {} await ariadne.stageFile("targets/sparplan.json", JSON.stringify({ ...sp, plans }, null, 2) + "\n"); } catch {}
  }
  // ── 관심종목 추가 (AI 판단 게이트) ──
  function openWatchAdd() { setWAdd({ tk: "", group: (watchG[0] && watchG[0].name) || "★ 관심 종목", q: null, msg: "", verdict: "", vReason: "", busy: false }); }
  async function wResolve() {
    if (!wAdd) return;
    const raw = `${wAdd.tk}`.trim(); if (!raw) return;
    setWAdd((w: any) => ({ ...w, q: "loading", msg: "", verdict: "", vReason: "" }));
    const tk = raw.toUpperCase();
    const isISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(tk);
    try {
      let sym: string | null = null, name = "", price: number | null = null, currency = "USD";
      if (isISIN || /[\s가-힣]/.test(raw)) {
        const ms: any[] = await (ariadne as any).searchSymbols(raw, 1);
        if (ms && ms[0]) { sym = ms[0].symbol; name = ms[0].name || ""; }
      } else {
        const cands = /[.\-=]/.test(tk) ? [tk] : [tk, `${tk}.SG`, `${tk}.DE`, `${tk}.MU`, `${tk}.L`, `${tk}.AS`];
        const r: any = await ariadne.getQuotesDetailed(cands);
        const quotes = ((r && r.quotes) || []).filter((q: any) => q && q.price);
        let hit: any = null; for (const c of cands) { hit = quotes.find((q: any) => `${q.inputSymbol || q.resolvedSymbol || q.symbol || ""}`.toUpperCase() === c); if (hit) break; } if (!hit) hit = quotes[0];
        if (hit) { sym = hit.resolvedSymbol || hit.symbol || tk; name = hit.shortname || ""; price = hit.price; currency = hit.currency || "USD"; }
      }
      if (!sym) { setWAdd((w: any) => ({ ...w, q: null, msg: "못 찾음 — 정확한 티커/ISIN/이름을 입력하세요." })); return; }
      if (price == null) { try { const qd: any = await ariadne.getQuotesDetailed([sym]); const h = ((qd && qd.quotes) || [])[0]; if (h && h.price) { price = h.price; currency = h.currency || "USD"; if (!name && h.shortname) name = h.shortname; } } catch {} }
      setWAdd((w: any) => ({ ...w, q: { symbol: sym, name, price, currency }, msg: "" }));
    } catch { setWAdd((w: any) => ({ ...w, q: null, msg: "확인 실패" })); }
  }
  async function wJudge() {
    if (!wAdd || !wAdd.q || wAdd.q === "loading") return;
    setWAdd((w: any) => ({ ...w, busy: true, verdict: "", vReason: "" }));
    try {
      const txt = await runActionText("judge_ticker", { symbol: wAdd.q.symbol, name: wAdd.q.name || "" });
      const vm = txt.match(/VERDICT:\s*(찬성|관망|반대)/);
      const verdict = vm ? vm[1] : "관망";
      const reason = txt.replace(/VERDICT:\s*(찬성|관망|반대)/, "").replace(/_AI[^\n]*_/g, "").trim();
      setWAdd((w: any) => ({ ...w, busy: false, verdict, vReason: reason }));
    } catch (e: any) { setWAdd((w: any) => ({ ...w, busy: false, verdict: "", vReason: "판단 실패: " + (e?.message || "오류") })); }
  }
  async function wAddSave() {
    if (!wAdd || !wAdd.q || wAdd.q === "loading") { setWAdd((w: any) => ({ ...w, msg: "먼저 종목을 확인하세요" })); return; }
    const sym = wAdd.q.symbol;
    try {
      let wj: any = {}; try { wj = JSON.parse(await ariadne.readText("targets/watch.json")) || {}; } catch {}
      const groups = (wj.groups || []).map((g: any) => ({ ...g, tickers: [...(g.tickers || [])] }));
      let grp = groups.find((g: any) => g.name === wAdd.group) || groups[0];
      if (!grp) { grp = { name: wAdd.group || "★ 관심 종목", tickers: [] }; groups.push(grp); }
      if (groups.some((g: any) => g.tickers.some((t: any) => baseSym(t.sym) === baseSym(sym)))) { setWAdd((w: any) => ({ ...w, msg: "이미 관심종목에 있음" })); return; }
      grp.tickers.push({ sym, name: wAdd.q.name || sym });
      await ariadne.stageFile("targets/watch.json", JSON.stringify({ ...wj, groups }, null, 2) + "\n");
      setWatchG(groups); setWatchT(groups.flatMap((g: any) => g.tickers || []));
      setWAdd((w: any) => ({ ...w, msg: `✓ ${baseSym(sym)} 관심종목에 추가됨` }));
    } catch { setWAdd((w: any) => ({ ...w, msg: "저장 실패" })); }
  }
  async function wRemove(sym: string) {
    try {
      let wj: any = {}; try { wj = JSON.parse(await ariadne.readText("targets/watch.json")) || {}; } catch {}
      const groups = (wj.groups || []).map((g: any) => ({ ...g, tickers: (g.tickers || []).filter((t: any) => baseSym(t.sym) !== baseSym(sym)) }));
      await ariadne.stageFile("targets/watch.json", JSON.stringify({ ...wj, groups }, null, 2) + "\n");
      setWatchG(groups); setWatchT(groups.flatMap((g: any) => g.tickers || []));
      setWAdd((w: any) => ({ ...w, msg: `✓ ${baseSym(sym)} 해제됨` }));
    } catch { setWAdd((w: any) => ({ ...w, msg: "해제 실패" })); }
  }
  function AddForm() {
    if (!addOpen) return null;
    const accts = view.accounts.filter((a: any) => a.type === "brokerage" && a.status === "open");
    const inp: any = { width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${T("border")}`, background: T("background"), color: T("foreground"), fontSize: 13, boxSizing: "border-box" };
    return (
      <div onClick={() => setAddOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgb(0 0 0 / 0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div onClick={(e: any) => e.stopPropagation()} className="pop" style={{ ...card, width: 460, maxWidth: "94%" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 17, fontWeight: 800 }}>➕ 보유 종목 추가</span>
            <button onClick={() => setAddOpen(false)} style={{ border: `1px solid ${T("border")}`, background: "transparent", color: T("foreground"), borderRadius: 8, width: 28, height: 28, cursor: "pointer" }}>✕</button>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={addF.tk} onChange={(e: any) => { setAddF({ ...addF, tk: e.target.value }); setAddQ(null); setAddCand([]); }} placeholder="티커 또는 종목명 (예: AAPL · MSFT)" style={inp} />
              <button onClick={() => addLookup()} style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: T("accent"), color: T("accent-foreground"), fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>🔍 확인</button>
            </div>
            {addQ === "loading" ? <div style={{ ...muted, fontSize: 12 }}>확인 중…</div>
              : addQ === "miss" ? <div style={{ fontSize: 12, color: T("warning"), display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span>❓ 못 찾음 — 정확한 티커를 입력하거나 이름으로 AI 후보를 찾으세요.</span><button onClick={addFindTicker} style={{ padding: "5px 10px", borderRadius: 7, border: `1px solid ${T("accent")}`, background: TA("accent", 0.14), color: T("accent"), fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>🤖 AI로 후보 찾기</button></div>
              : addQ ? <div style={{ fontSize: 13, padding: "8px 10px", borderRadius: 8, background: TA("success", 0.12), color: T("success") }}>✓ 이걸 찾으셨나요? <b>{addQ.symbol}</b> · 현재가 {money(addQ.price, addQ.currency)}</div>
              : null}
            {addCand.length ? <div style={{ display: "grid", gap: 6 }}>{addCand.map((c: any, i: number) => (
              <div key={i} onClick={() => { setAddF({ ...addF, tk: c.sym }); setAddCand([]); addResolve(c.sym); }} style={{ cursor: "pointer", padding: "7px 10px", borderRadius: 8, border: `1px solid ${T("border")}`, background: TA("muted", 0.25), display: "flex", gap: 8, alignItems: "baseline" }}>
                <b style={{ fontSize: 13, color: T("accent"), whiteSpace: "nowrap" }}>{c.sym}</b>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{c.nm}</span>
                <span style={{ fontSize: 10.5, ...muted }}>{c.ex}</span>
                {c.why ? <span style={{ fontSize: 10.5, ...muted, marginLeft: "auto", textAlign: "right" }}>{c.why}</span> : null}
              </div>
            ))}</div> : null}
            <Seg sm value={addF.recur ? "recur" : "once"} onChange={(v: string) => setAddF({ ...addF, recur: v === "recur" })} options={[{ value: "once", label: "보유 추가" }, { value: "recur", label: "🔁 정기구매" }]} />
            {addF.recur ? (<>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={addF.amt} onChange={(e: any) => setAddF({ ...addF, amt: e.target.value })} placeholder="월 구매금액" inputMode="decimal" style={inp} />
                <select value={addF.ccy} onChange={(e: any) => setAddF({ ...addF, ccy: e.target.value })} style={{ ...inp, width: 88, flexShrink: 0 }}>{["EUR", "USD", "KRW"].map((c) => <option key={c} value={c}>{SYM[c] || ""} {c}</option>)}</select>
              </div>
              <select value={addF.acct} onChange={(e: any) => setAddF({ ...addF, acct: e.target.value })} style={inp}>
                <option value="">계좌 선택…</option>
                {accts.map((a: any) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <button onClick={addSparplan} style={{ padding: "9px 12px", borderRadius: 8, border: "none", background: T("accent"), color: T("accent-foreground"), fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>🔁 정기구매 등록 (스테이징)</button>
              {addMsg ? <div style={{ fontSize: 12, ...muted }}>{addMsg}</div> : null}
              <div style={{ fontSize: 11, ...muted, lineHeight: 1.5 }}>※ 매월 자동매수(Sparplan) 계획을 기록. 보유표 위 <b>🔁 정기구매</b>에서 매 주기 체결 체크.</div>
            </>) : (<>
              <input value={addF.avg} onChange={(e: any) => setAddF({ ...addF, avg: e.target.value })} placeholder="평균단가" inputMode="decimal" style={inp} />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Seg sm value={addF.mode} onChange={(v: string) => setAddF({ ...addF, mode: v })} options={[{ value: "total", label: "총액" }, { value: "shares", label: "수량" }]} />
                <input value={addF.amt} onChange={(e: any) => setAddF({ ...addF, amt: e.target.value })} placeholder={addF.mode === "shares" ? "수량" : "총 구매금액"} inputMode="decimal" style={inp} />
                <select value={addF.ccy} onChange={(e: any) => setAddF({ ...addF, ccy: e.target.value })} style={{ ...inp, width: 84, flexShrink: 0 }}>{["EUR", "USD", "KRW"].map((c) => <option key={c} value={c}>{SYM[c] || ""} {c}</option>)}</select>
              </div>
              {addF.avg && addF.amt ? (() => { const av = +addF.avg, a = +addF.amt; const sh = addF.mode === "shares" ? a : a / av; const tot = addF.mode === "shares" ? a * av : a; const cc = addF.ccy || "USD"; return isFinite(sh) && sh > 0 ? <div style={{ fontSize: 11.5, ...muted }}>→ {addF.mode === "shares" ? <>총액 <b style={{ color: T("foreground") }}>{money(tot, cc)}</b></> : <>수량 <b style={{ color: T("foreground") }}>{(+sh.toFixed(4)).toLocaleString()}</b>주</>} · 평단 {money(av, cc)}</div> : null; })() : null}
              <select value={addF.acct} onChange={(e: any) => setAddF({ ...addF, acct: e.target.value })} style={inp}>
                <option value="">계좌 선택…</option>
                {accts.map((a: any) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <button onClick={addSave} style={{ padding: "9px 12px", borderRadius: 8, border: "none", background: T("foreground"), color: T("background"), fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>추가 (스테이징)</button>
              {addMsg ? <div style={{ fontSize: 12, ...muted }}>{addMsg}</div> : null}
              <div style={{ fontSize: 11, ...muted, lineHeight: 1.5 }}>※ 평균단가 + (총액/수량 택1) → 나머지 자동. 통화는 <b>실제 결제 통화</b>(TR=유로). 추가 후 <b>Apply</b> + 가격갱신 시 반영.</div>
            </>)}
          </div>
        </div>
      </div>
    );
  }

  function WatchAddForm() {
    if (!wAdd) return null;
    const inp: any = { width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${T("border")}`, background: T("background"), color: T("foreground"), fontSize: 13, boxSizing: "border-box" };
    const vc = wAdd.verdict === "찬성" ? "success" : wAdd.verdict === "반대" ? "destructive" : "warning";
    const sym = wAdd.q && wAdd.q !== "loading" ? wAdd.q.symbol : null;
    const held = sym ? m.inv.find((p: any) => baseSym(p.quote_symbol || p.ticker) === baseSym(sym)) : null;
    const inGroup = sym ? (watchG.find((g: any) => (g.tickers || []).some((t: any) => baseSym(t.sym) === baseSym(sym))) || {}).name : null;
    return (
      <div onClick={() => setWAdd(null)} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgb(0 0 0 / 0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div onClick={(e: any) => e.stopPropagation()} className="pop" style={{ ...card, width: 460, maxWidth: "94%" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 17, fontWeight: 800 }}>🔍 주식 검색</span>
            <button onClick={() => setWAdd(null)} style={{ border: `1px solid ${T("border")}`, background: "transparent", color: T("foreground"), borderRadius: 8, width: 28, height: 28, cursor: "pointer" }}>✕</button>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={wAdd.tk} onChange={(e: any) => setWAdd({ ...wAdd, tk: e.target.value, q: null, verdict: "", vReason: "" })} placeholder="티커 · ISIN · 이름 (예: NVDA)" style={inp} />
              <button onClick={wResolve} style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: T("accent"), color: T("accent-foreground"), fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>🔍 확인</button>
            </div>
            {wAdd.q === "loading" ? <div style={{ ...muted, fontSize: 12 }}>확인 중…</div>
              : wAdd.q ? <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 13, padding: "8px 10px", borderRadius: 8, background: TA("success", 0.12), color: T("success") }}>✓ <b>{wAdd.q.symbol}</b>{wAdd.q.name ? ` · ${wAdd.q.name}` : ""}{wAdd.q.price != null ? ` · ${money(wAdd.q.price, wAdd.q.currency)}` : ""}</div>
                  {held ? <div style={{ fontSize: 12.5, padding: "7px 10px", borderRadius: 8, background: TA("accent", 0.12) }}>📦 <b>{held.shares}주</b> 보유 중 · 평가 {money0(held.valBase, base)}{held.real ? <span style={{ color: retC(held.retPct), marginLeft: 6, fontWeight: 700 }}>{signPct(held.retPct)}</span> : null} <span style={{ ...muted, fontSize: 10.5 }}>{held.account_label}</span></div> : <div style={{ fontSize: 11.5, ...muted }}>미보유</div>}
                </div>
              : wAdd.msg ? <div style={{ fontSize: 12, color: T("warning") }}>{wAdd.msg}</div> : null}
            {wAdd.q && wAdd.q !== "loading" ? <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={wJudge} disabled={wAdd.busy} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${T("accent")}`, background: TA("accent", 0.14), color: T("accent"), fontWeight: 700, fontSize: 12.5, cursor: wAdd.busy ? "default" : "pointer" }}>{wAdd.busy ? "AI 판단 중… (~20초)" : "🤖 AI 판단"}</button>
              {wAdd.verdict ? <span style={{ fontSize: 12, fontWeight: 800, padding: "3px 9px", borderRadius: 6, background: TA(vc, 0.18), color: T(vc) }}>{wAdd.verdict}</span> : null}
            </div> : null}
            {wAdd.vReason ? <div style={{ fontSize: 12, ...muted, lineHeight: 1.55, padding: "8px 10px", borderRadius: 8, background: TA("muted", 0.22) }}>{wAdd.vReason}</div> : null}
            {wAdd.q && wAdd.q !== "loading" ? (inGroup ? <>
              <div style={{ fontSize: 12, ...muted }}>★ 이미 <b style={{ color: T("foreground") }}>{inGroup}</b>에 있음</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => wRemove(sym)} style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T("destructive")}`, background: "transparent", color: T("destructive"), fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>관심종목에서 해제</button>
                <button onClick={() => { setWAdd(null); openAdd(sym, wAdd.q.name); }} style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: "none", background: T("accent"), color: T("accent-foreground"), fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>매수</button>
              </div>
            </> : <>
              <select value={wAdd.group} onChange={(e: any) => setWAdd({ ...wAdd, group: e.target.value })} style={inp}>
                {watchG.map((g: any) => <option key={g.name} value={g.name}>{g.name}</option>)}
              </select>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={wAddSave} style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: "none", background: wAdd.verdict === "반대" ? T("destructive") : T("foreground"), color: T("background"), fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>{wAdd.verdict === "반대" ? "⚠️ 반대지만 추가" : "관심종목 추가"}</button>
                <button onClick={() => { setWAdd(null); openAdd(sym, wAdd.q.name); }} style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: `1px solid ${T("border")}`, background: "transparent", color: T("foreground"), fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>매수</button>
              </div>
            </>) : null}
            {wAdd.msg && wAdd.q ? <div style={{ fontSize: 12, ...muted }}>{wAdd.msg}</div> : null}
            <div style={{ fontSize: 11, ...muted, lineHeight: 1.5 }}>※ 검색 → 보유량·시세 표시 · 관심종목 추가/해제 · 매수까지 한 창에서. 추가/해제는 <b>바로 반영</b>. AI 판단은 보조용(반대여도 추가 가능).</div>
          </div>
        </div>
      </div>
    );
  }
  function SparSec() {
    if (!sparplan.length) return null;
    const cur = new Date().toISOString().slice(0, 7);
    return (
      <div style={card}>
        {secHead("sparplan", <span style={{ fontSize: 15, fontWeight: 800 }}>🔁 정기구매 <span style={{ fontSize: 11, fontWeight: 400, ...muted }}>{cur} 체결 체크</span></span>)}
        {secOpen("sparplan") && (<div style={{ marginTop: 8, display: "grid", gap: 7 }}>
          {sparplan.map((p: any, i: number) => {
            const done = p.lastDone === cur;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 9px", borderRadius: 9, background: TA("muted", 0.25) }}>
                <span onClick={() => sparToggle(p.id)} style={{ width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${done ? T("success") : T("border")}`, background: done ? T("success") : "transparent", color: T("background"), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, cursor: "pointer", flexShrink: 0 }}>{done ? "✓" : ""}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{p.name || p.sym} <span style={{ ...muted, fontSize: 10.5 }}>{p.acctLabel || p.account}</span></div>
                  <div style={{ fontSize: 11, ...muted }}>월 {money(p.monthly, p.ccy)} · 시작 {p.started}{done ? ` · ✅ ${cur} 체결` : " · 이번 달 미체결"}</div>
                </div>
                <button onClick={() => openAdd(p.sym)} style={{ padding: "4px 9px", fontSize: 11, fontWeight: 700, border: `1px solid ${T("border")}`, borderRadius: 7, background: "transparent", color: T("foreground"), cursor: "pointer", flexShrink: 0 }}>보유 반영</button>
              </div>
            );
          })}
          <div style={{ fontSize: 10.5, ...muted }}>체크 = 이번 달 자동매수 체결 표시(매 주기 갱신). '보유 반영'으로 누적분을 보유에 추가.</div>
        </div>)}
      </div>
    );
  }
  function WatchSec() {
    if (!watchG.length) return null;
    const norm = (s: any) => baseSym(s);
    return (
      <div style={card}>
        {secHead("watchsec", <span style={{ fontSize: 16, fontWeight: 800 }}>★ 관심 종목 <span style={{ fontSize: 11, fontWeight: 400, ...muted }}>라이브 · 클릭=상세/프로필</span></span>, secOpen("watchsec") ? <button onClick={() => openWatchAdd()} style={{ fontSize: 12, fontWeight: 700, padding: "5px 11px", borderRadius: 8, cursor: "pointer", border: "none", background: T("accent"), color: T("accent-foreground") }}>➕ 추가</button> : null)}
        {secOpen("watchsec") && (
        <div style={{ marginTop: 8, display: "grid", gap: 12 }}>
          {watchG.map((g: any, gi: number) => (
            <div key={gi}>
              <div style={{ fontSize: 12, fontWeight: 700, ...muted, marginBottom: 3 }}>{g.name}</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <tbody>
                  {(g.tickers || []).map((w: any, i: number) => {
                    const held = m.inv.find((p: any) => p.quote_symbol === w.sym || norm(p.ticker) === norm(w.sym));
                    const px = livePx[w.sym];
                    const ccy = livePxCcy[w.sym] || (/\.K[SQ]$/.test(w.sym) ? "KRW" : /\.(SG|DE|MU|F|DU|BE|HM|HA|L|AS|PA|MI|SW)$/.test(w.sym) ? "EUR" : "USD");
                    return (
                      <tr key={i} onClick={() => setDetail(held || { name: w.name, ticker: w.sym, quote_symbol: w.sym, currency: ccy, price_native: px || 0, shares: 0, valBase: 0, real: false, retPct: null, live_now: px != null, account_label: "관심종목", region: "", sector: "관심", flag: null, target_price: null, stop_loss: null })} style={{ cursor: "pointer", borderBottom: `1px solid ${TA("border", 0.3)}` }}>
                        <td style={{ padding: "6px 6px", textAlign: "left", fontWeight: 600 }}>{w.name} <span style={{ ...muted, fontSize: 10.5 }}>{w.sym}</span>{px != null ? <span className="live" style={{ color: T("success"), marginLeft: 4, fontSize: 9 }}>●</span> : null}</td>
                        <td style={{ padding: "6px 6px", textAlign: "right", ...muted, fontSize: 11.5 }}>{held ? `${held.shares}주` : ""}</td>
                        <td style={{ padding: "6px 6px", textAlign: "right", fontWeight: 700 }}>{px != null ? money(px, ccy) : "—"}</td>
                        <td style={{ padding: "6px 6px", textAlign: "right", color: held && held.real ? retC(held.retPct) : T("muted-foreground"), fontWeight: 600, minWidth: 46 }}>{held && held.real ? signPct(held.retPct) : ""}</td>
                        <td style={{ padding: "6px 2px", textAlign: "right", width: 40 }}><button onClick={(e: any) => { e.stopPropagation(); openAdd(w.sym, w.name); }} title="이 종목 보유 추가" style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 6, cursor: "pointer", border: `1px solid ${T("border")}`, background: "transparent", color: T("accent") }}>매수</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>)}
      </div>
    );
  }

  function MarketStrip() {
    const today = new Date().toISOString().slice(0, 10);
    return (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {IDX.map((i) => {
          const hist = idxHist[i.sym] || [];
          let prev: number | null = null;
          for (let j = hist.length - 1; j >= 0; j--) { if (hist[j].date < today) { prev = hist[j].close; break; } }
          if (prev == null && hist.length) prev = hist[0].close;
          const level = livePx[i.sym] != null ? livePx[i.sym] : (hist.length ? hist[hist.length - 1].close : null);
          const chg = level != null && prev ? (level / prev - 1) * 100 : null;
          return (
            <div key={i.sym} className="ah" style={{ ...card, flex: 1, minWidth: 122, padding: "9px 12px" }}>
              <div style={{ fontSize: 11, ...muted }}>{i.name}</div>
              <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.2 }}>{level != null ? level.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—"}</div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: chg == null ? T("muted-foreground") : retC(chg) }}>{chg == null ? "—" : signPct(chg)}</div>
            </div>
          );
        })}
        <div className="ah" style={{ ...card, flex: 1, minWidth: 122, padding: "9px 12px" }}>
          <div style={{ fontSize: 11, ...muted }}>환율 1€</div>
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>${view.fx.perEur.USD}<br />₩{Math.round(view.fx.perEur.KRW)}</div>
          <div style={{ fontSize: 10.5, color: liveCount > 0 ? T("success") : T("muted-foreground") }}>{liveCount > 0 ? `🟢 ${liveCount}종 라이브` : view.fx.date}</div>
        </div>
      </div>
    );
  }

  function HoldingsExplorer() {
    const gk = (p: any) => groupBy === "account" ? p.account_label : groupBy === "sector" ? (p.sector || "기타") : groupBy === "region" ? (REGION_KO[p.region] || p.region) : groupBy === "currency" ? `${SYM[p.currency]} ${CUR_META[p.currency]?.name || p.currency}` : groupBy === "class" ? (ASSET_KO[p.asset_class] || p.asset_class) : "전체 보유";
    const allAccts = Array.from(new Set(m.inv.map((p: any) => p.account_label)));
    const allSectors = Array.from(new Set(m.inv.map((p: any) => p.sector || "기타")));
    const q = search.trim().toLowerCase();
    const filtered = m.inv.filter((p: any) => {
      if (fAcct.length && !fAcct.includes(p.account_label)) return false;
      if (fSector.length && !fSector.includes(p.sector || "기타")) return false;
      if (pnlF === "win" && !(p.real && p.retPct >= 0)) return false;
      if (pnlF === "loss" && !(p.real && p.retPct < 0)) return false;
      if (q && !(`${p.name}`.toLowerCase().includes(q) || `${p.ticker}`.toLowerCase().includes(q))) return false;
      return true;
    });
    const gmap: Record<string, any> = {};
    for (const p of filtered) { const k = gk(p); const g = (gmap[k] = gmap[k] || { key: k, pos: [], value: 0, cost: 0, pl: 0 }); g.pos.push(p); g.value += p.valBase; g.cost += p.real ? p.costBase : 0; g.pl += p.plBase; }
    const groups = Object.values(gmap).map((g: any) => ({ ...g, ret: g.cost ? (g.pl / g.cost) * 100 : 0 })).sort((a: any, b: any) => b.value - a.value);
    const fTotal = filtered.reduce((s: number, p: any) => s + p.valBase, 0);
    const fPL = filtered.reduce((s: number, p: any) => s + p.plBase, 0);
    const fCost = filtered.reduce((s: number, p: any) => s + (p.real ? p.costBase : 0), 0);
    const toggle = (arr: string[], setArr: any, v: string) => setArr(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
    const active = fAcct.length || fSector.length || pnlF !== "all" || q;
    const chip = (label: string, on: boolean, onClick: any) => <button key={label} onClick={onClick} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 14, cursor: "pointer", border: `1px solid ${on ? T("accent") : T("border")}`, background: on ? TA("accent", 0.18) : "transparent", color: on ? T("accent") : T("muted-foreground"), margin: "2px 3px 0 0" }}>{label}</button>;
    return (
      <div style={card}>
        {secHead("holdings", <span style={{ fontSize: 15, fontWeight: 800 }}>📂 보유 자산 <span style={{ fontSize: 11.5, fontWeight: 400, ...muted }}>{filtered.length}종 · {money0(fTotal, base)}{fCost ? <span style={{ color: retC((fPL / fCost) * 100), marginLeft: 4 }}>{signPct((fPL / fCost) * 100)}</span> : null}{nativeMode ? <span style={{ marginLeft: 5 }}>· 행=원본통화</span> : null}</span></span>, secOpen("holdings") ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Seg sm value={groupBy} onChange={setGroupBy} options={GROUPS} />
            <Seg sm value={sortBy} onChange={setSortBy} options={[{ value: "value", label: "금액" }, { value: "ret", label: "수익률" }, { value: "name", label: "이름" }]} />
            <button onClick={() => { setAddOpen(true); setAddQ(null); setAddMsg(""); }} style={{ fontSize: 12, fontWeight: 700, padding: "5px 11px", borderRadius: 8, cursor: "pointer", border: "none", background: T("accent"), color: T("accent-foreground") }}>➕ 추가</button>
            <button onClick={() => setShowFilter(!showFilter)} style={{ fontSize: 12, fontWeight: 600, padding: "5px 11px", borderRadius: 8, cursor: "pointer", border: `1px solid ${active ? T("accent") : T("border")}`, background: "transparent", color: active ? T("accent") : T("foreground") }}>🔍 필터{(fAcct.length + fSector.length) ? ` ${fAcct.length + fSector.length}` : ""}</button>
          </div>
        ) : null)}
        {secOpen("holdings") && (<div style={{ marginTop: 10 }}>
        {showFilter ? (
          <div style={{ background: TA("muted", 0.25), borderRadius: 10, padding: 12, marginBottom: 10, display: "grid", gap: 8 }}>
            <input value={search} onChange={(e: any) => setSearch(e.target.value)} placeholder="종목·티커 검색…" style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: `1px solid ${T("border")}`, background: T("background"), color: T("foreground"), fontSize: 13, boxSizing: "border-box" }} />
            <div><span style={{ fontSize: 11, ...muted, marginRight: 4 }}>계좌</span>{allAccts.map((a) => chip(a, fAcct.includes(a), () => toggle(fAcct, setFAcct, a)))}</div>
            <div><span style={{ fontSize: 11, ...muted, marginRight: 4 }}>섹터</span>{allSectors.map((s) => chip(s, fSector.includes(s), () => toggle(fSector, setFSector, s)))}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span style={{ fontSize: 11, ...muted }}>손익</span><Seg sm value={pnlF} onChange={setPnlF} options={[{ value: "all", label: "전체" }, { value: "win", label: "이익" }, { value: "loss", label: "손실" }]} />{active ? <button onClick={() => { setFAcct([]); setFSector([]); setPnlF("all"); setSearch(""); }} style={{ fontSize: 11, ...muted, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>초기화</button> : null}</div>
          </div>
        ) : null}
        {groups.map((g: any) => {
          const open = !collapsed.includes(g.key);
          return (
            <div key={g.key} style={{ marginBottom: 7 }}>
              <div className="gh" onClick={() => setCollapsed(open ? [...collapsed, g.key] : collapsed.filter((k) => k !== g.key))} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", background: TA("muted", 0.3), borderRadius: 8, cursor: "pointer" }}>
                <span className="chev" style={{ fontSize: 10, ...muted, width: 10, transform: open ? "rotate(90deg)" : "none" }}>▸</span>
                <span style={{ fontWeight: 700, fontSize: 13.5, flex: 1 }}>{g.key} <span style={{ ...muted, fontSize: 11, fontWeight: 400 }}>{g.pos.length}</span></span>
                <span style={{ fontSize: 11, ...muted, minWidth: 34, textAlign: "right" }}>{((g.value / (fTotal || 1)) * 100).toFixed(0)}%</span>
                <span style={{ fontWeight: 700, fontSize: 13, minWidth: 92, textAlign: "right" }}>{money0(g.value, base)}</span>
                <span style={{ fontSize: 12, fontWeight: 600, minWidth: 52, textAlign: "right", color: g.cost ? retC(g.ret) : T("muted-foreground") }}>{g.cost ? signPct(g.ret) : "—"}</span>
              </div>
              {open ? (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <tbody>
                    {[...g.pos].sort((a: any, b: any) => sortBy === "ret" ? ((b.retPct ?? -1e9) - (a.retPct ?? -1e9)) : sortBy === "name" ? `${a.name}`.localeCompare(`${b.name}`) : (b.valBase - a.valBase)).map((p: any, i: number) => (
                      <tr key={i} onClick={() => setDetail(p)} style={{ cursor: "pointer" }}>
                        <td style={{ ...td, textAlign: "left", borderBottom: `1px solid ${TA("border", 0.3)}` }}><b>{p.name}</b> <span style={{ ...muted, fontSize: 10.5 }}>{p.ticker}{groupBy !== "account" ? ` · ${p.account_label}` : ""}</span>{p.flag ? <span title="알림" style={{ marginLeft: 4, fontSize: 10 }}>{p.flag === "target" ? "🎯" : p.flag === "stop" ? "🛑" : p.flag === "loss" ? "⚠️" : "✨"}</span> : null}{p.live_now ? <span className="live" style={{ color: T("success"), marginLeft: 4, fontSize: 9 }}>●</span> : null}</td>
                        <td style={{ ...td, ...muted, borderBottom: `1px solid ${TA("border", 0.3)}` }}>{p.shares}</td>
                        <td style={{ ...td, fontWeight: 600, borderBottom: `1px solid ${TA("border", 0.3)}` }}>{nativeMode && p.valNative != null ? money0(p.valNative, p.natCcy) : money0(p.valBase, base)}</td>
                        <td style={{ ...td, color: p.real ? retC(p.retPct) : T("muted-foreground"), fontWeight: 600, borderBottom: `1px solid ${TA("border", 0.3)}`, minWidth: 52 }}>{p.real ? signPct(p.retPct) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          );
        })}
        {!groups.length ? <div style={{ ...muted, fontSize: 12, textAlign: "center", padding: 12 }}>필터에 맞는 자산 없음</div> : null}
        </div>)}
      </div>
    );
  }

  function Assets() {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <Strip />
        {MarketStrip()}
        {deploy ? DeployTracker() : null}
        <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <span style={{ fontSize: 12, ...muted }}>합산 ({base} 환산) · {liveCount > 0 ? <span style={{ color: T("success"), fontWeight: 600 }}>🟢 라이브 {liveCount}종(60초)</span> : <span>일일 {view.fx.date}</span>}</span>
            <div className="grad" style={{ fontSize: 23, fontWeight: 800, letterSpacing: "-0.01em" }}><CountUp value={m.netBase} fmt={(n: number) => money0(n, base)} /></div>
            <div style={{ fontSize: 12, ...muted }}>투자 {money0(m.investedBase, base)} · 현금 {money0(m.cashBase, base)}</div>
          </div>
          <Seg value={nativeMode ? "native" : base} onChange={(v: string) => { if (v === "native") setNativeMode(true); else { setNativeMode(false); setBase(v); } }} options={[...CCYS.map((c) => ({ value: c, label: `${SYM[c]} ${c}` })), { value: "native", label: "원본" }]} />
        </div>
        <Trend />
        <Alloc />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{m.order.map((c) => <CurCard key={c} c={c} />)}</div>
        {SparSec()}
        {HoldingsExplorer()}
        {WatchSec()}
        <div style={{ ...muted, fontSize: 11, textAlign: "center" }}>● = 라이브 시세 · ◦ = 수동/시드가 · 1€={view.fx.perEur.USD}$={Math.round(view.fx.perEur.KRW)}₩</div>
      </div>
    );
  }

  function Analysis() {
    const top = m.inv.slice(0, 10);
    let cum = 0;
    const sec = topSlices(m.bySector, 6);
    const reg = topSlices(m.byRegion, 6);
    const HBUCK = [{ k: "단기 ≤2년", lo: 0, hi: 24 }, { k: "중기 ~5년", lo: 25, hi: 60 }, { k: "장기 ~10년", lo: 61, hi: 120 }, { k: "초장기 20년+", lo: 121, hi: 1e9 }];
    const hmap: Record<string, any> = {};
    for (const p of m.inv) { const h = p.horizon_months; const b = h == null ? "미지정" : (HBUCK.find((x) => h >= x.lo && h <= x.hi)?.k || "미지정"); const o = (hmap[b] = hmap[b] || { k: b, value: 0, cost: 0, pl: 0, n: 0 }); o.value += p.valBase; o.cost += p.real ? p.costBase : 0; o.pl += p.plBase; o.n++; }
    const hbuckets = [...HBUCK.map((x) => x.k), "미지정"].map((k) => hmap[k]).filter(Boolean).map((o: any) => ({ ...o, ret: o.cost ? (o.pl / o.cost) * 100 : 0 }));
    const divRows = m.inv.map((p: any) => { const ps = div[p.quote_symbol]; if (!ps) return null; const annualBase = m.toBase(ps * p.shares, p.currency); return { ...p, annualBase, yld: p.valBase ? (annualBase / p.valBase) * 100 : 0 }; }).filter(Boolean).sort((a: any, b: any) => b.annualBase - a.annualBase);
    const divTotal = divRows.reduce((s: number, r: any) => s + r.annualBase, 0);
    const divYield = m.investedBase ? (divTotal / m.investedBase) * 100 : 0;
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <Strip />
        <div style={card}>
          {secHead("conc", <span style={{ fontSize: 15, fontWeight: 800 }}>🎯 집중도 — 상위 10 종목 (투자분 대비)</span>)}
          {secOpen("conc") && (<div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, ...muted, marginBottom: 8 }}>상위1 {m.conc.top1.toFixed(0)}% · 상위5 {m.conc.top5.toFixed(0)}% · 상위10 {m.conc.top10.toFixed(0)}% — 집중도 높을수록 단일 충격에 취약.</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr><th style={{ ...thS, textAlign: "left" }}>#</th><th style={{ ...thS, textAlign: "left" }}>종목</th><th style={thS}>평가액</th><th style={thS}>수익률</th><th style={thS}>비중</th><th style={{ ...thS, textAlign: "left", paddingLeft: 12 }}>누적</th></tr></thead>
            <tbody>
              {top.map((p: any, i: number) => { const w = (p.valBase / m.investedBase) * 100; cum += w; return (
                <tr key={i}>
                  <td style={{ ...td, textAlign: "left", ...muted }}>{i + 1}</td>
                  <td style={{ ...td, textAlign: "left" }}><b>{p.name}</b> <span style={{ ...muted, fontSize: 11 }}>{REGION_KO[p.region] || p.region}·{p.sector}</span></td>
                  <td style={td}>{money0(p.valBase, base)}</td>
                  <td style={{ ...td, color: p.real ? retC(p.retPct) : T("muted-foreground"), fontWeight: 600 }}>{p.real ? signPct(p.retPct) : "—"}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{w.toFixed(1)}%</td>
                  <td style={{ ...td, textAlign: "left", paddingLeft: 12 }}><Bar pct={cum} color="info" /></td>
                </tr>
              ); })}
            </tbody>
          </table>
          </div>)}
        </div>
        <div style={card}>
          {secHead("secpl", <span style={{ fontSize: 15, fontWeight: 800 }}>💰 섹터별 수익 기여 <span style={{ fontSize: 11, fontWeight: 400, ...muted }}>(평가손익 {base})</span></span>)}
          {secOpen("secpl") && (<div style={{ marginTop: 8 }}>
          <div style={{ overflowX: "auto" }}><BarChart data={[...m.bySectorPL].sort((a: any, b: any) => Math.abs(b.pl) - Math.abs(a.pl)).slice(0, 8).map((s: any) => ({ label: s.sector.length > 6 ? s.sector.slice(0, 6) : s.sector, value: Math.round(s.pl) }))} width={760} height={210} /></div>
          <div style={{ ...muted, fontSize: 11, margin: "2px 0 8px" }}>막대 = 평가손익(절대액 상위 8 섹터). 양수=이익 기여, 음수=손실.</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr><th style={{ ...thS, textAlign: "left" }}>섹터</th><th style={thS}>평가액</th><th style={thS}>평가손익</th><th style={thS}>수익률</th><th style={thS}>기여</th></tr></thead>
            <tbody>
              {m.bySectorPL.map((s: any, i: number) => (
                <tr key={i}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{s.sector}</td>
                  <td style={td}>{money0(s.val, base)}</td>
                  <td style={{ ...td, color: retC(s.pl), fontWeight: 600 }}>{s.pl >= 0 ? "+" : "-"}{money0(Math.abs(s.pl), base)}</td>
                  <td style={{ ...td, color: s.cost ? retC(s.ret) : T("muted-foreground") }}>{s.cost ? signPct(s.ret) : "—"}</td>
                  <td style={{ ...td, ...muted }}>{m.totPL ? Math.round((s.pl / m.totPL) * 100) + "%" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>)}
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ ...card, flex: 1, minWidth: 300 }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>지역 배분</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>{Donut({ data: reg, size: 180 })}<Legend slices={reg} base={base} /></div>
          </div>
          <div style={{ ...card, flex: 1, minWidth: 300 }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>섹터 배분</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>{Donut({ data: sec, size: 180 })}<Legend slices={sec} base={base} /></div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ ...card, flex: 1, minWidth: 280 }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6, color: T("success") }}>📈 수익 상위 5</div>
            {m.best.slice(0, 5).map((p: any, i: number) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, borderBottom: `1px solid ${TA("border", 0.35)}` }}>
                <span>{p.name} <span style={{ ...muted, fontSize: 11 }}>{p.account_label}</span></span><span style={{ color: retC(p.retPct), fontWeight: 700 }}>{signPct(p.retPct)}</span>
              </div>
            ))}
          </div>
          <div style={{ ...card, flex: 1, minWidth: 280 }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6, color: T("destructive") }}>📉 손실 상위 5</div>
            {m.best.slice(-5).reverse().map((p: any, i: number) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, borderBottom: `1px solid ${TA("border", 0.35)}` }}>
                <span>{p.name} <span style={{ ...muted, fontSize: 11 }}>{p.account_label}</span></span><span style={{ color: retC(p.retPct), fontWeight: 700 }}>{signPct(p.retPct)}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={card}>
          {secHead("horizon", <span style={{ fontSize: 15, fontWeight: 800 }}>⏳ 시간지평 버킷 <span style={{ fontSize: 11, fontWeight: 400, ...muted }}>(목표 보유기간)</span></span>)}
          {secOpen("horizon") && (<div style={{ marginTop: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr><th style={{ ...thS, textAlign: "left" }}>지평</th><th style={thS}>종목</th><th style={thS}>평가액</th><th style={thS}>수익률</th><th style={{ ...thS, textAlign: "left", paddingLeft: 12 }}>비중</th></tr></thead>
            <tbody>
              {hbuckets.map((b: any) => (
                <tr key={b.k}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{b.k}</td>
                  <td style={{ ...td, ...muted }}>{b.n}</td>
                  <td style={td}>{money0(b.value, base)}</td>
                  <td style={{ ...td, color: b.cost ? retC(b.ret) : T("muted-foreground"), fontWeight: 600 }}>{b.cost ? signPct(b.ret) : "—"}</td>
                  <td style={{ ...td, textAlign: "left", paddingLeft: 12, width: 110 }}><Bar pct={(b.value / (m.investedBase || 1)) * 100} color="info" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ ...muted, fontSize: 11, marginTop: 6 }}>단기(≤2년) 비중이 크면 회전·세금·변동성↑ — 장기 비중을 늘릴수록 안정적.</div>
          </div>)}
        </div>
        <div style={card}>
          {secHead("divtrack", <span style={{ fontSize: 15, fontWeight: 800 }}>💵 배당 트래커</span>, secOpen("divtrack") ? <span style={{ fontSize: 12.5, ...muted }}>연 예상 <b style={{ color: T("foreground") }}>{money0(divTotal, base)}</b> · 수익률 <b style={{ color: T("success") }}>{divYield.toFixed(2)}%</b></span> : null)}
          {secOpen("divtrack") && (<div style={{ marginTop: 8 }}>
          {divRows.length ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr><th style={{ ...thS, textAlign: "left" }}>종목</th><th style={thS}>보유</th><th style={thS}>연 배당</th><th style={thS}>수익률</th></tr></thead>
              <tbody>
                {divRows.map((r: any, i: number) => (
                  <tr key={i}>
                    <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{r.name} <span style={{ ...muted, fontSize: 10.5 }}>{r.account_label}</span></td>
                    <td style={{ ...td, ...muted }}>{r.shares}</td>
                    <td style={td}>{money0(r.annualBase, base)}</td>
                    <td style={{ ...td, color: T("success") }}>{r.yld.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div style={{ ...muted, fontSize: 12, padding: 10 }}>배당 데이터 불러오는 중… (무배당 종목 제외)</div>}
          </div>)}
        </div>
      </div>
    );
  }

  function Sell() {
    const cand = m.inv.map((p: any) => {
      const reason = p.real && p.retPct < -10 ? `손실 ${p.retPct.toFixed(0)}%` : p.valBase < 1000000 ? "소액·롱테일" : null;
      return { ...p, reason };
    }).filter((p: any) => p.reason).sort((a: any, b: any) => (a.retPct ?? 0) - (b.retPct ?? 0));
    const fold = ["amzn", "meta", "dis", "nflx"];
    const keep = ["tsla", "pltr"];
    const euUS = m.inv.filter((p: any) => ["revolut_investment", "bux", "trade_republic"].includes(p.account_id));
    const agg: Record<string, any> = {};
    for (const p of euUS) { const k = p.instrument_id; agg[k] = agg[k] || { id: k, name: p.name, eur: 0 }; agg[k].eur += m.toBase(p.nv, p.currency) / m.per[base] * m.per["EUR"]; }
    const aggList = Object.values(agg).sort((a: any, b: any) => b.eur - a.eur);
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div style={card}>
          {secHead("sell-recon", <span style={{ fontSize: 16, fontWeight: 800 }}>✂️ 유로 지갑 재구성 — 메가캡 ↔ ETF</span>)}
          {secOpen("sell-recon") && (<div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, ...muted, marginBottom: 10 }}>지수가 이미 담는 메가캡은 ETF로 흡수(개별 재매수 X), 지수로 못 잡는 고베타만 fun으로. fun 예산 ~€6,400.</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr><th style={{ ...thS, textAlign: "left" }}>종목</th><th style={thS}>현재(€)</th><th style={{ ...thS, textAlign: "left", paddingLeft: 12 }}>판정</th></tr></thead>
            <tbody>
              {aggList.map((a: any, i: number) => { const f = fold.includes(a.id), k = keep.includes(a.id); const tone = k ? "success" : f ? "warning" : "muted-foreground"; const lab = k ? "fun 유지" : f ? "→ ETF 흡수" : "검토"; return (
                <tr key={i}><td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{a.name}</td><td style={td}>€{Math.round(a.eur).toLocaleString()}</td><td style={{ ...td, textAlign: "left", paddingLeft: 12 }}><span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: TA(tone, 0.16), color: T(tone) }}>{lab}</span></td></tr>
              ); })}
            </tbody>
          </table>
          </div>)}
        </div>
        <div style={card}>
          {secHead("sell-cand", <span style={{ fontSize: 16, fontWeight: 800 }}>🗑️ 정리(매도) 후보 — {cand.length}개</span>)}
          {secOpen("sell-cand") && (<div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, ...muted, marginBottom: 10 }}>손실 −10%↓ 또는 소액(롱테일). 주요 보유 종목은 자동 제외.</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr><th style={{ ...thS, textAlign: "left" }}>종목</th><th style={{ ...thS, textAlign: "left" }}>계좌</th><th style={thS}>평가액</th><th style={thS}>수익률</th><th style={{ ...thS, textAlign: "left", paddingLeft: 12 }}>사유</th></tr></thead>
            <tbody>
              {cand.map((p: any, i: number) => (
                <tr key={i}>
                  <td style={{ ...td, textAlign: "left" }}><b>{p.name}</b> <span style={{ ...muted, fontSize: 11 }}>{p.ticker}</span></td>
                  <td style={{ ...td, textAlign: "left", ...muted, fontSize: 11 }}>{p.account_label}</td>
                  <td style={td}>{money0(p.valBase, base)}</td>
                  <td style={{ ...td, color: p.real ? retC(p.retPct) : T("muted-foreground") }}>{p.real ? signPct(p.retPct) : "—"}</td>
                  <td style={{ ...td, textAlign: "left", paddingLeft: 12, fontSize: 12 }}>{p.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ ...muted, fontSize: 11, marginTop: 8 }}>회수 자금은 코어 ETF / CMA로. (개별 매도는 본인 확인 후)</div>
          </div>)}
        </div>
      </div>
    );
  }

  function DeployTracker() {
    if (!deploy) return null;
    const E = deploy.eur, K = deploy.krw;
    const nowSum = E.sleeves.reduce((s: number, x: any) => s + x.now, 0);
    const moSum = E.sleeves.reduce((s: number, x: any) => s + x.monthly, 0);
    const toEur = (nv: number, c: string) => nv / (m.per[c] || 1);
    const heldFor = (tk: string) => { if (!tk || tk === "—") return 0; const want = tk.split("/").map((s: string) => s.trim().toUpperCase()); return m.inv.filter((p: any) => want.includes(`${p.ticker}`.toUpperCase()) || want.includes(`${p.instrument_id}`.toUpperCase())).reduce((s: number, p: any) => s + toEur(p.nv, p.currency), 0); };
    const heldSum = E.sleeves.reduce((s: number, x: any) => s + heldFor(x.ticker), 0);
    return (
      <div style={{ ...card, borderTop: `3px solid ${T("accent")}` }}>
        {secHead("deploy", <span style={{ fontSize: 16, fontWeight: 800 }}>🚀 배치 계획 — €{E.pool.toLocaleString()} <span style={{ fontSize: 12, fontWeight: 600, ...muted }}>({E.now_pct}% 즉시 + {E.dca_months}개월 분할)</span></span>)}
        {secOpen("deploy") && (<div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12, ...muted, marginBottom: 10 }}>{deploy.market}</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr><th style={{ ...thS, textAlign: "left" }}>슬리브</th><th style={thS}>목표</th><th style={thS}>즉시</th><th style={thS}>보유</th><th style={thS}>월 적립</th><th style={{ ...thS, textAlign: "left", paddingLeft: 12 }}>진행</th></tr></thead>
          <tbody>
            {E.sleeves.map((x: any) => { const held = heldFor(x.ticker); return (
              <tr key={x.name}>
                <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{x.name} {x.ticker && x.ticker !== "—" ? <span style={{ ...muted, fontSize: 11 }}>{x.ticker}</span> : null}</td>
                <td style={td}>{money0(x.target, "EUR")}</td>
                <td style={{ ...td, color: x.now > 0 ? T("success") : T("muted-foreground"), fontWeight: 600 }}>{x.now > 0 ? money0(x.now, "EUR") : "—"}</td>
                <td style={{ ...td, color: held > 0 ? T("foreground") : T("muted-foreground"), fontWeight: 600 }}>{held > 0 ? money0(held, "EUR") : "—"}</td>
                <td style={td}>{x.monthly > 0 ? money0(x.monthly, "EUR") + "/월" : "—"}</td>
                <td style={{ ...td, textAlign: "left", paddingLeft: 12, width: 90 }}><Bar pct={(held / x.target) * 100} color={x.kind === "bond" || x.kind === "gold" ? "info" : x.kind === "cash" ? "muted-foreground" : "accent"} /></td>
              </tr>
            ); })}
          </tbody>
        </table>
        <div style={{ fontSize: 12.5, marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <span>즉시 계획 <b style={{ color: T("success") }}>€{nowSum.toLocaleString()}</b></span>
          <span>실제 보유 <b>€{Math.round(heldSum).toLocaleString()}</b> <span style={{ ...muted, fontSize: 11 }}>(목표의 {Math.round((heldSum / E.pool) * 100)}%)</span></span>
          <span>월 분할 <b>€{moSum.toLocaleString()}</b> × {E.dca_months}개월 (주식만)</span>
        </div>
        <div style={{ fontSize: 11.5, ...muted, marginTop: 6 }}>📅 <b>Phase2</b> : 급여 시작 후 매월 자동적립으로 인계 — Sparplan (금액 TBD).</div>
        <div style={{ fontSize: 11.5, ...muted, marginTop: 8, marginBottom: 4, fontWeight: 700 }}>📉 하락 시 가속 (캘린더 무시):</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {deploy.rule_accelerate.map((r: any, i: number) => (
            <span key={i} style={{ fontSize: 11.5, padding: "3px 8px", borderRadius: 6, background: TA("warning", 0.14), color: T("warning") }}><b>{r.trig}</b> → {r.act}</span>
          ))}
        </div>
        <div style={{ ...muted, fontSize: 11.5, marginTop: 10, borderTop: `1px solid ${TA("border", 0.5)}`, paddingTop: 8 }}>🌐 보조 통화 ₩{(K.pool / 1e6).toFixed(0)}M: 월 적립 ₩{(K.sleeves[0].monthly / 1e4).toFixed(0)}만 DCA · 장기 ₩{(K.sleeves[1].target / 1e4).toFixed(0)}만 · 비상금 ₩{(K.sleeves[3].target / 1e4).toFixed(0)}만 유지. <b>급여 시작 → Phase2 자동적립 인계.</b></div>
        </div>)}
      </div>
    );
  }

  function PlanView() {
    if (!plan) return <div style={muted}>계획 없음</div>;
    // 목표 vs 실제 (통화)
    const drift = plan.major.map((x: any) => {
      const c = x.label.includes("원화") ? "KRW" : x.label.includes("달러") ? "USD" : "EUR";
      const act = ((m.byCur[c]?.baseTotal || 0) / m.netBase) * 100;
      return { label: x.label, target: x.pct, actual: act, gap: act - x.pct };
    });
    const orders: any[] = [];
    if (deploy?.eur) {
      const toEur = (nv: number, c: string) => nv / (m.per[c] || 1);
      const heldFor = (tk: string) => { if (!tk || tk === "—") return 0; const want = tk.split("/").map((s: string) => s.trim().toUpperCase()); return m.inv.filter((p: any) => want.includes(`${p.ticker}`.toUpperCase())).reduce((s: number, p: any) => s + toEur(p.nv, p.currency), 0); };
      for (const sl of deploy.eur.sleeves) { if (sl.kind === "cash") continue; const gap = sl.target - heldFor(sl.ticker); if (gap > 50) orders.push({ side: "buy", name: sl.name, amt: gap, note: sl.monthly ? `이번달 €${sl.monthly}` : "일시" }); }
      const fold = ["amzn", "meta", "dis", "nflx"];
      const fAgg: Record<string, any> = {};
      for (const p of m.inv.filter((p: any) => fold.includes(p.instrument_id) && ["revolut_investment", "bux", "trade_republic"].includes(p.account_id))) { const a = (fAgg[p.instrument_id] = fAgg[p.instrument_id] || { name: p.name, amt: 0 }); a.amt += toEur(p.nv, p.currency); }
      for (const k in fAgg) orders.push({ side: "sell", name: fAgg[k].name, amt: fAgg[k].amt, note: "메가캡 → ETF" });
    }
    return (
      <div style={{ display: "grid", gap: 16 }}>
        {orders.length ? (
          <div style={{ ...card, borderTop: `3px solid ${T("success")}` }}>
            {secHead("rebal", <span style={{ fontSize: 15, fontWeight: 800 }}>📋 리밸런싱 주문 도우미 <span style={{ fontSize: 11, fontWeight: 400, ...muted }}>(목표 − 보유)</span></span>)}
            {secOpen("rebal") && (<div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, ...muted, marginBottom: 8 }}>유로 지갑 목표에 맞춘 구체 주문. 메가캡 매도 → 코어 ETF 매수. 실제 체결은 본인 확인 후.</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr><th style={{ ...thS, textAlign: "left" }}>구분</th><th style={{ ...thS, textAlign: "left" }}>종목</th><th style={thS}>금액</th><th style={{ ...thS, textAlign: "left", paddingLeft: 12 }}>비고</th></tr></thead>
              <tbody>
                {orders.map((o: any, i: number) => (
                  <tr key={i}>
                    <td style={{ ...td, textAlign: "left" }}><span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: TA(o.side === "buy" ? "success" : "destructive", 0.16), color: T(o.side === "buy" ? "success" : "destructive") }}>{o.side === "buy" ? "매수" : "매도"}</span></td>
                    <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{o.name}</td>
                    <td style={{ ...td, fontWeight: 700 }}>€{Math.round(o.amt).toLocaleString()}</td>
                    <td style={{ ...td, textAlign: "left", paddingLeft: 12, ...muted, fontSize: 12 }}>{o.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>)}
          </div>
        ) : null}
        <div style={card}>
          {secHead("drift", <span style={{ fontSize: 15, fontWeight: 800 }}>⚖️ 목표 vs 실제 — 통화 드리프트</span>)}
          {secOpen("drift") && (<div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, ...muted, marginBottom: 10 }}>막대 = 실제−목표(%p). 양수=초과, 음수=부족. 분기 리밸런싱은 ±5%p 벗어난 것만.</div>
          <div style={{ overflowX: "auto" }}><BarChart data={drift.map((d: any) => ({ label: d.label.replace(/[^가-힣]/g, ""), value: +d.gap.toFixed(1) }))} width={560} height={200} /></div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 6 }}>
            <thead><tr><th style={{ ...thS, textAlign: "left" }}>통화</th><th style={thS}>목표</th><th style={thS}>실제</th><th style={thS}>드리프트</th></tr></thead>
            <tbody>{drift.map((d: any) => (
              <tr key={d.label}><td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{d.label}</td><td style={td}>{d.target}%</td><td style={td}>{d.actual.toFixed(0)}%</td><td style={{ ...td, color: Math.abs(d.gap) > 5 ? T("warning") : T("muted-foreground"), fontWeight: 600 }}>{signPct(d.gap).replace("%", "%p")}</td></tr>
            ))}</tbody>
          </table>
          </div>)}
        </div>
        <div style={card}>
          {secHead("cashdeploy", <span style={{ fontSize: 14, fontWeight: 800 }}>💸 현금 배치 진행</span>)}
          {secOpen("cashdeploy") && (<div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, ...muted, marginBottom: 8 }}>현재 현금 {cashPct.toFixed(0)}% → 목표 18%. 약 {money0(Math.max(0, m.cashBase - m.netBase * 0.18), base)} 배치 대기(6~8개월 DCA).</div>
          <div style={{ height: 22, borderRadius: 6, background: TA("muted", 0.4), position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", inset: 0, width: `${Math.min(100, (18 / cashPct) * 100)}%`, background: TA("success", 0.5) }} />
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>목표까지 {((cashPct - 18) / cashPct * 100).toFixed(0)}% 더 배치</div>
          </div>
          </div>)}
        </div>
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>대분류 — 통화 3개 (서로 안 섞음)</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><tbody>
            {plan.major.map((x: any) => (<tr key={x.label}><td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{x.label}</td><td style={td}>₩{(x.krw / 1e6).toFixed(1)}M</td><td style={{ ...td, textAlign: "left", paddingLeft: 12, width: 120 }}><Bar pct={x.pct} /></td></tr>))}
          </tbody></table>
        </div>
        {plan.accounts.map((a: any) => (
          <div key={a.id} style={card}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{a.label}</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}><tbody>
              {a.rows.map((r: any, i: number) => (
                <tr key={i} style={{ background: `rgb(var(--${plan.cats?.[r.cat]?.color || "muted-foreground"}) / 0.12)` }}>
                  <td style={{ ...td, width: 64, fontWeight: 800, color: T(plan.cats?.[r.cat]?.color || "muted-foreground"), borderBottom: "none" }}>{r.pct ? r.pct + "%" : "유지"}</td>
                  <td style={{ ...td, textAlign: "left", fontWeight: 600, borderBottom: "none" }}>{r.name}</td>
                  <td style={{ ...td, width: 64, fontSize: 11, ...muted, borderBottom: "none" }}>{plan.cats?.[r.cat]?.label}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        ))}
        <div style={{ ...muted, fontSize: 11, textAlign: "center" }}>목표 배분 · 상세 = 투자계획_통합_2026-06.md</div>
      </div>
    );
  }

  return (
    <div className="axs" onMouseMove={(e: any) => { const c = e.target && e.target.closest && e.target.closest(".ah"); if (c) { const r = c.getBoundingClientRect(); c.style.setProperty("--mx", (e.clientX - r.left) + "px"); c.style.setProperty("--my", (e.clientY - r.top) + "px"); } }} style={{ color: T("foreground"), fontFamily: "system-ui,-apple-system,sans-serif", paddingBottom: 36, position: "relative", minHeight: "100vh", background: T("background") }}>
      <style>{AXS_CSS}</style>
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: TA("background", 0.6), backdropFilter: "blur(18px) saturate(1.4)", WebkitBackdropFilter: "blur(18px) saturate(1.4)", borderBottom: `1px solid rgb(255 255 255 / 0.07)`, padding: "11px 18px" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 800, fontSize: 15 }}>자산 현황</span>
            <Seg value={page} onChange={setPage} options={[{ value: "hub", label: "허브" }, { value: "assets", label: "자산현황" }, { value: "analysis", label: "분석" }, { value: "sell", label: "정리" }, { value: "plan", label: "계획" }]} />
          </div>
        </div>
      </div>
      <div key={page} className="fin" style={{ maxWidth: 1000, margin: "0 auto", padding: 18, position: "relative", zIndex: 1 }}>{page === "hub" ? Hub() : page === "assets" ? Assets() : page === "analysis" ? Analysis() : page === "sell" ? Sell() : PlanView()}</div>
      {DetailPanel()}
      {AddForm()}
      {WatchAddForm()}
    </div>
  );
}
