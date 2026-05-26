# Screenshots

The PNGs the top-level README references. The README and the live `/tutorial`
page complement each other — the tutorial uses live components and SVG
diagrams (which always reflect the current UI), while real screenshots in the
README are best for quick scanning by visitors who haven't run the app yet.

## How to capture

Pick whatever is easiest:

- **macOS** — `⌘⇧4 Space` over the browser window, then save as the listed
  filename in this folder.
- **Scripted** — Playwright / Puppeteer is welcome if you want them
  reproducible; the dev server is at `http://localhost:5173` and the daemon
  reads `data/portfolio/` for the demo state (was `data/demo-portfolio/`
  before the AG promotion — older clones may still have files under the
  old path; the boot seeder migrates the DB rootPath automatically).

Capture in **dark theme** at roughly **1400 × 900** unless noted, and crop to
exclude the OS chrome.

Once a PNG lands here, the matching `![]` reference in the top-level README
renders on GitHub immediately.

---

## The eight required shots

### 1. `portfolio.png` — Portfolio dashboard (custom surface)

- **Route:** `/workspaces/ariadne-demo-portfolio` → **Custom screen** tab.
- **State:** Demo `Portfolio` workspace open; base-currency dropdown reads
  "기준 통화: USD" (or "Base currency: USD" in English mode).
- **Focus:** The dashboard's five KPI cards (평가 가치 / 매입 원가 / 평가 손익
  / 환율 효과 / 최고 수익 종목), the value-trend line chart, and the
  **● 라이브 시세** badge in the surface header. Include the whole surface but
  not the outer chat sidebar.
- **Why it matters:** This is the most visually striking proof that workspaces
  carry their own dashboards with live data — not "another chat UI".

### 2. `workspace-overview.png` — Conversations-first overview

- **Route:** `/workspaces/ariadne-tutorial` → **Create & runs** tab
  (the default).
- **State:** Tutorial workspace with at least one chat attached to it. Make
  sure the **대화 (Conversations)** section is visible at the top of the
  scrollable area, right under the snapshot stats row.
- **Focus:** From the top of the right pane through at least the start of
  the "무엇을 만들까요?" templates list. The lifted-up chat section is the
  point — it should sit *above* the templates.
- **Why it matters:** Demonstrates the chat-first workspace UX that
  differentiates Ariadne from template-first run tools.

### 3. `actions-editor.png` — Block pipeline builder

- **Route:** `/workspaces/ariadne-demo-portfolio` → **액션 / Actions** tab.
- **State:** At least one action with two or three blocks (e.g.
  `read_file` → `ask_ai` → `format`). If none exists, capture the empty
  state with the block-type chips on display.
- **Focus:** Block-type chips (파일 읽기 / AI 질문 / 인터넷 분석 / 스크립트
  실행) visible at least once, with one action's pipeline expanded and an
  action name + description filled in.
- **Why it matters:** Shows that "actions" are real first-class composable
  things, not a hidden YAML.

### 4. `action-run.png` — Per-block timeline + result

- **Route:** After running an action: `/runs/{id}`.
- **State:** A completed action run — e.g. run the "포트폴리오 요약" action
  from the demo. The run should have a green `완료 / Completed` badge.
- **Focus:** The page title (action name), the green status badge, the
  **결과 / Result** card with the AI summary, and the **단계 / Steps**
  timeline with each block ticked off.
- **Why it matters:** Proves an action isn't a black box — every block's
  intermediate result is inspectable.

### 5. `intent-chip.png` — Live action suggestion in chat

- **Route:** A chat attached to the Portfolio workspace.
- **State:** Send the message **"내 포트폴리오를 요약해줘"** (Korean) or
  **"summarise my portfolio"** (English). Within a second or two the chip
  should appear above the composer.
- **Focus:** Capture the moment the suggestion chip is visible — chip shows
  the matched action name + a one-line reason, with **Run** and **닫기 /
  Dismiss** buttons. Include the composer below for context.
- **Why it matters:** This is one of Ariadne's most distinctive UX moments —
  the workspace mid-stream telling you it knows a faster path.

### 6. `agent-mode.png` — Plan-and-execute unfolding

- **Route:** Any chat (preferably the tutorial workspace).
- **State:** Toggle the **에이전트 / Agent** chip in the composer to `on`
  (click twice from default `off`). Send something multi-step like
  **"이 폴더에서 최근 변경된 파일들의 핵심을 정리해줘"** or
  **"compare what changed across these files and summarise the trend"**.
- **Focus:** The plan steps unfolding under the user message — the checklist
  with `pending / running / done` states for each step. Capture mid-flight
  (one or two steps ticked, one running) for the most informative shot.
- **Why it matters:** Demonstrates that Ariadne's agent is observable, not
  a hidden process behind a loading spinner.

### 7. `edit-regenerate.png` — Edit a message, fresh reply streams

- **Route:** Any existing chat with at least one user message + one
  assistant reply.
- **State:** Hover the user message until the ✏️ pencil reveals on the left.
  Click → edit the text → press ⌘+Enter (or click 저장 / Save). The
  assistant reply will replace itself with a new streamed answer.
- **Focus:** The "수정됨 (N) / Edited (N)" badge below the edited bubble,
  plus the new assistant reply beneath. Optionally take a *second* shot
  with the history popover open to show the prior versions.
- **Why it matters:** Edits-with-history-and-regenerate is rare in
  chat tools; this single visual conveys it.

### 8. `tutorial.png` — Tutorial page with SVG diagrams

- **Route:** `/tutorial`.
- **State:** Scroll to a section that includes one of the visual diagrams —
  the **워크스페이스 / Workspaces** section (folder → workspace → chat
  arrow diagram) and the **에이전트 / Agent** section both work well.
- **Focus:** One section heading, its prose, the SVG diagram, and a hint
  of the navigation to the side or top.
- **Why it matters:** Proves the project has a real onboarding story, not
  just a README.

---

## Optional bonus shots

If you want extras for social media or a blog post:

- **`composer-modes.png`** — close-up of the composer's chip strip showing
  the tri-state Agent (`off / auto / on`) and Web search (`off / auto / on`)
  pills with their three states side by side.
- **`settings-providers.png`** — Settings page showing the six AI providers
  with their status chips (Active / Key set / Key required / Reachable).
- **`workspace-rename.png`** — hover the workspace title until the pencil
  reveals, then click to enter inline-edit mode.

These aren't referenced from the main README but make great supplementary
material for promotion (see [`docs/PROMOTION.md`](../PROMOTION.md)).
