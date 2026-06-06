# Demo workspaces — the three killer demos

Per the launch-prep checklist:
the README leads with three demos because those are the three audience
segments where Ariadne is unambiguously better than the alternatives.

The starter workspaces that back each demo already ship in the repo
(`apps/server/src/surface/*Starter.ts` + `apps/server/src/tutorialWorkspace.ts`).
This doc names which starter backs which demo, what the recording script
should capture, and the exact commands to reproduce.

## Demo 1 — "Docs folder → answer with evidence"

**Starter:** `Research papers` (from the workspace dialog)

**What it ships with**:
- A small `notes/` folder with seed Markdown observations
- A `papers.bib` BibTeX file with sample entries
- A surface dashboard that flags dangling citations (cited in notes but
  missing from `.bib`, or vice versa)
- A `read_paper` action template

**Recording target (≤2 minutes, no audio)**:

1. Open `Research papers` from the workspace dialog (0:00–0:05)
2. Land on Chat tab; type *"Summarise the consensus across these
   papers on X."* (0:05–0:25)
3. Streaming answer renders with **inline citation markers** —
   point at one (0:25–0:40)
4. Click the citation; the **claim-to-source map** opens and
   highlights the exact paragraph in the source file (0:40–0:55)
5. Show the **unsupported claims** strip at the bottom of the
   evidence panel — these are the model's claims that the corpus
   couldn't fully support (0:55–1:15)
6. Click "Save bad answer as eval case" on a wrong answer; the
   modal opens, fill in expected behavior, save — that case is
   now in `apps/server/src/eval/cases/promoted/` and runs in CI
   (1:15–1:55)

**Why this demo over a chat demo**: the difference is the **claim →
source** trail and the **unsupported-claims** column. Anyone can show
a streaming markdown answer. Nobody else shows the receipts.

---

## Demo 2 — "CSV folder → dashboard + monthly report"

**Starter:** `Investment portfolio`

**What it ships with**:
- A `holdings.csv` with multi-currency positions
- A custom TypeScript surface (`.ariadne/surface.tsx`) with live FX +
  stock-quote integration
- A `monthly-portfolio-brief` action template
- A weekly-digest schedule registered out of the box

**Recording target (≤2 minutes, no audio)**:

1. Open `Investment portfolio` from the workspace dialog (0:00–0:10)
2. Land on the **Custom screen** tab — the 5 KPI cards (value,
   cost, P&L, FX effect, top performer) populate from `holdings.csv`
   with live FX rates (0:10–0:30)
3. Hover the **● 라이브 시세** badge → the surface fetched real
   quotes via the postMessage SDK in a sandboxed iframe (0:30–0:45)
4. Switch to **Create & run** tab; click *Monthly portfolio brief*
   (0:45–1:00)
5. Action runs through `read_file holdings.csv` → `ask_ai` →
   `write_file briefs/{date}.md` — the brief lands in the
   workspace folder (1:00–1:30)
6. Open the **Schedules** strip and show the weekly-digest entry
   that re-runs the same action automatically (1:30–1:55)

**Why this demo over a chat demo**: surfaces + actions + schedules
are the "this is a *work OS*, not a chatbot" pitch in one shot.
Bonus: zero AI cost to render the dashboard — only the report
generation hits the model.

---

## Demo 3 — "Code folder → staged AI edit → test → apply"

**Starter:** `Code project`

**What it ships with**:
- A tiny TypeScript project with one buggy function + a failing test
- An `edit_file` demo action that targets the buggy function
- The full staged-diff workflow gated through `/runs/<id>/diff`

**Recording target (≤2 minutes, no audio)**:

1. Open `Code project` from the workspace dialog (0:00–0:10)
2. Chat: *"The `formatPrice` function fails on negative inputs. Fix
   it and make the test pass."* (0:10–0:25)
3. **Agent mode** kicks in — the plan strip shows
   `read_file → reason → edit_file → run_tests` (0:25–0:45)
4. `run_tests` **fails** on first attempt → conditional re-plan →
   second `edit_file` (0:45–1:10)
5. `run_tests` passes; the chat shows a chip
   *"1 staged edit · review & apply →"* (1:10–1:25)
6. Click through to `/runs/<id>/diff` — per-file checkboxes, the
   side-by-side line diff (1:25–1:45)
7. Click **Apply selected** — file changes commit; the `.ariadne/`
   workspace git auto-commits the apply (1:45–2:00)

**Why this demo over Cursor / Claude Code**: the staged-diff +
re-plan-on-test-failure loop. The reviewer named this exactly:
*"AI never silently writes to disk"* and *"fix-until-tests-pass"*
in one workflow. That is the legibility claim.

---

## Recording standards (all three)

- **Resolution**: 1400 × 900, dark theme
- **Format**: MP4 + GIF (GIF for the README, MP4 for blog/HN)
- **Caption**: a single sentence in the file basename (e.g.
  `demo-research-claim-to-source.mp4`)
- **No audio** in the GIF; voiceover only in the long-form MP4
- **State**: fresh workspace, no prior chats, the starter's seeded
  files only — recordings done with cluttered workspaces undersell
  the product
- **Cursor**: visible, not hidden — viewers want to see where the
  click lands

A re-recording cadence: every minor version, redo the demo that touched
the screenshotted code path. The recordings are part of the product
surface area, not promo material.

---

## Where the demos live

- README links to the demo GIFs —
  filename convention: `demo-research.gif`, `demo-portfolio.gif`,
  `demo-code-safe-edit.gif`
- Long-form MP4s eventually live wherever the launch blog ends up
  (own domain ideal; YouTube fine until then) — same filenames with
  `.mp4` extension
- Until the recordings exist, the README rows for these demos render
  the descriptive text per the existing placeholder table — they do
  not point at broken `<img>` tags

## Pre-recording checklist

- [ ] All three starters open cleanly with no error toasts
  (`ariadne start` → workspace dialog → each starter → no console
  errors in devtools)
- [ ] Sample data in each starter is current — the buggy function in
  `Code project` still fails on the seeded test, the portfolio CSV
  has fresh-enough date stamps to be plausible
- [ ] `eval:retrieval` passes the gates on the research-papers
  starter contents (you don't want a demo case to be a regression)
- [ ] Cloudflare tunnel disabled during recording — the tunnel URL
  in the screencast is noise

## What to record *next* (after the three)

- A 30-second "MCP server in action" clip — install a filesystem MCP,
  ask a question, show the agent picking `mcp_call`
- A 60-second "promotion-learning" clip — bad answer → "save as eval
  case" → CI run shows the case landing in the gate
- A 90-second "no-vendor-lock-in" clip — pick Anthropic, switch to
  Ollama mid-chat, switch to vLLM, no chat history loss
