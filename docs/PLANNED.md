# Planned — not yet built

> Backlog. For what the product **is** (vs what's planned), see
> [`PRODUCT.md`](PRODUCT.md). Every item here is scoped against that
> definition's layer model (Layer 0/1/2/3).
>
> **Reworked 2026-06-01.** The previous backlog planned to build several
> things that were *already shipped* (the scheduler, the file-editing
> blocks, staged-diff, local-model swap). This version corrects that, then
> re-frames the remaining work as three experience bets in priority order,
> with an explicit cut list. **Read §0 before planning anything.**
>
> **Priority (decided 2026-06-01).** Direction confirmed: Ariadne ships
> open-source, self-installed — the next user is a *stranger*, and the
> **cockpit (not chat) is the home**. So **Desktop (§2) is the #1 strategic
> bet**. Its one code prerequisite (§4.1 `ARIADNE_PORT`) is *already done*
> (see §2); it is blocked only on the Rust/Tauri toolchain. **Scheduling
> (§1) is the highest-value work buildable right now** with no new
> toolchain. §3 follows.

---

## 0. Reality check — already shipped, do NOT rebuild

The single most expensive mistake available here is rebuilding
infrastructure that already exists (cf. the portfolio-v2/v3 collision —
built on stale assumptions, threw it all away). Before planning anything,
know that these are **done and running**:

| Capability | State | Where |
|---|---|---|
| In-process scheduler | Live; ticks every 60s; hourly/daily/weekly/monthly; fires `createActionRun` like the manual Run button | `apps/server/src/services/scheduler.ts`, `apps/server/src/routes/schedules.ts`, started in `apps/server/src/index.ts` (`startScheduler()`) |
| `write_file` block | Done, with `{date}/{time}/{timestamp}` substitution | `apps/server/src/runs/actionEngine.ts` (`case "write_file"`) |
| `edit_file` block + staged diff | Done — search/replace with match-count safety, before/after snapshots | `apps/server/src/runs/actionEngine.ts` (`case "edit_file"`), `services/stagedEdits.ts`, `services/diff.ts` |
| `run_tests` / `run_script` blocks | Done — test pass/fail branching; shell/python with timeout | `apps/server/src/runs/actionEngine.ts` |
| Diff review → apply/discard → git rewind | Done — `/runs/:id/diff`; apply commits to a workspace-history git repo | `apps/server/src/services/stagedEdits.ts` (`applyStagedEdits`, `rewindApply`) |
| Local-model swap | Already possible — Ollama + vLLM wired behind one provider interface | `apps/server/src/providers/index.ts` |
| Workspace template **export** (BL1) | Shipped — `.ariadne.tar`, author-curated `seedFiles` only | `apps/server/src/services/workspaceTemplate.ts`, `GET /api/workspaces/:id/export` |

Genuinely **not** built: template **import** (no untar/route — confirmed
absent), the event-trigger **webhook**, the desktop shell, and the
scheduling / sharing **UI surfaces**. That gap is what this backlog is
actually about.

---

## 1. Bet — "It works while I'm away" (scheduling: the experience, not the engine)

> "포트폴리오 같은 경우 일정 분기나 이벤트 시 트리거하는 거시적 관점
> 분석을 초거대 agent로 두고, 보고서 → 반영하는 것"

The engine is **done** (§0): schedules fire on a clock, and a run can
already end with a `write_file`/`edit_file` step that writes the brief
back into the workspace (the "보고서 → 반영" the user asked for). The UI was
**also** mostly built — a `SchedulesSection` (list / add / pause / delete /
next-run + last-run) lived buried inside the "Create & runs" tab. Done vs
remaining:

- **Schedules tab** — ✅ **done (2026-06-01).** Added the missing **Run now**
  (reuses `useRunAction`; per-row busy + toast) and **promoted the section to
  its own tab next to Actions**, so the already-running scheduler is *visible*
  rather than buried. Verified live (tab renders next to Actions, row shows
  Run now / pause / delete, console clean). `WorkspaceOverview.tsx`
  `SchedulesSection` + the `schedules` tab.
- **Surface the brief** — ✅ **done (2026-06-01).** The Schedules tab links to
  where automated output lands ("Automated runs appear under Create & runs →")
  and scheduled/triggered runs show in Recent Runs. Richer push-notification
  surfacing is a deliberate later option, not a gap.
- **Event trigger** — ✅ **done (2026-06-01).** `POST /api/triggers/:secret`
  (public; the secret is the auth, allow-listed in the /api cookie gate) fires a
  bound action with the request body bound as the `payload` input. Owner-only
  create/list/delete + an **Event triggers** UI in the Schedules tab (copy the
  webhook URL). New `action_triggers` table; `routes/triggers.ts`. Verified E2E
  (create → fire with payload → run created → bad secret rejected → cleanup).

**Bet 1 is complete.** Engine + Schedules tab + Run now + event webhook + brief
surfacing all shipped.

---

## 2. Bet — "I double-click and it's just there" (desktop appliance)

> "웹 뿐 아니라 코드그대로 재사용해서 프로그램으로 만들어서 앱으로 만드는
> 기획은 어때?"

Ariadne's soul is an *appliance* — local-first, your-keys, single-process,
batteries-included. The remaining friction is the **unboxing**: `git clone`
+ npm + provider keys. A Tauri sidecar (Rust shell hosts WKWebView + spawns
the unchanged Node server) turns that into a double-click. This is the most
character-aligned item in the backlog — distribution *is* product — and the
core is now polished enough to deserve an installer.

Full architecture / phasing / signing in [`DESKTOP_APP_PLAN.md`](DESKTOP_APP_PLAN.md).
The plan's "one up-front code change" (§4.1 `ARIADNE_PORT`) is **already
done** — `packages/shared/src/config.ts` reads `ARIADNE_PORT` and
`app.listen` honours it, so the sidecar can already relocate the port.
Phase 0 needs *zero* server changes.

**Decided (2026-06-01) — this is the #1 strategic bet:**
- **Next user = a stranger** who installs the open-source app. The desktop
  unboxing (double-click; no `git clone` / Node / keys-in-shell) is exactly
  what they need.
- **The home is the cockpit, not chat** (see DESIGN_GUIDELINE §1.1, now
  reconciled: chat is the door, the run cockpit is the room). The first-run
  wizard should land the user *in the cockpit*.

**Phase 0 spike — ✅ scaffolded (2026-06-01).** `apps/desktop/` holds the
Tauri 2 shell (`src-tauri/`): picks a free loopback port, spawns the unchanged
Node server with `ARIADNE_PORT`, waits for readiness, opens a WKWebView at it,
and kills it on exit (~90 lines of Rust, no `apps/server` changes). `cargo check`
passes clean. To *see* it: `npm install` + `npm run tauri:dev --workspace
@ariadne/desktop` on a Mac (the GUI window can't be verified headlessly).
**Phase 1 remaining:** bundled Node binary as a real `externalBin` sidecar,
app-icon set, signing + notarization + auto-updater, OS-keychain for keys.

**Effort:** 2–3 batches for macOS-only v1; multi-platform CI is another.

---

## 3. Bet — "A workspace is a document I can hand to someone" (import; descoped from "marketplace")

> The old "template marketplace" — reframed. A federated marketplace (no
> central server) does preserve local-first, but a two-sided market with
> ~1 user is premature platforming. The move that fits the product is the
> **Mac document model**: a workspace is a document. **Export… / Open…**.

- **BL2 — import** (keep): `POST /api/workspaces/import` for an uploaded
  `.ariadne.tar` (Fastify multipart) + a Git-URL form. Extract (guard
  `../` / zip-slip), validate the manifest, create a workspace at a chosen
  rootPath, seed files, build the surface — mirror starter instantiation in
  `routes/workspaces.ts`. Frontend entry near "New workspace", framed as
  **"Open a workspace file."**
- **BL3 — trust** (minimal only): import shows the manifest + states that
  the surface is arbitrary JS in the existing sandbox (the BJ1 error
  boundary already contains a broken/hostile surface). No signing, no
  capability theater — a one-paragraph consent, not a subsystem.
- **CUT — BL4 discovery / featured list / `MARKETPLACE.md` / clone-as-a-
  product.** Premature. Revisit only when a second party actually wants to
  publish to a first.

**Verify:** export → "Open a workspace file" on a fresh machine → surface
builds + renders; network tab clean of non-tunnel hosts.

---

## 4. Explicitly not doing (and why)

Cutting these is the point. Focus is refusal — PRODUCT.md §2 (non-users)
and §5 (killer-feature ranking).

- **Coding agent, Phase B — the IDE-shaped UI** (file tree, diff view,
  test panel, a `code` workspace template). PRODUCT.md §2 names "people who
  want a Cursor/Claude-Code coding agent as the headline" an **explicit
  non-user**. An IDE shell is a different product for a person we chose not
  to serve.
  - The *useful* parts of the coding idea already exist or are free:
    **Phase A (file editing) is shipped** as a workspace capability (§0) —
    it completes the staged-diff invariant, which is on-thesis. **Phase C
    (a local coding model) is already possible** via the provider
    abstraction. Only the IDE costume is cut.
- **Marketplace discovery / trust-as-a-subsystem** (see §3). Premature
  two-sided market.

---

## 5. Hygiene — make the map match the territory

This backlog drifted from reality once; the docs have drifted too. One
batch to re-establish a single source of truth:

- **License contradiction:** `PRODUCT_STRATEGY.md` still argues AGPL in its
  body; the repo ships MIT (PRODUCT.md §6). Fix the body, not just the
  header banner.
- **Superseded banners:** PRODUCT.md §8 asked for a one-line "superseded by
  PRODUCT.md for definition" banner on each historical doc (PRODUCT_PLAN,
  POSITIONING, LAUNCH_PLAN, PROMOTION). Never done.
- **Orphan plans:** `CODE_EXECUTION_PLAN.md` (its Phase 1 `calculate` tool
  already shipped), `VLLM_PLAN.md` (research only), `SYMBOL_INDEX_PLAN.md`
  (parked) are not tracked in this backlog. Fold each in here with a
  status line, or delete it.
- **Design identity:** `DESIGN_GUIDELINE.md` §1.1 ("Run, Not Chat. Chat is
  secondary") is contradicted by the shipped chat-first app *and* by its
  own reversed footnote (≈line 1075). Rewrite it to the truth: **chat is
  the door, the run / trace / evidence cockpit is the room.** A reversed
  rule left as a footnote is where taste quietly dies.

---

## 6. Other deferred (kept)

- **Embedding-based retrieval** to replace the keyword ranker in
  `apps/server/src/services/retrieval.ts`. Interface already designed for
  the swap.
- **PDF / DOCX / PPTX OCR fallback** (placeholder in the README capability
  list).
- **Workspace git history.** Partial already: staged applies commit to a
  workspace-history git repo (`services/stagedEdits.ts`). The deferred ask
  (auto-commit `.ariadne/` snapshots on *every* run) overlaps — scope it
  against what exists before building anything.
- **Team workspace visibility** — needs an org concept first.

These appear in `PRODUCT_PLAN.md` under v0.2+; not prioritized.
