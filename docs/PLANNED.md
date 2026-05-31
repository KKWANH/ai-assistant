# Planned — not yet built

> Backlog. For what the product **is** (vs what's planned), see
> [`PRODUCT.md`](PRODUCT.md). Anything here is scoped against that
> definition — especially the layer model (a planned feature belongs to
> Layer 0/1/2/3).

Larger features the user has explicitly asked for that don't fit into the
current batch. Each block is sized so a future session can pick it up
without rediscovery.

---

## 1. Scheduled / event-triggered actions

> "포트폴리오 같은 경우 일정 분기나 이벤트 시 트리거하는 거시적 관점
> 분석을 초거대 agent로 두고, 보고서 → 반영하는 것"

The **action engine** already runs block pipelines on demand
(`apps/server/src/runs/actionEngine.ts`). What's missing is a way to
fire them on a clock or on an external signal.

**Surface area:**
- New table `action_schedules` (id, action_id, cron, last_run_at,
  enabled, created_by).
- A lightweight in-process cron in the supervisor (or a node-cron
  package) — Ariadne is single-tenant so a per-process scheduler is
  fine; no Redis / queue.
- Webhook endpoint for event triggers (`POST /api/triggers/:secret`)
  for things like "fire when CI fails" or "fire when a file in the
  workspace changes". The webhook receives a payload and runs a named
  action with that payload bound to the first `read_file` or `ask_ai`
  block.
- UI: a new tab `Schedules` next to `Actions` in WorkspaceOverview;
  cron picker (presets: hourly / daily / weekly / monthly + raw
  cron); enable/disable toggle; "Run now" button.

**File-writeback step.** The user wants the report to *modify* the
workspace ("보고서 → 반영"). Add a new block type `write_file` with
config `{ path, mode: "append" | "replace" }` so a macro_brief can
end with a step that appends the brief to `monthly-briefs/2026-05.md`.

**Already in place from this batch:** the `monthly_macro_brief` action
in the portfolio starter is the *runnable target* — it just needs a
schedule wrapper to become the auto-triggered system the user
described.

**Effort estimate:** 1 batch. Tables + cron + scheduler tab + the new
`write_file` block.

---

## 2. Claude Code-style coding feature → local-Claude-Code replacement

> "claude code같은 코딩 기능을 넣는건 어떤가? 나중에 로컬모델을
> 추가해서 local claude code 대체도 되는거지."

Today Ariadne can *talk about* code (attach a file, ask a question) and
the agent can `read_file`, but it can't *edit* files or run a multi-step
refactor. Building toward a coding-agent overlap with Claude Code means:

**Phase A — file editing as a first-class block:**
- New action block types: `edit_file` (search-and-replace, with diff),
  `write_file` (overlap with the scheduling work above), `run_tests`
  (spawns the workspace's test command captured in `.ariadne/config.yaml`),
  `run_command` (any allow-listed shell command).
- A built-in `coding_session` action that chains read → propose patch
  → ask user to confirm → write → run tests, with re-plan on test failure.
- Diff preview in the run view before the file is actually written —
  this is the safety primitive that makes the rest acceptable.

**Phase B — IDE-shaped UI for code workspaces:**
- A new surface variant or a new workspace template `code` that
  ships with a code-focused dashboard: file tree, diff view, test
  results panel.
- Inline-edit affordance on `read_file` block results in the run view
  so the user can hand-tweak the model's suggestion before committing.

**Phase C — local-model swap:**
- Ariadne already abstracts providers (`apps/server/src/providers/index.ts`).
  A coding-tuned local model (e.g. via Ollama: `qwen2.5-coder` or
  `deepseek-coder`) plugs in with no API changes.
- Add a coding-aware model preset that bumps the agent's MAX_STEPS,
  lengthens STEP_TIMEOUT, and biases the planner toward `read_file →
  edit_file → run_tests` cycles.

**What we're explicitly NOT taking on:**
- Real-time pair-programming UI (Cursor's strength).
- Multi-file mass refactors with token-streamed previews.
- Building our own LSP integration — we use the workspace's existing
  test command and file paths instead.

**Effort estimate:** 3–4 batches. Phase A alone is ~2 batches because
the diff-preview UX is non-trivial; Phase B is most of a batch; Phase
C is small if the provider abstraction holds (which it should).

**Sequencing recommendation:** ship the scheduling work (#1) first
because it shares the `write_file` block. Then start Phase A of the
coding work.

---

## 3. Desktop app (Tauri sidecar)

> "웹 뿐 아니라 코드그대로 재사용해서 프로그램으로 만들어서 앱으로 만드는
> 기획은 어때?"

Wrap the existing Node server + React SPA in a Tauri shell so users
double-click an icon instead of `git clone`. Architecture, phasing, native
dep handling, signing/notarization, and open decisions are written up in
full at [`docs/DESKTOP_APP_PLAN.md`](DESKTOP_APP_PLAN.md).

**TL;DR:** sidecar pattern (Tauri Rust shell hosts WKWebView + spawns the
unchanged Node server). One small code change required up-front
(`ARIADNE_PORT` env var in `apps/server/src/index.ts`). Phase 0 spike: 1–2
days. macOS-first MVP: 1 week. Win + Linux: another week.

**Effort estimate:** 2–3 batches for v1 (macOS only). Multi-platform CI is
another batch.

---

## 4. Other deferred items (from earlier conversations)

- **Embedding-based retrieval** to replace the current keyword ranker
  in `apps/server/src/services/retrieval.ts`. Interface is already
  designed for swap.
- **PDF / DOCX / PPTX full parsing** with OCR fallback (placeholder
  in the README capabilities list).
- **Workspace git history** — auto-commit `.ariadne/` snapshots on
  every run.
- **Template marketplace** — ship-able templates beyond the four
  built-in starters.
- **Team workspace visibility** — currently private / public are
  per-machine; team scopes need an org concept first.

These are noted but not prioritized; they appear in `PRODUCT_PLAN.md`
under v0.2+.
