# Screenshots

This directory holds the PNGs the main README references. The README and the
`/tutorial` page complement each other — the tutorial uses live components and
SVG diagrams (which always reflect the current UI), while real screenshots in
the README are best for quick scanning by visitors who haven't run the app yet.

## What each shot should show

Capture each at roughly 1400 × 900, dark theme, with the dev-mode demo
`Portfolio` workspace open.

### `portfolio.png` — Portfolio dashboard

Open the demo `Portfolio` workspace → **Custom screen** tab. The dashboard
should show its KPIs (평가 가치 / 매입 원가 / 평가 손익 / 환율 효과 / 최고
수익 종목), the value-trend line chart, and the **● 라이브 시세** badge in the
header. The base-currency dropdown should read "기준 통화: USD".

### `data-tab.png` — Data tab

Same workspace → **데이터** tab → select `holdings.csv`. Capture the editable
table with rows visible and the file picker chips at the top
(`fx_rates.csv` / `history.csv` / `holdings.csv`).

### `actions-editor.png` — Actions pipeline builder

Same workspace → **액션** tab. Either show an existing action with two or three
blocks (e.g. `read_file` → `ask_ai`) or the empty state. The block type chips
(파일 읽기 / AI 질문 / 인터넷 분석 / 스크립트 실행) should be visible at least
once.

### `action-run.png` — Action run view

After running an action from **만들기 및 실행**, capture `/runs/{id}` showing
the **포트폴리오 요약** title, the green `완료` badge, the **결과** card with the
AI summary, and the **단계** list with each block ticked.

### `intent-chip.png` — Chat intent suggestion

Open a chat attached to the Portfolio workspace, send something like
"내 포트폴리오를 요약해줘". Capture the moment the suggestion chip is visible
above the composer (the chip shows the action name and a one-line reason in
the same accent style as the table-paste banner).

### `agent-mode.png` — Agent plan-and-execute

In any chat, turn on **Agent** mode and ask something multi-step (e.g.
"이 폴더에서 최근 변경된 파일들의 핵심을 정리해줘"). Capture the plan steps
unfolding under the message.

## How to capture

Pick whatever is easiest:

- **System screenshot** (macOS `⌘⇧4 Space` over the browser window) is fine —
  the app is theme-aware so dark mode looks consistent.
- A scripted capture (Playwright / Puppeteer) is welcome if you want them
  reproducible; the dev server is at `http://localhost:5173` and the daemon
  reads `data/demo-portfolio/` for the demo state.

Once a PNG lands here, the matching `![]` reference in the top-level README
will render on GitHub immediately.
