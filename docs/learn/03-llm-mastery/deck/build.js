/* LLM 마스터 코스 overview 덱 — pptxgenjs. 한글: Apple SD Gothic Neo. */
const P = require("pptxgenjs");
const pres = new P();
pres.layout = "LAYOUT_WIDE";
pres.author = "LLM Mastery";
pres.title = "LLM 마스터 코스";

const C = {
  dark: "0F172A", navy: "1E40AF", teal: "0E7C66", purple: "7C3AED", amber: "B45309",
  ink: "1E293B", mute: "64748B", white: "FFFFFF", line: "E2E8F0",
  tealBg: "E6F2EF", navyBg: "E8EDFB", purpleBg: "F1E9FC", amberBg: "FBEFE2", slate: "F1F5F9",
};
const F = "Apple SD Gothic Neo";
const W = 13.33;
const shadow = () => ({ type: "outer", color: "0F172A", blur: 8, offset: 2, angle: 90, opacity: 0.1 });
const lightSlide = () => { const s = pres.addSlide(); s.background = { color: C.white }; return s; };
function header(s, kicker, title, kColor) {
  s.addText(kicker, { x: 0.7, y: 0.45, w: 12, h: 0.35, fontFace: F, fontSize: 13, bold: true, color: kColor || C.purple, charSpacing: 2, margin: 0 });
  s.addText(title, { x: 0.7, y: 0.78, w: 12, h: 0.75, fontFace: F, fontSize: 29, bold: true, color: C.ink, margin: 0 });
}
function card(s, x, y, w, h, fill) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: fill || C.white }, line: { color: C.line, width: 1 }, rectRadius: 0.08, shadow: shadow() });
}
function numCircle(s, n, x, y, color, d) {
  d = d || 0.55;
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color } });
  s.addText(String(n), { x, y, w: d, h: d, fontFace: F, fontSize: 17, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });
}
function arrowR(s, x, y, w, color) { s.addShape(pres.shapes.LINE, { x, y, w, h: 0, line: { color: color || C.mute, width: 2.5, endArrowType: "triangle" } }); }
function arrowD(s, x, y, h, color) { s.addShape(pres.shapes.LINE, { x, y, w: 0, h, line: { color: color || C.mute, width: 2.5, endArrowType: "triangle" } }); }
function txt(s, t, o) { s.addText(t, Object.assign({ fontFace: F, color: C.ink, valign: "top", margin: 0 }, o)); }

// 1 — Title (dark)
(() => {
  const s = pres.addSlide(); s.background = { color: C.dark };
  s.addText("LLM 마스터 코스", { x: 0.8, y: 2.2, w: 11.7, h: 1.1, fontFace: F, fontSize: 46, bold: true, color: C.white, align: "center", margin: 0 });
  s.addText("큰 그림에서 바닥까지 — 기초 0에서 전체 기술까지", { x: 0.8, y: 3.35, w: 11.7, h: 0.6, fontFace: F, fontSize: 21, color: "CADCFC", align: "center", margin: 0 });
  const pills = [["① 기초", C.teal], ["② 트랜스포머", C.purple], ["③ 학습", C.navy], ["④ 추론", C.amber], ["⑤ 증강", C.navy], ["⑥ 업계", C.teal]];
  let px = (W - (6 * 1.85 + 5 * 0.18)) / 2;
  pills.forEach(([label, col]) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: px, y: 5.3, w: 1.85, h: 0.65, fill: { color: col }, rectRadius: 0.32 });
    s.addText(label, { x: px, y: 5.3, w: 1.85, h: 0.65, fontFace: F, fontSize: 13, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });
    px += 2.03;
  });
})();

// 2 — 코스 지도 (flow)
(() => {
  const s = lightSlide();
  header(s, "코스 지도", "6개 모듈, 위에서 아래로", C.purple);
  const mods = [["① 기초", "토큰·임베딩\n신경망·확률", C.tealBg, C.teal], ["② 트랜스포머", "어텐션이\n전부", C.purpleBg, C.purple], ["③ 학습·정렬", "사전학습·RLHF\n추론모델", C.navyBg, C.navy], ["④ 추론·효율", "디코딩·KV캐시\n양자화·서빙", C.amberBg, C.amber], ["⑤ 증강·에이전트", "RAG·툴·MCP\n멀티모달", C.navyBg, C.navy], ["⑥ 업계·생태계", "제작사·오픈vs\n클로즈·트렌드", C.tealBg, C.teal]];
  const bw = 1.85, gap = 0.18; let x = 0.6; const y = 2.7, h = 2.0;
  mods.forEach((m, i) => {
    card(s, x, y, bw, h, m[2]);
    txt(s, m[0], { x, y: y + 0.25, w: bw, h: 0.5, fontSize: 14, bold: true, color: m[3], align: "center" });
    txt(s, m[1], { x: x + 0.08, y: y + 0.95, w: bw - 0.16, h: 0.9, fontSize: 11.5, color: C.mute, align: "center" });
    if (i < mods.length - 1) arrowR(s, x + bw + 0.01, y + h / 2, gap - 0.02, C.mute);
    x += bw + gap;
  });
  txt(s, "각 개념은 일상 비유 → 그림 → 기술 디테일 순서로. 길을 잃으면 “지금 어느 모듈?”을 떠올리세요.", { x: 0.7, y: 5.1, w: 12, h: 0.5, fontSize: 14, italic: true, color: C.ink, align: "center" });
})();

// 3 — 4 렌즈
(() => {
  const s = lightSlide();
  header(s, "시작 전", "LLM을 보는 4개의 렌즈", C.purple);
  const lens = [["① 표현", "말을 숫자로", "토큰·임베딩", C.tealBg, C.teal], ["② 계산", "문맥 섞기", "어텐션", C.purpleBg, C.purple], ["③ 학습", "좋은 숫자로 조정", "사전학습·정렬", C.navyBg, C.navy], ["④ 사용", "생성·증강·정렬", "추론·RAG·에이전트", C.amberBg, C.amber]];
  const bw = 2.9, gap = 0.25; let x = 0.7; const y = 2.2, h = 3.2;
  lens.forEach((l, i) => {
    card(s, x, y, bw, h, l[3]);
    txt(s, l[0], { x, y: y + 0.4, w: bw, h: 0.5, fontSize: 22, bold: true, color: l[4], align: "center" });
    txt(s, l[1], { x: x + 0.2, y: y + 1.3, w: bw - 0.4, h: 0.6, fontSize: 16, color: C.ink, align: "center" });
    txt(s, l[2], { x: x + 0.2, y: y + 2.3, w: bw - 0.4, h: 0.5, fontSize: 13, color: C.mute, align: "center" });
    if (i < 3) arrowR(s, x + bw + 0.02, y + h / 2, gap - 0.04, C.mute);
    x += bw + gap;
  });
  txt(s, "복잡해 보여도 LLM은 결국 이 네 질문으로 환원됩니다.", { x: 0.7, y: 5.7, w: 12, h: 0.4, fontSize: 14, italic: true, color: C.mute, align: "center" });
})();

// 4 — ① LLM = 함수
(() => {
  const s = lightSlide();
  header(s, "① 기초", "LLM은 거대한 함수 하나다", C.teal);
  const steps = [["글자", C.slate, C.ink], ["토큰화\n번호로", C.tealBg, C.teal], ["임베딩\n벡터로", C.tealBg, C.teal], ["트랜스포머\n(수십 층)", C.purpleBg, C.purple], ["다음 토큰\n확률", C.amberBg, C.amber]];
  const bw = 2.15, gap = 0.42; let x = 0.7; const y = 2.7, h = 1.6;
  steps.forEach((b, i) => {
    card(s, x, y, bw, h, b[1]);
    txt(s, b[0], { x: x + 0.1, y, w: bw - 0.2, h, fontSize: 15, bold: true, color: b[2], align: "center", valign: "middle" });
    if (i < steps.length - 1) arrowR(s, x + bw + 0.05, y + h / 2, gap - 0.1, C.mute);
    x += bw + gap;
  });
  arrowR(s, 11.6, 4.9, 0, C.mute);
  txt(s, "↩ 한 토큰 고르고 → 붙이고 → 다시 함수에 (자기회귀). 이 반복이 문장이 됩니다.", { x: 0.7, y: 4.7, w: 12, h: 0.5, fontSize: 15, color: C.ink, align: "center" });
  txt(s, "출력은 “정답”이 아니라 모든 후보 토큰에 매긴 확률분포입니다.", { x: 0.7, y: 5.4, w: 12, h: 0.4, fontSize: 13, italic: true, color: C.mute, align: "center" });
})();

// 5 — 토큰화
(() => {
  const s = lightSlide();
  header(s, "① 기초", "토큰화 — 글자를 번호로", C.teal);
  txt(s, "컴퓨터는 숫자만 안다. 텍스트를 자주 쓰는 조각(토큰)으로 쪼개 번호를 붙인다. (레고 부품 번호표)", { x: 0.7, y: 1.95, w: 12, h: 0.6, fontSize: 15, color: C.ink });
  card(s, 0.7, 2.8, 12.1, 1.2, C.slate);
  txt(s, "'딸기 케이크'", { x: 1.0, y: 3.0, w: 2.5, h: 0.8, fontSize: 18, bold: true, color: C.ink, valign: "middle" });
  arrowR(s, 3.6, 3.4, 0.5, C.teal);
  ["딸기 (4821)", "케이 (9013)", "크 (77)"].forEach((t, i) => { s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 4.3 + i * 2.7, y: 3.1, w: 2.4, h: 0.6, fill: { color: C.tealBg }, rectRadius: 0.1 }); txt(s, t, { x: 4.3 + i * 2.7, y: 3.1, w: 2.4, h: 0.6, fontSize: 14, bold: true, color: C.teal, align: "center", valign: "middle" }); });
  const facts = [["토큰 ≠ 단어", "영어 1토큰≈0.75단어. 한국어·코드는 더 잘게 = 더 비쌈"], ["BPE 방식", "자주 같이 나오는 글자쌍을 묶어 사전 구성"], ["글자 질문에 약함", "'r이 몇 개?' — 모델은 글자가 아닌 토큰 덩어리로 봄"]];
  let fx = 0.7;
  facts.forEach((ff) => { card(s, fx, 4.4, 3.9, 1.9, C.white); txt(s, ff[0], { x: fx + 0.25, y: 4.6, w: 3.4, h: 0.5, fontSize: 15, bold: true, color: C.teal }); txt(s, ff[1], { x: fx + 0.25, y: 5.15, w: 3.4, h: 1.0, fontSize: 13, color: C.mute }); fx += 4.07; });
})();

// 6 — 임베딩
(() => {
  const s = lightSlide();
  header(s, "① 기초", "임베딩 — 번호를 의미 벡터로", C.teal);
  txt(s, "번호(4821)는 뜻이 없다. 각 토큰을 수백~수천 숫자(벡터)로 바꾼다. 학습 후 뜻이 비슷하면 벡터가 가까워진다.", { x: 0.7, y: 1.95, w: 12, h: 0.6, fontSize: 15, color: C.ink });
  card(s, 0.7, 2.9, 7.4, 3.4, C.slate);
  txt(s, "의미의 지도 (벡터 공간)", { x: 0.95, y: 3.05, w: 5, h: 0.4, fontSize: 13, bold: true, color: C.mute });
  const pts = [["왕", 2.2, 4.2, C.purple], ["여왕", 3.2, 4.0, C.purple], ["남자", 2.4, 5.2, C.navy], ["여자", 3.5, 5.0, C.navy], ["사과", 6.6, 5.6, C.teal]];
  pts.forEach(([t, x, y, col]) => { s.addShape(pres.shapes.OVAL, { x, y, w: 0.22, h: 0.22, fill: { color: col } }); txt(s, t, { x: x - 0.5, y: y - 0.38, w: 1.3, h: 0.3, fontSize: 13, bold: true, color: col, align: "center" }); });
  txt(s, "“왕 − 남자 + 여자 ≈ 여왕” 같은 의미 산수가 성립할 정도", { x: 0.95, y: 5.85, w: 7, h: 0.35, fontSize: 12, italic: true, color: C.mute });
  card(s, 8.4, 2.9, 4.3, 3.4, C.tealBg);
  txt(s, "왜 중요?", { x: 8.7, y: 3.1, w: 3.7, h: 0.4, fontSize: 15, bold: true, color: C.teal });
  txt(s, "• 차원↑ = 더 섬세, 더 무거움\n• 문장 전체 임베딩 → RAG 의미검색\n• 검색·추천·분류의 토대\n• nomic-embed 등이 임베딩 전용 모델", { x: 8.7, y: 3.6, w: 3.7, h: 2.5, fontSize: 14, color: C.ink });
})();

// 7 — 신경망
(() => {
  const s = lightSlide();
  header(s, "① 기초", "신경망 — 손잡이를 돌려 함수를 빚다", C.teal);
  txt(s, "신경망 = 곱하고·더하고(행렬곱) 중간에 구부리기(비선형)를 여러 층 쌓은 거대 함수. 그 곱셈의 숫자 = 파라미터(손잡이).", { x: 0.7, y: 1.95, w: 12, h: 0.6, fontSize: 14.5, color: C.ink });
  card(s, 0.7, 2.85, 6.0, 3.4, C.white);
  txt(s, "거대한 믹싱 콘솔 🎛️", { x: 0.95, y: 3.05, w: 5.5, h: 0.5, fontSize: 17, bold: true, color: C.ink });
  txt(s, "수십억 개 손잡이(파라미터). 처음엔 엉터리 소리(출력). 정답과 비교해 “이 손잡이를 살짝” 을 수십억 번 → 멋진 소리.\n\n• “8B/70B” = 손잡이 개수\n• 구부리기가 핵심 (없으면 직선뿐)", { x: 0.95, y: 3.6, w: 5.5, h: 2.5, fontSize: 14, color: C.mute });
  card(s, 7.0, 2.85, 5.7, 3.4, C.amberBg);
  txt(s, "학습 = 안개 산에서 골짜기로", { x: 7.25, y: 3.05, w: 5.2, h: 0.5, fontSize: 16, bold: true, color: C.amber });
  txt(s, "① 손실(loss): 정답과 빗나간 정도\n② 기울기(gradient): 손잡이를 어디로 돌리면 손실↓? (역전파)\n③ 경사하강: 그 방향으로 살짝 이동, 반복\n\n발밑 경사를 느껴 가장 낮은 곳으로 한 걸음씩 — 이게 모든 딥러닝의 엔진.", { x: 7.25, y: 3.6, w: 5.2, h: 2.5, fontSize: 13.5, color: C.ink });
})();

// 8 — 어텐션 직관 (flow)
(() => {
  const s = lightSlide();
  header(s, "② 트랜스포머", "어텐션 — 누구를 얼마나 볼까", C.purple);
  txt(s, "각 토큰이 다른 모든 토큰을 “얼마나 참고할지” 가중치를 매기고, 그 가중치로 정보를 섞어 자기 의미를 갱신한다.", { x: 0.7, y: 1.95, w: 12, h: 0.6, fontSize: 15, color: C.ink });
  card(s, 5.2, 2.8, 2.9, 0.8, C.purpleBg);
  txt(s, "'은행' (이해하려는 토큰)", { x: 5.2, y: 2.8, w: 2.9, h: 0.8, fontSize: 13, bold: true, color: C.purple, align: "center", valign: "middle" });
  const ws = [["'내가' (0.05)", 0.7, C.mute], ["'갔는데' (0.10)", 4.0, C.mute], ["'강물' (0.70)", 7.3, C.purple], ["'흐르더라' (0.15)", 10.6, C.mute]];
  ws.forEach(([t, x, col]) => { card(s, x, 4.3, 2.4, 0.75, col === C.purple ? C.purpleBg : C.slate); txt(s, t, { x, y: 4.3, w: 2.4, h: 0.75, fontSize: 13, bold: true, color: col === C.purple ? C.purple : C.ink, align: "center", valign: "middle" }); s.addShape(pres.shapes.LINE, { x: 6.65, y: 3.6, w: (x + 1.2) - 6.65, h: 0.7, line: { color: col, width: col === C.purple ? 3 : 1.5 } }); });
  card(s, 4.4, 5.45, 4.5, 0.8, C.tealBg);
  txt(s, "가중평균 → '은행'의 새 의미 = 강둑", { x: 4.4, y: 5.45, w: 4.5, h: 0.8, fontSize: 14, bold: true, color: C.teal, align: "center", valign: "middle" });
})();

// 9 — Q/K/V
(() => {
  const s = lightSlide();
  header(s, "② 트랜스포머", "Query · Key · Value — 도서관 비유", C.purple);
  const qkv = [["Query (질의)", "“내가 찾는 것” 메모", "지금 토큰이 뭘 알고 싶나", C.purpleBg, C.purple], ["Key (열쇠)", "책의 “주제 태그”", "각 토큰이 “나 이런 정보 있음” 광고", C.navyBg, C.navy], ["Value (값)", "책의 실제 내용", "참고될 때 전달되는 정보", C.tealBg, C.teal]];
  const bw = 3.9, gap = 0.3; let x = 0.7; const y = 2.0, h = 2.7;
  qkv.forEach((c) => { card(s, x, y, bw, h, c[3]); txt(s, c[0], { x, y: y + 0.3, w: bw, h: 0.5, fontSize: 18, bold: true, color: c[4], align: "center" }); txt(s, c[1], { x: x + 0.2, y: y + 1.1, w: bw - 0.4, h: 0.6, fontSize: 15, color: C.ink, align: "center" }); txt(s, c[2], { x: x + 0.2, y: y + 1.8, w: bw - 0.4, h: 0.7, fontSize: 12.5, color: C.mute, align: "center" }); x += bw + gap; });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.7, y: 5.1, w: 12.1, h: 1.1, fill: { color: C.dark }, rectRadius: 0.08 });
  s.addText("Attention(Q,K,V) = softmax( Q·Kᵀ / √d ) · V", { x: 0.7, y: 5.1, w: 12.1, h: 0.55, fontFace: "Menlo", fontSize: 17, bold: true, color: "7DD3C0", align: "center", valign: "middle", margin: 0 });
  s.addText("Q로 묻고 → K로 매칭 점수 → softmax로 가중치 → V를 섞는다.  이 한 줄이 LLM의 거의 전부.", { x: 0.7, y: 5.62, w: 12.1, h: 0.5, fontFace: F, fontSize: 13, color: "CBD5E1", align: "center", valign: "middle", margin: 0 });
})();

// 10 — 멀티헤드 + 블록
(() => {
  const s = lightSlide();
  header(s, "② 트랜스포머", "멀티헤드 + 트랜스포머 블록", C.purple);
  card(s, 0.7, 2.0, 5.9, 4.2, C.purpleBg);
  txt(s, "멀티헤드 — 여러 관점 동시에", { x: 0.95, y: 2.2, w: 5.4, h: 0.5, fontSize: 16, bold: true, color: C.purple });
  txt(s, "어텐션을 여러 개(헤드) 병렬로. 한 문장을 여러 전문가가 동시 분석:\n\n• 헤드1 = 문법(주어-동사)\n• 헤드2 = 지시어(이것=무엇)\n• 헤드3 = 장거리 주제 연결\n→ 결과를 합침", { x: 0.95, y: 2.85, w: 5.4, h: 3.1, fontSize: 14, color: C.ink });
  card(s, 6.9, 2.0, 5.8, 4.2, C.white);
  txt(s, "블록 = 어텐션 + FFN + 잔차 + 정규화", { x: 7.15, y: 2.2, w: 5.3, h: 0.5, fontSize: 15, bold: true, color: C.ink });
  const blk = [["멀티헤드 셀프어텐션", "토큰끼리 정보 섞기", C.purple], ["FFN", "토큰별로 한 번 더 가공", C.navy], ["+ 잔차 & 정규화", "깊게 쌓아도 안 망가지게", C.teal]];
  let by = 2.85;
  blk.forEach((b) => { s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 7.15, y: by, w: 5.3, h: 0.85, fill: { color: C.slate }, rectRadius: 0.08 }); txt(s, b[0], { x: 7.35, y: by + 0.1, w: 5.0, h: 0.4, fontSize: 14, bold: true, color: b[2] }); txt(s, b[1], { x: 7.35, y: by + 0.48, w: 5.0, h: 0.35, fontSize: 12, color: C.mute }); by += 1.05; });
  txt(s, "이 블록을 수십~수백 층 쌓으면 GPT — 아래층은 문법, 위층은 의미·추론.", { x: 0.7, y: 6.4, w: 12, h: 0.4, fontSize: 13, italic: true, color: C.mute, align: "center" });
})();

// 11 — ③ 학습 3단계 (flow)
(() => {
  const s = lightSlide();
  header(s, "③ 학습·정렬", "빈 모델 → 똑똑한 비서, 3단계", C.navy);
  const st = [["① 사전학습", "인터넷으로\n다음토큰 맞히기", "→ 지식·언어", C.purpleBg, C.purple], ["② SFT", "좋은 질문-답\n예시 모방", "→ 비서 말투", C.navyBg, C.navy], ["③ 정렬 RLHF/DPO", "사람 선호로\n다듬기", "→ 도움·안전·성격", C.tealBg, C.teal]];
  const bw = 3.7, gap = 0.45; let x = 0.85; const y = 2.5, h = 2.3;
  st.forEach((b, i) => { card(s, x, y, bw, h, b[3]); txt(s, b[0], { x, y: y + 0.3, w: bw, h: 0.5, fontSize: 17, bold: true, color: b[4], align: "center" }); txt(s, b[1], { x: x + 0.2, y: y + 1.0, w: bw - 0.4, h: 0.7, fontSize: 14, color: C.ink, align: "center" }); txt(s, b[2], { x: x + 0.2, y: y + 1.75, w: bw - 0.4, h: 0.4, fontSize: 13, bold: true, color: b[4], align: "center" }); if (i < 2) arrowR(s, x + bw + 0.05, y + h / 2, gap - 0.1, C.mute); x += bw + gap; });
  txt(s, "스케일링 법칙: 키우면 예측 가능하게 똑똑해짐 (단, 데이터도 비례 — Chinchilla).  추론모델 = 생각을 더 시켜 성능↑.", { x: 0.7, y: 5.2, w: 12, h: 0.6, fontSize: 14, color: C.ink, align: "center" });
})();

// 12 — 환각
(() => {
  const s = lightSlide();
  header(s, "③ 학습·정렬", "환각은 왜 생기나 — 필연적 부작용", C.amber);
  const why = [["목표가 “그럴듯함”\n(≠ 진실)", C.amber], ["“모른다”를 모름\n(빈칸은 무조건 채움)", C.amber], ["지식이 흐릿한 기억\n(정확한 출처 아님)", C.amber]];
  let x = 0.7;
  why.forEach((w0) => { card(s, x, 2.1, 3.9, 1.5, C.amberBg); txt(s, w0[0], { x: x + 0.2, y: 2.1, w: 3.5, h: 1.5, fontSize: 15, bold: true, color: w0[1], align: "center", valign: "middle" }); x += 4.07; });
  arrowD(s, 6.65, 3.7, 0.5, C.mute);
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 3.6, y: 4.3, w: 6.1, h: 0.8, fill: { color: C.dark }, rectRadius: 0.1 });
  txt(s, "환각 (그럴듯한 거짓말)", { x: 3.6, y: 4.3, w: 6.1, h: 0.8, fontSize: 17, bold: true, color: C.white, align: "center", valign: "middle" });
  arrowD(s, 6.65, 5.1, 0.45, C.mute);
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 1.7, y: 5.55, w: 9.9, h: 0.85, fill: { color: C.tealBg }, rectRadius: 0.1 });
  txt(s, "완화책: RAG(근거 제공) + 정렬(불확실성 표현) + 도구(사실 위임) + 평가(측정)", { x: 1.7, y: 5.55, w: 9.9, h: 0.85, fontSize: 15, bold: true, color: C.teal, align: "center", valign: "middle" });
})();

// 13 — ④ 추론
(() => {
  const s = lightSlide();
  header(s, "④ 추론·효율", "생성 = prefill + decode, 그리고 KV 캐시", C.amber);
  card(s, 0.7, 2.1, 5.9, 1.5, C.navyBg);
  txt(s, "① Prefill (선행)", { x: 0.95, y: 2.3, w: 5.4, h: 0.4, fontSize: 16, bold: true, color: C.navy });
  txt(s, "입력 전체를 한 번에 병렬 계산 → 첫 글자까지 시간(TTFT)", { x: 0.95, y: 2.75, w: 5.4, h: 0.7, fontSize: 13.5, color: C.ink });
  card(s, 6.8, 2.1, 5.9, 1.5, C.purpleBg);
  txt(s, "② Decode (생성)", { x: 7.05, y: 2.3, w: 5.4, h: 0.4, fontSize: 16, bold: true, color: C.purple });
  txt(s, "토큰을 한 개씩 순차 생성 → 느림의 본질 (출력 길수록 느림)", { x: 7.05, y: 2.75, w: 5.4, h: 0.7, fontSize: 13.5, color: C.ink });
  card(s, 0.7, 3.9, 12.0, 2.4, C.tealBg);
  txt(s, "KV 캐시 — 속도의 핵심", { x: 0.95, y: 4.1, w: 11.5, h: 0.4, fontSize: 16, bold: true, color: C.teal });
  txt(s, "매 토큰마다 이전 전부를 다시 계산하면 낭비. 이전 토큰들의 Key·Value를 저장해두고 재사용 → “전체 다시”가 아니라 “새 토큰만 추가”.\n\n• 대가: 메모리 (문맥 길수록 커짐) → q8 KV 캐시로 압축\n• 프롬프트 캐싱: 앞부분이 같으면 그 계산을 건너뜀 → “앞부분을 고정하라”의 이유", { x: 0.95, y: 4.55, w: 11.5, h: 1.6, fontSize: 14, color: C.ink });
})();

// 14 — 효율 3대장
(() => {
  const s = lightSlide();
  header(s, "④ 추론·효율", "가볍고 빠르게 — 효율 3대장", C.amber);
  const e = [["양자화", "16비트 → 4·8비트로 압축. 메모리·속도↑, 품질 손실 작음. 70B를 노트북에서. (GGUF, Q4_K_M)", C.teal, C.tealBg], ["MoE (전문가 혼합)", "FFN을 여러 전문가로 쪼개 토큰마다 일부만 활성화. 총 파라미터 크되 계산은 적게. (전문의 병원)", C.purple, C.purpleBg], ["Speculative Decoding", "작은 초안모델이 다음 몇 토큰 추측 → 큰 모델이 한 번에 검증. 2~3배 빠름, 품질 동일(무손실).", C.navy, C.navyBg]];
  const bw = 3.9, gap = 0.3; let x = 0.7; const y = 2.0, h = 3.5;
  e.forEach((c, i) => { card(s, x, y, bw, h, c[3]); numCircle(s, i + 1, x + 0.3, y + 0.3, c[2], 0.5); txt(s, c[0], { x: x + 0.95, y: y + 0.35, w: bw - 1.1, h: 0.5, fontSize: 16, bold: true, color: c[2], valign: "middle" }); txt(s, c[1], { x: x + 0.3, y: y + 1.15, w: bw - 0.6, h: 2.2, fontSize: 14, color: C.ink }); x += bw + gap; });
  txt(s, "그리고: 배칭(여러 요청 묶어 GPU 꽉 채움) + 서빙엔진(vLLM/Ollama)으로 “많이”.", { x: 0.7, y: 5.75, w: 12, h: 0.4, fontSize: 13, italic: true, color: C.mute, align: "center" });
})();

// 15 — ⑤ 증강 사다리 (flow)
(() => {
  const s = lightSlide();
  header(s, "⑤ 증강·에이전트", "모델은 고정, 바깥에서 능력 확장", C.navy);
  const lad = [["프롬프트/컨텍스트", "입력을 잘 짜기\n압축·캐싱", C.tealBg, C.teal], ["RAG", "관련 자료 넣기\n환각↓", C.tealBg, C.teal], ["도구", "외부 능력 호출\n(모델 결정,\n하네스 실행)", C.navyBg, C.navy], ["에이전트", "계획→실행→재계획\n루프", C.purpleBg, C.purple]];
  const bw = 2.7, gap = 0.4; let x = 0.9; const y = 2.5, h = 2.2;
  lad.forEach((b, i) => { card(s, x, y, bw, h, b[2]); txt(s, b[0], { x, y: y + 0.3, w: bw, h: 0.5, fontSize: 16, bold: true, color: b[3], align: "center" }); txt(s, b[1], { x: x + 0.15, y: y + 1.0, w: bw - 0.3, h: 1.0, fontSize: 13, color: C.ink, align: "center" }); if (i < 3) arrowR(s, x + bw + 0.05, y + h / 2, gap - 0.1, C.mute); x += bw + gap; });
  txt(s, "원칙: 가장 단순한 것부터. 에이전트 복잡도는 평가가 정당화할 때만 (지연·비용 ↔ 성능).", { x: 0.7, y: 5.2, w: 12, h: 0.5, fontSize: 14, color: C.ink, align: "center" });
})();

// 16 — RAG + 에이전트
(() => {
  const s = lightSlide();
  header(s, "⑤ 증강·에이전트", "RAG(오픈북) + 도구 + MCP + 멀티모달", C.navy);
  card(s, 0.7, 2.0, 5.9, 2.2, C.tealBg);
  txt(s, "RAG — 검색 증강 생성", { x: 0.95, y: 2.2, w: 5.4, h: 0.4, fontSize: 16, bold: true, color: C.teal });
  txt(s, "답 전에 관련 자료를 찾아 같이 넣기. 키워드+의미+심볼을 RRF로 합치는 하이브리드가 최강. 검색을 잘하면 작은 모델도 똑똑해 보인다.", { x: 0.95, y: 2.7, w: 5.4, h: 1.4, fontSize: 14, color: C.ink });
  card(s, 6.8, 2.0, 5.9, 2.2, C.navyBg);
  txt(s, "도구 · MCP · 멀티모달", { x: 7.05, y: 2.2, w: 5.4, h: 0.4, fontSize: 16, bold: true, color: C.navy });
  txt(s, "• 도구: 모델이 “호출 요청”, 하네스가 실제 실행\n• MCP: 도구의 표준 콘센트(USB-C)\n• 멀티모달: 이미지·음성도 토큰으로 → 같이 처리", { x: 7.05, y: 2.7, w: 5.4, h: 1.4, fontSize: 14, color: C.ink });
  card(s, 0.7, 4.5, 12.0, 1.7, C.slate);
  txt(s, "에이전트 루프", { x: 0.95, y: 4.65, w: 3, h: 0.4, fontSize: 15, bold: true, color: C.purple });
  const loop = [["목표", C.slate], ["계획", C.navyBg], ["행동(도구)", C.navyBg], ["관찰", C.navyBg], ["종합 답", C.purpleBg]];
  let lx = 0.95; const ly = 5.2;
  loop.forEach((b, i) => { s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: lx, y: ly, w: 2.1, h: 0.7, fill: { color: b[1] }, line: { color: C.line, width: 1 }, rectRadius: 0.08 }); txt(s, b[0], { x: lx, y: ly, w: 2.1, h: 0.7, fontSize: 13, bold: true, color: C.ink, align: "center", valign: "middle" }); if (i < 4) arrowR(s, lx + 2.12, ly + 0.35, 0.28, C.mute); lx += 2.4; });
  txt(s, "↩ 부족하면 재계획", { x: 3.2, y: 5.95, w: 4, h: 0.3, fontSize: 11, italic: true, color: C.amber });
})();

// 17 — ⑥ 업계 스택
(() => {
  const s = lightSlide();
  header(s, "⑥ 업계·생태계", "LLM은 여러 층의 산업이다", C.teal);
  const layers = [["④ 앱·제품", "ChatGPT · Cursor · Perplexity · Ariadne", C.purpleBg, C.purple], ["③ 모델", "GPT · Claude · Gemini · Llama · Qwen · DeepSeek", C.navyBg, C.navy], ["② 학습·서빙", "PyTorch · Hugging Face · vLLM · Ollama", C.tealBg, C.teal], ["① 하드웨어", "NVIDIA GPU(CUDA) · TPU · 클라우드", C.amberBg, C.amber]];
  let y = 2.0;
  layers.forEach((l) => { card(s, 1.5, y, 10.3, 1.0, l[2]); txt(s, l[0], { x: 1.8, y, w: 3.0, h: 1.0, fontSize: 17, bold: true, color: l[3], valign: "middle" }); txt(s, l[1], { x: 5.0, y, w: 6.5, h: 1.0, fontSize: 14, color: C.ink, valign: "middle" }); if (y < 5) arrowD(s, 6.65, y + 1.0, 0.1, C.mute); y += 1.1; });
  txt(s, "칩(NVIDIA)과 앱(제품)이 돈을 벌고, 가운데 모델 층은 오픈모델 때문에 빠르게 상품화되는 중.", { x: 0.7, y: 6.4, w: 12, h: 0.4, fontSize: 13, italic: true, color: C.mute, align: "center" });
})();

// 18 — 오픈 vs 클로즈
(() => {
  const s = lightSlide();
  header(s, "⑥ 업계·생태계", "오픈 vs 클로즈드 — 가장 중요한 분기", C.teal);
  card(s, 0.7, 2.0, 5.9, 4.0, C.navyBg);
  txt(s, "클로즈드 (API)", { x: 0.7, y: 2.25, w: 5.9, h: 0.5, fontSize: 20, bold: true, color: C.navy, align: "center" });
  txt(s, "GPT · Claude · Gemini", { x: 0.7, y: 2.8, w: 5.9, h: 0.4, fontSize: 13, color: C.mute, align: "center" });
  txt(s, "✓ 최강 프런티어 성능\n✓ 운영 불필요\n✗ 비용·종속·데이터 외부 전송", { x: 1.1, y: 3.5, w: 5.1, h: 2.0, fontSize: 15, color: C.ink });
  card(s, 6.8, 2.0, 5.9, 4.0, C.tealBg);
  txt(s, "오픈 웨이트 (다운로드)", { x: 6.8, y: 2.25, w: 5.9, h: 0.5, fontSize: 20, bold: true, color: C.teal, align: "center" });
  txt(s, "Llama · Qwen · DeepSeek · Mistral", { x: 6.8, y: 2.8, w: 5.9, h: 0.4, fontSize: 13, color: C.mute, align: "center" });
  txt(s, "✓ 프라이버시·통제·무료 구동\n✓ 내 PC에서 (Ollama)\n✗ 보통 프런티어보다 한 발 뒤", { x: 7.2, y: 3.5, w: 5.1, h: 2.0, fontSize: 15, color: C.ink });
  txt(s, "역학: 프런티어가 앞서면 → 몇 달 뒤 오픈 모델이 따라와 → 그 능력을 무료·저가로 상품화. (Ariadne의 local-first가 의미 있는 이유)", { x: 0.7, y: 6.25, w: 12, h: 0.6, fontSize: 13, italic: true, color: C.mute, align: "center" });
})();

// 19 — 트렌드
(() => {
  const s = lightSlide();
  header(s, "⑥ 업계·생태계", "어디로 가나 — 트렌드 (2024~2026)", C.teal);
  const tr = [["추론 모델", "생각하고 답 (test-time compute)", C.purple], ["에이전트", "단발 답 → 스스로 여러 단계", C.navy], ["초장문 컨텍스트", "100K~1M (단 중간 잊음은 숙제)", C.teal], ["멀티모달", "이미지·음성·영상이 기본", C.amber], ["온디바이스 소형화", "폰·노트북에서, 라우팅으로 분업", C.navy], ["비용 폭락", "같은 성능 토큰값 매년 급락", C.teal]];
  const bw = 3.9, gap = 0.3, bh = 1.55; let x = 0.7, y = 2.0;
  tr.forEach((t, i) => { card(s, x, y, bw, bh, C.white); numCircle(s, i + 1, x + 0.25, y + 0.3, t[2], 0.5); txt(s, t[0], { x: x + 0.9, y: y + 0.32, w: bw - 1.1, h: 0.5, fontSize: 15, bold: true, color: t[2], valign: "middle" }); txt(s, t[1], { x: x + 0.3, y: y + 0.92, w: bw - 0.5, h: 0.55, fontSize: 12.5, color: C.mute }); x += bw + gap; if (i % 3 === 2) { x = 0.7; y += bh + 0.25; } });
  txt(s, "+ 표준화(MCP 등) · 안전/규제(정렬·레드팀·EU AI Act).  구체 순위는 분기마다 바뀌지만 이 방향은 견고.", { x: 0.7, y: 5.85, w: 12, h: 0.5, fontSize: 13, italic: true, color: C.mute, align: "center" });
})();

// 20 — 마무리 (dark)
(() => {
  const s = pres.addSlide(); s.background = { color: C.dark };
  s.addText("코스 완주 — 한 장으로", { x: 0.8, y: 0.7, w: 11.7, h: 0.7, fontFace: F, fontSize: 28, bold: true, color: C.white, margin: 0 });
  const items = [["① 표현", "토큰·임베딩으로 말을 숫자로", C.teal], ["② 계산", "어텐션(트랜스포머)으로 문맥을 섞어 다음 토큰 예측", C.purple], ["③ 학습", "사전학습→SFT→정렬→추론으로 똑똑하고 안전하게", C.navy], ["④ 사용", "디코딩·KV캐시·양자화·서빙으로 빠르고 싸게", C.amber], ["⑤ 증강", "RAG·도구·에이전트로 한계를 넘는다", C.teal], ["⑥ 업계", "오픈⇄클로즈 상품화, 평가는 내 골든셋이 진실", C.purple]];
  let y = 1.65;
  items.forEach((it, i) => { numCircle(s, i + 1, 0.9, y, it[2], 0.55); s.addText(it[0], { x: 1.7, y: y - 0.05, w: 2.2, h: 0.65, fontFace: F, fontSize: 17, bold: true, color: it[2], valign: "middle", margin: 0 }); s.addText(it[1], { x: 3.9, y: y - 0.05, w: 8.6, h: 0.65, fontFace: F, fontSize: 14.5, color: "CBD5E1", valign: "middle", margin: 0 }); y += 0.78; });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.8, y: 6.4, w: 11.7, h: 0.75, fill: { color: C.purple }, rectRadius: 0.1 });
  s.addText("깊게 읽기 →  docs/learn/03-llm-mastery/  (모듈 6개)", { x: 0.8, y: 6.4, w: 11.7, h: 0.75, fontFace: F, fontSize: 16, bold: true, color: C.white, align: "center", valign: "middle", margin: 0 });
})();

pres.writeFile({ fileName: "/tmp/deck/llm-deck.pptx" }).then((f) => console.log("WROTE", f));
