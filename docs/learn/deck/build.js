/* Ariadne RAG + 하네스 교육 덱 — pptxgenjs. 한글: Apple SD Gothic Neo. */
const P = require("pptxgenjs");
const pres = new P();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
pres.author = "Ariadne";
pres.title = "Ariadne 완전 해설";

// ── palette (MD 다이어그램과 동일 계열) ──
const C = {
  dark: "0F172A", navy: "1E40AF", teal: "0E7C66", purple: "7C3AED", amber: "B45309",
  ink: "1E293B", mute: "64748B", white: "FFFFFF", line: "E2E8F0",
  tealBg: "E6F2EF", navyBg: "E8EDFB", purpleBg: "F1E9FC", amberBg: "FBEFE2", slate: "F1F5F9",
};
const F = "Apple SD Gothic Neo";
const MONO = "Menlo";
const W = 13.33, H = 7.5;
const shadow = () => ({ type: "outer", color: "0F172A", blur: 8, offset: 2, angle: 90, opacity: 0.1 });

// ── helpers ──
function titleSlide(opts) { return pres.addSlide(); }
function lightSlide() { const s = pres.addSlide(); s.background = { color: C.white }; return s; }

function header(s, kicker, title, kColor) {
  s.addText(kicker, { x: 0.7, y: 0.45, w: 12, h: 0.35, fontFace: F, fontSize: 13, bold: true, color: kColor || C.teal, charSpacing: 2, margin: 0 });
  s.addText(title, { x: 0.7, y: 0.78, w: 12, h: 0.75, fontFace: F, fontSize: 30, bold: true, color: C.ink, margin: 0 });
}

function card(s, x, y, w, h, fill) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: fill || C.white }, line: { color: C.line, width: 1 }, rectRadius: 0.08, shadow: shadow() });
}
function numCircle(s, n, x, y, color, d) {
  d = d || 0.55;
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color } });
  s.addText(String(n), { x, y, w: d, h: d, fontFace: F, fontSize: 18, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });
}
function arrow(s, x, y, w, color) {
  s.addShape(pres.shapes.LINE, { x, y, w, h: 0, line: { color: color || C.mute, width: 2.5, endArrowType: "triangle" } });
}
function txt(s, t, o) { s.addText(t, Object.assign({ fontFace: F, color: C.ink, valign: "top", margin: 0 }, o)); }

// ═══════════ Slide 1 — Title (dark) ═══════════
(() => {
  const s = pres.addSlide(); s.background = { color: C.dark };
  s.addText("Ariadne 완전 해설", { x: 0.8, y: 2.2, w: 11.7, h: 1.1, fontFace: F, fontSize: 46, bold: true, color: C.white, align: "center", margin: 0 });
  s.addText("AI는 어떻게 “내 자료로” 똑똑하게 답하나", { x: 0.8, y: 3.35, w: 11.7, h: 0.6, fontFace: F, fontSize: 22, color: "CADCFC", align: "center", margin: 0 });
  s.addText("RAG · 에이전트 하네스 · 레포 구조 — 기초 0에서 시작", { x: 0.8, y: 4.05, w: 11.7, h: 0.4, fontFace: F, fontSize: 14, color: "94A3B8", align: "center", margin: 0 });
  // motif pills
  const pills = [["검색 (RAG)", C.teal], ["하네스", C.navy], ["LLM", C.purple]];
  let px = (W - (3 * 2.4 + 2 * 0.4)) / 2;
  pills.forEach(([label, col]) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: px, y: 5.4, w: 2.4, h: 0.7, fill: { color: col }, rectRadius: 0.35 });
    s.addText(label, { x: px, y: 5.4, w: 2.4, h: 0.7, fontFace: F, fontSize: 15, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });
    px += 2.8;
  });
})();

// ═══════════ Slide 2 — 한 장 요약 (flow) ═══════════
(() => {
  const s = lightSlide();
  header(s, "한 장 요약", "큰 그림 — 질문이 답이 되기까지", C.navy);
  const y = 2.6, h = 1.5;
  const boxes = [
    ["내 질문", C.slate, C.ink], ["검색 (RAG)\n관련 자료 찾기", C.tealBg, C.teal],
    ["하네스\n계획→실행→재계획", C.navyBg, C.navy], ["LLM\n글 생성기", C.purpleBg, C.purple],
    ["근거 있는 답", C.slate, C.ink],
  ];
  const bw = 2.15, gap = 0.42; let x = 0.7;
  boxes.forEach((b, i) => {
    card(s, x, y, bw, h, b[1]);
    txt(s, b[0], { x: x + 0.1, y: y, w: bw - 0.2, h, fontSize: 15, bold: true, color: b[2], align: "center", valign: "middle" });
    if (i < boxes.length - 1) arrow(s, x + bw + 0.05, y + h / 2, gap - 0.1, C.mute);
    x += bw + gap;
  });
  txt(s, "핵심: LLM은 똑똑하지만 “내 자료·최신 정보”를 모릅니다. 그래서 ① 관련 자료를 찾아(RAG) ② 단계적으로 처리하고(하네스) ③ LLM에 같이 줍니다.",
    { x: 0.7, y: 4.7, w: 12, h: 0.9, fontSize: 15, color: C.mute });
  txt(s, "이 덱은 위 다섯 상자를 한 장에 하나씩, 바닥부터 풉니다.", { x: 0.7, y: 5.5, w: 12, h: 0.5, fontSize: 14, italic: true, color: C.ink });
})();

// ═══════════ Slide 3 — LLM이란 ═══════════
(() => {
  const s = lightSlide();
  header(s, "① 출발점", "LLM = 다음 단어 예측기", C.purple);
  card(s, 0.7, 1.9, 6.0, 3.0, C.white);
  txt(s, "세상 책을 거의 다 읽은 사람에게\n“빈칸 채우기”를 시키는 것", { x: 1.0, y: 2.2, w: 5.4, h: 0.9, fontSize: 18, bold: true, color: C.ink });
  txt(s, "한 단어를 확률로 고르고 → 문장에 붙이고 → 또 다음 빈칸…\n이걸 수백 번 반복하면 문단·코드·답이 됩니다.", { x: 1.0, y: 3.2, w: 5.4, h: 1.4, fontSize: 14, color: C.mute });
  // right: next-word prob bars
  card(s, 7.0, 1.9, 5.6, 3.0, C.slate);
  txt(s, "“아침에 일어나서 나는 ___”", { x: 7.3, y: 2.1, w: 5.0, h: 0.4, fontSize: 15, bold: true, color: C.ink });
  const cand = [["커피를", 0.85, C.purple], ["세수를", 0.6, C.navy], ["학교에", 0.4, C.teal], ["우주로", 0.12, C.mute]];
  let yy = 2.7;
  cand.forEach(([w0, p, col]) => {
    txt(s, w0, { x: 7.3, y: yy, w: 1.3, h: 0.35, fontSize: 13, color: C.ink, align: "right" });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 8.75, y: yy + 0.02, w: 3.5 * p, h: 0.3, fill: { color: col }, rectRadius: 0.05 });
    yy += 0.5;
  });
  // 3 한계 chips
  const lim = [["내 자료를 모름", C.amber], ["최신 정보 없음", C.amber], ["모르면 지어냄 = 환각", C.amber]];
  let cx = 0.7;
  lim.forEach(([t, col]) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: cx, y: 5.3, w: 3.9, h: 0.75, fill: { color: C.amberBg }, line: { color: col, width: 1 }, rectRadius: 0.1 });
    txt(s, t, { x: cx, y: 5.3, w: 3.9, h: 0.75, fontSize: 14, bold: true, color: col, align: "center", valign: "middle" });
    cx += 4.07;
  });
  txt(s, "Ariadne 기본 로컬 모델: qwen3:8b — 작고 빠른 만큼 위 한계가 도드라져, RAG·하네스가 더 중요해집니다.", { x: 0.7, y: 6.25, w: 12, h: 0.5, fontSize: 12.5, italic: true, color: C.mute });
})();

// ═══════════ Slide 4 — 문제 ═══════════
(() => {
  const s = lightSlide();
  header(s, "② 문제", "똑똑한데 왜 자꾸 틀리나", C.amber);
  const rows = [
    ["“내 포트폴리오 테슬라 비중?”", "아무 숫자나 지어냄", "내 파일을 본 적 없음"],
    ["“어제 발표된 환율?”", "옛날 값 또는 추측", "훈련 이후 정보 없음"],
    ["“이 코드의 이 함수 뭐함?”", "비슷한 코드로 때려맞힘", "내 레포를 모름"],
  ];
  const head = [["질문", C.ink], ["LLM 혼자서는", C.amber], ["왜", C.mute]];
  const cols = [4.4, 4.0, 3.5], xs = [0.7, 5.2, 9.3];
  head.forEach((hh, i) => txt(s, hh[0], { x: xs[i], y: 1.95, w: cols[i], h: 0.4, fontSize: 15, bold: true, color: hh[1] }));
  let yy = 2.5;
  rows.forEach((r) => {
    card(s, 0.7, yy, 12.1, 0.95, C.white);
    txt(s, r[0], { x: 0.95, y: yy, w: cols[0], h: 0.95, fontSize: 14, bold: true, color: C.ink, valign: "middle" });
    txt(s, r[1], { x: 5.2, y: yy, w: cols[1], h: 0.95, fontSize: 14, color: C.amber, valign: "middle" });
    txt(s, r[2], { x: 9.3, y: yy, w: cols[2], h: 0.95, fontSize: 14, color: C.mute, valign: "middle" });
    yy += 1.1;
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.7, y: 6.05, w: 12.1, h: 0.9, fill: { color: C.tealBg }, rectRadius: 0.1 });
  txt(s, "본질: LLM 머릿속에 답에 필요한 자료가 없다 →  답하기 전에 찾아서 같이 주자 = RAG", { x: 0.7, y: 6.05, w: 12.1, h: 0.9, fontSize: 16, bold: true, color: C.teal, align: "center", valign: "middle" });
})();

// ═══════════ Slide 5 — RAG = 오픈북 ═══════════
(() => {
  const s = lightSlide();
  header(s, "③ 해결책", "RAG = 오픈북 시험으로 바꾸기", C.teal);
  // two columns
  card(s, 0.7, 2.0, 5.9, 4.3, C.amberBg);
  txt(s, "암기 시험", { x: 0.7, y: 2.25, w: 5.9, h: 0.5, fontSize: 20, bold: true, color: C.amber, align: "center" });
  txt(s, "= LLM 혼자", { x: 0.7, y: 2.75, w: 5.9, h: 0.4, fontSize: 14, color: C.mute, align: "center" });
  txt(s, "머릿속 기억에만 의존\n→ 모르면 찍는다 (환각)", { x: 1.1, y: 3.5, w: 5.1, h: 1.5, fontSize: 16, color: C.ink, align: "center" });
  card(s, 6.8, 2.0, 5.9, 4.3, C.tealBg);
  txt(s, "오픈북 시험", { x: 6.8, y: 2.25, w: 5.9, h: 0.5, fontSize: 20, bold: true, color: C.teal, align: "center" });
  txt(s, "= RAG", { x: 6.8, y: 2.75, w: 5.9, h: 0.4, fontSize: 14, color: C.mute, align: "center" });
  txt(s, "관련 페이지를 먼저 펼쳐주고\n풀게 한다 → 근거를 보고 답", { x: 7.2, y: 3.5, w: 5.1, h: 1.5, fontSize: 16, color: C.ink, align: "center" });
  txt(s, "RAG가 환각을 줄이는 이유 — LLM이 “기억”이 아니라 “지금 눈앞의 자료”를 보고 답하기 때문. 상상으로 채우는 대신 복사·요약하게 됩니다.",
    { x: 0.7, y: 6.5, w: 12, h: 0.6, fontSize: 13, italic: true, color: C.mute, align: "center" });
})();

// ═══════════ Slide 6 — RAG 5단계 (flow) ═══════════
(() => {
  const s = lightSlide();
  header(s, "③ RAG 흐름", "검색 → 선별 → 합치기 → 생성 → 답", C.teal);
  const steps = [["검색", "창고에서 관련\n조각 꺼내기"], ["선별", "가장 관련 높은\n6개만"], ["합치기", "자료 + 질문을\n한 덩어리로"], ["생성", "그걸 보고\nLLM이 답"], ["답", "출처 [1]까지\n붙은 답"]];
  const bw = 2.15, gap = 0.4; let x = 0.7; const y = 2.6, h = 2.0;
  steps.forEach((st, i) => {
    card(s, x, y, bw, h, C.white);
    numCircle(s, i + 1, x + bw / 2 - 0.275, y + 0.25, C.teal);
    txt(s, st[0], { x, y: y + 0.9, w: bw, h: 0.4, fontSize: 17, bold: true, color: C.ink, align: "center" });
    txt(s, st[1], { x: x + 0.1, y: y + 1.3, w: bw - 0.2, h: 0.6, fontSize: 12.5, color: C.mute, align: "center" });
    if (i < steps.length - 1) arrow(s, x + bw + 0.03, y + h / 2, gap - 0.06, C.teal);
    x += bw + gap;
  });
  txt(s, "관건은 ①검색 — “관련 있는 조각”을 어떻게 찾느냐. 다음 3장이 그 내부입니다.", { x: 0.7, y: 5.4, w: 12, h: 0.5, fontSize: 15, color: C.ink });
})();

// ═══════════ Slide 7 — 청킹 ═══════════
(() => {
  const s = lightSlide();
  header(s, "④ 검색 내부", "청킹 — 책을 포스트잇 단위로", C.teal);
  // big doc -> 3 chunks
  card(s, 0.7, 2.1, 2.3, 3.2, C.slate);
  txt(s, "긴 문서\n(예: 1000줄\n코드)", { x: 0.7, y: 2.1, w: 2.3, h: 3.2, fontSize: 15, bold: true, color: C.ink, align: "center", valign: "middle" });
  arrow(s, 3.1, 3.7, 0.6, C.teal);
  const cy = [2.1, 3.2, 4.3];
  cy.forEach((yy, i) => { card(s, 3.9, yy, 4.2, 0.95, C.tealBg); txt(s, "청크 " + (i + 1) + " (~800자)", { x: 3.9, y: yy, w: 4.2, h: 0.95, fontSize: 14, bold: true, color: C.teal, align: "center", valign: "middle" }); });
  txt(s, "↕ 80자 겹침 — 경계에서 문장이 잘려 검색이 안 되는 걸 막음", { x: 3.9, y: 5.35, w: 4.2, h: 0.4, fontSize: 11.5, color: C.mute, align: "center" });
  // P2 callout
  card(s, 8.4, 2.1, 4.3, 3.65, C.navyBg);
  txt(s, "우리가 개선 (P2)", { x: 8.65, y: 2.3, w: 3.8, h: 0.4, fontSize: 14, bold: true, color: C.navy });
  txt(s, "조각만 떼면 “어느 파일·절”인지 사라짐. 그래서 맨 앞에 출처를 붙임:", { x: 8.65, y: 2.75, w: 3.85, h: 0.9, fontSize: 13, color: C.ink });
  s.addShape(pres.shapes.RECTANGLE, { x: 8.65, y: 3.7, w: 3.85, h: 1.35, fill: { color: "0F172A" } });
  s.addText([{ text: "src/pricing.ts › applyLoyaltyDiscount\n\n", options: { color: "7DD3C0" } }, { text: "return Math.round(subtotal * ...)", options: { color: "E2E8F0" } }], { x: 8.8, y: 3.8, w: 3.6, h: 1.15, fontFace: MONO, fontSize: 10, valign: "top", margin: 0 });
  txt(s, "→ 측정: Hit@1  76.5% → 82.4% (LLM 0회, 공짜)", { x: 8.65, y: 5.15, w: 3.85, h: 0.5, fontSize: 12, bold: true, color: C.navy });
})();

// ═══════════ Slide 8 — 임베딩 ═══════════
(() => {
  const s = lightSlide();
  header(s, "⑤ 검색 내부", "임베딩 — 의미를 좌표로", C.teal);
  txt(s, "단어가 겹쳐야만 찾으면 약함:  “차 할인” ↔ “자동차 세일” 은 못 찾음.\n임베딩 = 문장의 뜻을 숫자 좌표(벡터)로. 뜻이 비슷하면 좌표가 가깝다.", { x: 0.7, y: 1.95, w: 12, h: 1.0, fontSize: 15, color: C.ink });
  // semantic map
  card(s, 0.7, 3.1, 7.4, 3.5, C.slate);
  txt(s, "의미의 지도 (벡터 공간)", { x: 0.9, y: 3.25, w: 5, h: 0.4, fontSize: 13, bold: true, color: C.mute });
  const pts = [["강아지", 2.4, 4.4, C.teal], ["개", 3.4, 4.0, C.teal], ["고양이", 2.9, 5.2, C.teal], ["세금", 6.9, 6.0, C.amber], ["질문:반려견", 1.9, 4.9, C.purple]];
  pts.forEach(([t, x, y, col]) => {
    s.addShape(pres.shapes.OVAL, { x, y, w: 0.22, h: 0.22, fill: { color: col } });
    txt(s, t, { x: x - 0.6, y: y - 0.38, w: 1.6, h: 0.3, fontSize: 12, bold: true, color: col, align: "center" });
  });
  txt(s, "‘반려견’ 은 강아지·개 옆, 세금과는 정반대 끝", { x: 0.9, y: 6.15, w: 7, h: 0.35, fontSize: 12, italic: true, color: C.mute });
  // right notes
  card(s, 8.4, 3.1, 4.3, 3.5, C.tealBg);
  txt(s, "검색 = 질문 좌표에서\n가장 가까운 청크 고르기", { x: 8.7, y: 3.35, w: 3.7, h: 0.9, fontSize: 15, bold: true, color: C.teal });
  txt(s, "• 가까움 = 코사인 유사도\n• 모델: nomic-embed (로컬)\n• 청크 벡터는 SQLite에 저장\n• 이게 “의미 검색”", { x: 8.7, y: 4.4, w: 3.7, h: 2.0, fontSize: 14, color: C.ink });
})();

// ═══════════ Slide 9 — 세 가지 검색 ═══════════
(() => {
  const s = lightSlide();
  header(s, "⑥ 검색 내부", "세 가지 검색 — 서로의 약점을 메운다", C.teal);
  const cards = [
    ["키워드 (BM25)", C.navy, C.navyBg, "정확한 단어·희귀 용어·\n고유명사·코드 식별자", "동의어·말바꿈"],
    ["의미 (임베딩)", C.teal, C.tealBg, "뜻·동의어·말바꿈·\n다른 언어(한↔영)", "정확한 철자·희귀 토큰"],
    ["심볼 (코드)", C.purple, C.purpleBg, "코드의 함수·클래스\n이름 (tree-sitter)", "일반 문장"],
  ];
  const bw = 3.9, gap = 0.3; let x = 0.7; const y = 2.0, h = 4.3;
  cards.forEach((c) => {
    card(s, x, y, bw, h, c[2]);
    txt(s, c[0], { x, y: y + 0.25, w: bw, h: 0.5, fontSize: 18, bold: true, color: c[1], align: "center" });
    txt(s, "잘하는 것", { x: x + 0.3, y: y + 1.0, w: bw - 0.6, h: 0.3, fontSize: 12, bold: true, color: C.mute });
    txt(s, c[3], { x: x + 0.3, y: y + 1.35, w: bw - 0.6, h: 1.1, fontSize: 14, color: C.ink });
    txt(s, "못하는 것", { x: x + 0.3, y: y + 2.7, w: bw - 0.6, h: 0.3, fontSize: 12, bold: true, color: C.mute });
    txt(s, c[4], { x: x + 0.3, y: y + 3.05, w: bw - 0.6, h: 0.8, fontSize: 14, color: C.amber });
    x += bw + gap;
  });
  txt(s, "정반대 약점 → 셋을 합치면(하이브리드) 가장 세진다.", { x: 0.7, y: 6.55, w: 12, h: 0.4, fontSize: 14, italic: true, color: C.ink, align: "center" });
})();

// ═══════════ Slide 10 — 하이브리드 RRF + P1 ═══════════
(() => {
  const s = lightSlide();
  header(s, "⑥ 합치기", "하이브리드 (RRF) — 순위로 합산", C.navy);
  // left RRF diagram
  const lists = [["BM25 순위", C.navy], ["의미 순위", C.teal], ["심볼 순위", C.purple]];
  let ly = 2.1;
  lists.forEach((l) => { card(s, 0.7, ly, 2.7, 0.8, C.white); txt(s, l[0], { x: 0.7, y: ly, w: 2.7, h: 0.8, fontSize: 14, bold: true, color: l[1], align: "center", valign: "middle" }); ly += 1.05; });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 4.0, y: 2.55, w: 2.5, h: 1.4, fill: { color: C.navyBg }, line: { color: C.navy, width: 1.5 }, rectRadius: 0.1 });
  txt(s, "RRF 합산\n1/(60+등수)", { x: 4.0, y: 2.55, w: 2.5, h: 1.4, fontSize: 15, bold: true, color: C.navy, align: "center", valign: "middle" });
  [2.4, 3.45, 4.5].forEach((yy) => arrow(s, 3.45, yy, 0.5, C.mute));
  arrow(s, 6.6, 3.25, 0.5, C.navy);
  card(s, 7.2, 2.55, 2.0, 1.4, C.white);
  txt(s, "최종 순위", { x: 7.2, y: 2.55, w: 2.0, h: 1.4, fontSize: 15, bold: true, color: C.ink, align: "center", valign: "middle" });
  txt(s, "순위만 쓰니 점수 단위·가중치 조정이 필요 없음 (상수 60 표준).", { x: 0.7, y: 5.5, w: 8.5, h: 0.6, fontSize: 13, color: C.mute });
  // right: P1 stat
  card(s, 9.5, 2.0, 3.3, 4.5, C.tealBg);
  txt(s, "우리가 개선 (P1)", { x: 9.5, y: 2.2, w: 3.3, h: 0.4, fontSize: 14, bold: true, color: C.teal, align: "center" });
  txt(s, "하이브리드가 이미 있었는데\n채팅에선 안 쓰이고 있었음", { x: 9.6, y: 2.65, w: 3.1, h: 0.8, fontSize: 12.5, color: C.ink, align: "center" });
  txt(s, "첫 결과 정확도", { x: 9.5, y: 3.6, w: 3.3, h: 0.3, fontSize: 12, color: C.mute, align: "center" });
  txt(s, "52.9%", { x: 9.5, y: 3.85, w: 3.3, h: 0.55, fontSize: 26, bold: true, color: C.amber, align: "center" });
  s.addText("↓", { x: 9.5, y: 4.4, w: 3.3, h: 0.4, fontFace: F, fontSize: 18, color: C.mute, align: "center", margin: 0 });
  txt(s, "76.5%", { x: 9.5, y: 4.75, w: 3.3, h: 0.7, fontSize: 40, bold: true, color: C.teal, align: "center" });
  txt(s, "Hit@1  (+23.6%p)", { x: 9.5, y: 5.5, w: 3.3, h: 0.35, fontSize: 13, bold: true, color: C.teal, align: "center" });
})();

// ═══════════ Slide 11 — 하네스 (flow) ═══════════
(() => {
  const s = lightSlide();
  header(s, "⑦ 하네스", "AI가 스스로 일하게 — 계획→실행→재계획", C.navy);
  const steps = [["triage", "이 메시지\n어떻게 처리?", C.amber], ["계획", "2~5단계로\n분해", C.navy], ["실행", "도구 사용:\n웹·파일", C.navy], ["점검", "충분한가?", C.navy], ["종합", "최종 답\n작성", C.purple]];
  const bw = 2.15, gap = 0.4; let x = 0.7; const y = 2.5, h = 1.9;
  steps.forEach((st, i) => {
    card(s, x, y, bw, h, C.white);
    txt(s, st[0], { x, y: y + 0.25, w: bw, h: 0.5, fontSize: 17, bold: true, color: st[2], align: "center" });
    txt(s, st[1], { x: x + 0.1, y: y + 0.85, w: bw - 0.2, h: 0.8, fontSize: 13, color: C.mute, align: "center" });
    if (i < steps.length - 1) arrow(s, x + bw + 0.03, y + h / 2, gap - 0.06, C.navy);
    x += bw + gap;
  });
  // replan loop arrow (점검 -> 실행)
  txt(s, "↩ 실패·정보 부실 → 재계획 (최대 2회)", { x: 5.6, y: 4.55, w: 5, h: 0.4, fontSize: 12, italic: true, color: C.amber });
  txt(s, "쉬운 분류는 빠른 클라우드 모델(Gemini Flash), 어려운 추론은 로컬 모델 — 일을 난이도로 나눔.", { x: 0.7, y: 5.5, w: 12, h: 0.6, fontSize: 14, color: C.ink });
})();

// ═══════════ Slide 12 — Deep 모드 ═══════════
(() => {
  const s = lightSlide();
  header(s, "⑦ 하네스", "분신술 — Deep 모드 (병렬 서브에이전트)", C.navy);
  const cx = [2.95, 6.65, 10.35];
  // orchestrator
  card(s, 5.0, 1.75, 3.3, 0.85, C.navyBg);
  txt(s, "오케스트레이터 — 분해", { x: 5.0, y: 1.75, w: 3.3, h: 0.85, fontSize: 14, bold: true, color: C.navy, align: "center", valign: "middle" });
  // orchestrator -> rail1 (vertical), rail1 (horizontal), rail1 -> each subagent (down arrows)
  s.addShape(pres.shapes.LINE, { x: 6.65, y: 2.6, w: 0, h: 0.4, line: { color: C.mute, width: 2 } });
  s.addShape(pres.shapes.LINE, { x: cx[0], y: 3.0, w: cx[2] - cx[0], h: 0, line: { color: C.mute, width: 2 } });
  cx.forEach((x) => s.addShape(pres.shapes.LINE, { x, y: 3.0, w: 0, h: 0.42, line: { color: C.mute, width: 2.5, endArrowType: "triangle" } }));
  // subagents (row)
  cx.forEach((x, i) => { card(s, x - 1.25, 3.5, 2.5, 1.0, C.white); txt(s, "서브에이전트 " + (i + 1) + "\n자기 몫만 깊게", { x: x - 1.25, y: 3.5, w: 2.5, h: 1.0, fontSize: 13, bold: true, color: C.ink, align: "center", valign: "middle" }); });
  // subagents -> rail2, rail2 (horizontal), rail2 -> synthesis (down arrow)
  cx.forEach((x) => s.addShape(pres.shapes.LINE, { x, y: 4.5, w: 0, h: 0.4, line: { color: C.mute, width: 2 } }));
  s.addShape(pres.shapes.LINE, { x: cx[0], y: 4.9, w: cx[2] - cx[0], h: 0, line: { color: C.mute, width: 2 } });
  s.addShape(pres.shapes.LINE, { x: 6.65, y: 4.9, w: 0, h: 0.42, line: { color: C.mute, width: 2.5, endArrowType: "triangle" } });
  // synthesis
  card(s, 5.0, 5.3, 3.3, 0.85, C.purpleBg);
  txt(s, "종합 → 통합 답", { x: 5.0, y: 5.3, w: 3.3, h: 0.85, fontSize: 14, bold: true, color: C.purple, align: "center", valign: "middle" });
  txt(s, "각 서브에이전트는 자세한 조사 과정을 자기 안에 가두고, 오케스트레이터엔 요약만 돌려줌 (작업기억 절약). 비용이 크니 사용자가 켤 때만.", { x: 0.7, y: 6.45, w: 12, h: 0.6, fontSize: 13, italic: true, color: C.mute, align: "center" });
})();

// ═══════════ Slide 13 — 컨텍스트 엔지니어링 ═══════════
(() => {
  const s = lightSlide();
  header(s, "⑧ 속도·지능", "컨텍스트 엔지니어링 — 작업기억 아끼기", C.amber);
  txt(s, "LLM이 한 번에 보는 글의 양(작업기억)은 한정 + 꽉 채울수록 중간을 잊음. “무엇을·얼마나·어떤 순서로” 넣느냐가 품질을 좌우.", { x: 0.7, y: 1.95, w: 12, h: 0.7, fontSize: 14, color: C.ink });
  const cards = [
    ["압축 (compaction)", C.teal, C.tealBg, "긴 대화를 구조화 요약으로 접기. 결정·미해결·사실 섹션으로 나눠 중요한 게 안 날아가게."],
    ["캐싱 (caching)", C.navy, C.navyBg, "프롬프트 앞부분을 똑같이 유지 → 그 계산을 재활용(속도). 변하는 건 뒤쪽에. 앞을 흔들면 느려짐."],
    ["라우팅 (routing)", C.purple, C.purpleBg, "일을 난이도로 나눠 다른 모델에 배정. 쉬운 분류=빠른 모델, 어려운 추론=똑똑한 모델."],
  ];
  const bw = 3.9, gap = 0.3; let x = 0.7; const y = 2.9, h = 3.0;
  cards.forEach((c, i) => {
    card(s, x, y, bw, h, c[2]);
    numCircle(s, i + 1, x + 0.3, y + 0.3, c[1], 0.5);
    txt(s, c[0], { x: x + 0.95, y: y + 0.35, w: bw - 1.1, h: 0.5, fontSize: 16, bold: true, color: c[1], valign: "middle" });
    txt(s, c[3], { x: x + 0.3, y: y + 1.1, w: bw - 0.6, h: 1.7, fontSize: 13.5, color: C.ink });
    x += bw + gap;
  });
  txt(s, "Tier 3: 로컬 ollama 컨텍스트 창 4096 → 16384 (자료 뒷부분 잘림 해소) + 모델 상주(로딩 지연 제거).", { x: 0.7, y: 6.1, w: 12, h: 0.6, fontSize: 13, italic: true, color: C.mute });
})();

// ═══════════ Slide 14 — 레포 구조 ═══════════
(() => {
  const s = lightSlide();
  header(s, "⑨ 구조", "이 레포(Ariadne) — 모노레포", C.navy);
  const top = [
    ["apps/web", "화면", "React · Vite · Tailwind", C.tealBg, C.teal],
    ["apps/server", "두뇌 — 에이전트·검색·LLM", "Fastify · SQLite · tree-sitter", C.navyBg, C.navy],
    ["apps/desktop", "데스크톱 포장", "Tauri (Rust)", C.purpleBg, C.purple],
    ["packages/shared", "공용 타입·설정", "TypeScript", C.slate, C.ink],
  ];
  const bw = 2.95, gap = 0.25; let x = 0.7; const y = 2.0, h = 2.2;
  top.forEach((c) => {
    card(s, x, y, bw, h, c[3]);
    txt(s, c[0], { x: x + 0.2, y: y + 0.25, w: bw - 0.4, h: 0.4, fontFace: MONO, fontSize: 14, bold: true, color: c[4] });
    txt(s, c[1], { x: x + 0.2, y: y + 0.8, w: bw - 0.4, h: 0.8, fontSize: 14, bold: true, color: C.ink });
    txt(s, c[2], { x: x + 0.2, y: y + 1.6, w: bw - 0.4, h: 0.5, fontSize: 11.5, color: C.mute });
    x += bw + gap;
  });
  // provider gateway
  card(s, 0.7, 4.7, 12.1, 1.6, C.white);
  txt(s, "멀티 프로바이더 게이트웨이 — “어느 LLM을 쓸지” 한곳에서 갈아끼움", { x: 0.95, y: 4.85, w: 11.6, h: 0.4, fontSize: 14, bold: true, color: C.ink });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.95, y: 5.35, w: 5.7, h: 0.75, fill: { color: C.tealBg }, rectRadius: 0.1 });
  txt(s, "Ollama (로컬) — qwen3:8b · nomic-embed · 키 불필요", { x: 0.95, y: 5.35, w: 5.7, h: 0.75, fontSize: 13, bold: true, color: C.teal, align: "center", valign: "middle" });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 6.85, y: 5.35, w: 5.7, h: 0.75, fill: { color: C.navyBg }, rectRadius: 0.1 });
  txt(s, "Gemini / Moonshot (클라우드) — 필요할 때만", { x: 6.85, y: 5.35, w: 5.7, h: 0.75, fontSize: 13, bold: true, color: C.navy, align: "center", valign: "middle" });
  txt(s, "기본은 로컬 = local-first. 인터넷·계정 없이도 동작.", { x: 0.7, y: 6.5, w: 12, h: 0.4, fontSize: 13, italic: true, color: C.mute, align: "center" });
})();

// ═══════════ Slide 15 — eval ═══════════
(() => {
  const s = lightSlide();
  header(s, "⑩ 증명", "“좋아졌다”를 느낌이 아니라 숫자로", C.teal);
  // loop
  const loop = [["검색 코드\n변경", C.slate, C.ink], ["eval 실행\n35개 채점", C.tealBg, C.teal], ["숫자\nHit@1·MRR", C.white, C.ink], ["좋아졌나?", C.navyBg, C.navy]];
  let x = 0.7; const y = 2.1, bw = 2.2, h = 1.2, gap = 0.45;
  loop.forEach((b, i) => { card(s, x, y, bw, h, b[1]); txt(s, b[0], { x, y, w: bw, h, fontSize: 14, bold: true, color: b[2], align: "center", valign: "middle" }); if (i < loop.length - 1) arrow(s, x + bw + 0.05, y + h / 2, gap - 0.1, C.mute); x += bw + gap; });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 9.95, y: 1.65, w: 1.55, h: 0.6, fill: { color: C.tealBg }, rectRadius: 0.1 }); txt(s, "예 → 출시", { x: 9.95, y: 1.65, w: 1.55, h: 0.6, fontSize: 12, bold: true, color: C.teal, align: "center", valign: "middle" });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 9.95, y: 3.1, w: 1.55, h: 0.6, fill: { color: C.amberBg }, rectRadius: 0.1 }); txt(s, "아니오 → 보류", { x: 9.95, y: 3.1, w: 1.55, h: 0.6, fontSize: 12, bold: true, color: C.amber, align: "center", valign: "middle" });
  // results
  txt(s, "원칙: 증명 전엔 출시 안 함 (prove-before-ship)", { x: 0.7, y: 3.9, w: 12, h: 0.4, fontSize: 16, bold: true, color: C.ink });
  const res = [["P1 · P2", "출시 ✅", "Hit@1 52.9% → 82.4% (누적 +29.5%p)", C.tealBg, C.teal],
    ["P3 (코드 AST 청킹)", "보류 🛑", "리서치는 추천했지만 우리 채점에선 하이브리드에 효과 0", C.amberBg, C.amber]];
  let ry = 4.45;
  res.forEach((r) => {
    card(s, 0.7, ry, 12.1, 0.95, r[3]);
    txt(s, r[0], { x: 0.95, y: ry, w: 3.2, h: 0.95, fontSize: 15, bold: true, color: r[4], valign: "middle" });
    txt(s, r[1], { x: 4.2, y: ry, w: 1.8, h: 0.95, fontSize: 15, bold: true, color: r[4], valign: "middle" });
    txt(s, r[2], { x: 6.1, y: ry, w: 6.5, h: 0.95, fontSize: 13, color: C.ink, valign: "middle" });
    ry += 1.1;
  });
})();

// ═══════════ Slide 16 — 마무리 (dark) ═══════════
(() => {
  const s = pres.addSlide(); s.background = { color: C.dark };
  s.addText("정리 — 네 개만 기억하면 됩니다", { x: 0.8, y: 0.7, w: 11.7, h: 0.7, fontFace: F, fontSize: 28, bold: true, color: C.white, margin: 0 });
  const items = [
    ["RAG", "답하기 전에 관련 자료를 찾아 같이 준다 (오픈북)", C.teal],
    ["하이브리드 검색", "키워드+의미+심볼을 순위로 합쳐 가장 잘 찾는다", C.navy],
    ["하네스", "계획→실행→재계획으로 LLM을 묶어 어려운 일을 시킨다", C.amber],
    ["증명 문화", "바꿀 때마다 숫자(eval)로 좋아졌는지 확인한다", C.purple],
  ];
  let y = 1.9;
  items.forEach((it, i) => {
    numCircle(s, i + 1, 0.9, y, it[2], 0.6);
    s.addText(it[0], { x: 1.75, y: y - 0.05, w: 3.2, h: 0.7, fontFace: F, fontSize: 19, bold: true, color: it[2], valign: "middle", margin: 0 });
    s.addText(it[1], { x: 5.0, y: y - 0.05, w: 7.5, h: 0.7, fontFace: F, fontSize: 16, color: "CBD5E1", valign: "middle", margin: 0 });
    y += 1.0;
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.8, y: 6.1, w: 11.7, h: 0.85, fill: { color: C.navy }, rectRadius: 0.1 });
  s.addText("이제 깊게 읽을 차례 →  docs/learn/01-rag-harness-explainer.md", { x: 0.8, y: 6.1, w: 11.7, h: 0.85, fontFace: F, fontSize: 16, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });
})();

pres.writeFile({ fileName: "/tmp/deck/ariadne-deck.pptx" }).then((f) => console.log("WROTE", f));
