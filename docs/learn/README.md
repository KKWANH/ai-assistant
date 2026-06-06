# docs/learn — Ariadne 입문 자료 (한글)

AI·RAG·에이전트 하네스를 **기초 0**에서 설명하는 짝꿍 자료입니다.

| 파일 | 용도 | 보는 법 |
|---|---|---|
| [`01-rag-harness-explainer.md`](01-rag-harness-explainer.md) | **상세 읽기** — 비유·다이어그램·실제 코드/숫자 | GitHub·VS Code·Obsidian (mermaid 그림 자동 렌더) |
| `02-rag-harness-deck.pptx` | **큰 그림** — 16슬라이드, 한글, 페이드 전환 + 흐름 슬라이드 cascade 애니메이션 | PowerPoint·Keynote (발표 모드에서 애니메이션 재생) |

추천 순서: **PPT로 큰 그림 → MD로 깊게.**

> **애니메이션 참고:** 모든 슬라이드에 페이드 전환이 있고, 흐름 슬라이드(2·6·11)는
> 클릭하면 요소가 차례로 나타납니다. 정적 미리보기(PDF/이미지)에서는 최종 상태만
> 보입니다 — 실제 애니메이션은 Keynote/PowerPoint 발표 모드에서 보세요.

### 덱 다시 만들기 (편집·재생성)
```bash
cd /tmp && mkdir -p deck && cd deck
cp <repo>/docs/learn/deck/build.js .
cp <repo>/docs/learn/deck/inject-animations.py inject.py
npm init -y && npm install pptxgenjs
node build.js                 # → ariadne-deck.pptx (정적)
python3 inject.py             # 페이드 전환 + cascade 애니메이션 주입
```
`build.js` = 슬라이드 레이아웃(코드로 그림), `inject-animations.py` = PowerPoint 애니메이션 XML 주입.
