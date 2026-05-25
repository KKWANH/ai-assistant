# Positioning — what Ariadne is (and isn't)

This is the strategy document. It tells anyone working on Ariadne — or
writing about Ariadne — what bets we're making, which battles we're not
fighting, and what features matter because of that.

Supersedes the "Quick start / Highlights / Screenshots" narrative in
README for *direction* questions. README still owns *what does it do*;
this owns *why it exists*.

---

## 1. The one-line frame

> **Ariadne is a local-first work OS for your folders — AI reads, searches,
> automates, and edits with staged-diff review, and gets measurably better
> the more you use it.**

### Promotion-learning, not "self-learning"

> **Ariadne does not train on your data. It improves by turning your
> corrections into eval cases the next version has to pass.**

This is the tagline that goes on the launch post + the top of the
README + every external pitch. It is the **honest** version of the
"self-learning agent" claim other tools make. Importantly, it is
*also* the version we can prove: every promoted eval case is a public
artifact in `apps/server/src/eval/cases/` that any reviewer can
re-run with `npm run eval:retrieval:promoted`.

Drop this language in three places, in this order of priority:

1. **README headline** (above-the-fold quote)
2. **Show HN / r/LocalLLaMA / GeekNews launch posts** — leads the body
3. **Onboarding / tutorial page 1** — replaces any vague "AI learns
   from you" copy

Six load-bearing words in the one-line frame:

| Word | Why it's in the sentence |
|---|---|
| **local-first** | Your files never leave your machine unless you explicitly opt in. Same machine, same disk. |
| **work OS** | Not "chatbot." Not "code editor." A *layer* over your folders. The unit of work is a workspace, not a message. |
| **folders** | Plural. Code, notes, PDFs, CSVs, research papers — all first-class. Code is a use case, not the use case. |
| **automates** | Action pipelines + schedules turn one-shot AI work into repeatable, auditable jobs. |
| **staged-diff review** | AI never writes to disk silently. Every edit lands in `.ariadne/staged/` for human review. |
| **measurably better** | Eval harness + eval-case promotion. The product visibly improves as you use it — not just because we ship updates. |

---

## 2. What Ariadne is not

Being explicit about non-positioning is half the work.

### 2.1 Not a Claude Code / Cursor alternative

Claude Code, Cursor, and the IDE-integrated coding agents win the
"editor-first, real-time, code-only" race. They have CLAUDE.md, MCP, hooks,
subagents, agent teams, IDE/terminal integrations, git/PR workflows. We
will not catch them on that axis and we shouldn't try.

**Where we differ**: Ariadne is workflow-first, not editor-first. Code is
one of several first-class material types. The unit of work is a workspace
(folder) that runs the same actions on every schedule, not a session in an
IDE. We use the user's existing editor for the actual code-reading and
editing flow — we provide the *staged diff*, the *test loop*, and the
*workspace context*, not the typing surface.

### 2.2 Not a T3Code-style "thin GUI for Codex/Claude/OpenCode"

T3Code's pitch is "minimal, fast GUI over existing coding agents." Good
pitch, but a different shape. Ariadne is heavier and intentionally so —
we have storage, indexing, eval, surfaces, schedules, custom actions.
That's the price of being a work OS, not a launcher.

If a user wants the lightest possible chat-over-an-agent GUI, T3Code is
the right tool. Ariadne is the right tool when the chat is one panel of a
larger workspace.

### 2.3 Not a multi-tenant SaaS

Ariadne runs on the user's machine. The Cloudflare tunnel exposes a
single user's instance to their own devices, not a fleet of users to a
hosted service. We have no "team plan" and won't until org-scoped
permissions are a real thing (v0.3+ territory).

### 2.4 Not a "Hermes-style self-learning agent"

We do not fine-tune a model on user data. The "measurably better" promise
is delivered via *promotion* — bad answers get promoted to eval cases,
user preferences get promoted to workspace memory, successful runs get
promoted to action templates. The model doesn't change; the surrounding
system gets smarter. No phantom-AGI claims.

---

## 3. The three canonical demos

Everything we build should make at least one of these demos stronger.
Features that don't reinforce a demo are speculative complexity.

### 3.1 Demo A — "Folder → Dashboard" (portfolio / data work)

**Setup**: a folder of CSV holdings exports.
**One-line pitch**: register the folder, get a typed holdings table, a
value chart, and a monthly report action.
**Key features it exercises**: workspace scan · custom surface
(`surface.tsx`) · structured data extraction · scheduled actions.
**Audience**: investors, analysts, researchers tracking time series.

### 3.2 Demo B — "Docs folder → Research assistant" (RAG with receipts)

**Setup**: a folder of PDFs + markdown research notes.
**One-line pitch**: ask a question, get an answer grounded in named
chunks with file paths; if the answer is wrong, click 👎 and that
question becomes a permanent eval case the harness runs forever.
**Key features it exercises**: hybrid retrieval · eval-case promotion ·
RAG harness · `analyze_image` for figures.
**Audience**: researchers, students, knowledge workers.

### 3.3 Demo C — "Code folder → Safe AI editing"

**Setup**: a code repo.
**One-line pitch**: ask AI to make a change. It produces a staged diff
under `.ariadne/staged/`. Review, apply or discard. If applied, the
change is auto-committed to `.ariadne/` git history and can be rewound.
**Key features it exercises**: agent mode · `edit_file` (staged, never
direct) · runs/diff view · git rewind.
**Audience**: developers who want AI-assisted changes but distrust
"AI auto-modified your files" defaults.

These three are the test for any roadmap question: *does this make
demo A, B, or C stronger?*

---

## 4. Feature priority that falls out of the frame

The frame above generates this priority order (top = most aligned).

### Tier 1 — directly reinforces the wedge

- **Eval-case promotion**. Bad chat reply / bad search result → click →
  becomes a permanent eval case. Compounds every use. Nobody else does
  this. (Demo B core.)
- **Workspace memory with promotion gate**. AI discovers preferences;
  user approves; `.ariadne/memory.yaml` accumulates. (Demo A and B.)
- **Hook system**. After staged edit lands, auto-run typecheck / format
  / eval / security scan. Configured per workspace in `.ariadne/hooks/`.
  (Demo C core.)
- **MCP client**. Agent can call external MCP tools. Sidesteps the
  Cursor/Claude Code/Codex race by being the layer *above* them.
- **Three killer demos** as real, recorded, runnable: a CSV portfolio
  fixture (Demo A), a PDF research fixture (Demo B), a small code repo
  fixture (Demo C).

### Tier 2 — strengthens the surface

- **Action DSL control flow** (conditionals, retry, branch) — *but only
  when a real use case demands it*. Don't speculate.
- **MCP server** (expose Ariadne actions as MCP tools). Tier 2 because
  it's value-multiplied by Tier 1 MCP client.
- **Better search/retrieval debugging UI** (why did this chunk rank
  higher? show RRF components).

### Tier 3 — interesting but not on the critical path

- **Subagent role split** (Explorer / Editor / Verifier). Has value *if*
  context bleed becomes a real problem. Defer until evidence.
- **Agent teams**. Claude Code's own docs say experimental, high token
  cost. Wait until the pattern is proven.
- **Action runtime unification** (merging chat-agent and action-engine
  into one runtime). Wrong tradeoff — they serve two different mental
  models. Keep them separate; unify the *primitives* (block library)
  not the runtimes.
- **Mobile apps**. Tauri Mobile is alpha; iOS file-access policy is its
  own rabbit hole.

---

## 5. What "measurably better" actually means

Concrete commitment, not vibes:

- **Eval harness produces a public score on every change** (Hit@1,
  Hit@6, MRR, nDCG, indexed coverage, faithfulness). Already wired.
- **CI gate** is soft (warning) for fragile metrics, hard (fail) for
  catastrophic regressions. Already wired.
- **Eval cases grow over time**. The first 26 are hand-curated. As
  users promote bad answers, that pool grows. A workspace with 200
  promoted cases is, by construction, a workspace whose retrieval
  *has been tested against the user's actual confusions*.
- **The promoted cases are portable**. `apps/server/src/eval/cases/user-promoted/`
  is checked into the user's `.ariadne/` per-workspace folder, not into
  Ariadne's repo. Move the workspace, take the eval cases with you.

The eval harness is the *credibility layer*. It's why "measurably
better" isn't marketing.

---

## 6. How this changes the public-facing story

### 6.1 README rewrite (eventual)

The current README opens with screenshots and a quick-start. After this
positioning lands fully, the README should open with the one-line frame
(§1) and a "what is this for / what is this not" pairing (§2). The three
demos (§3) replace the current "Highlights" section with concrete,
runnable links.

### 6.2 Tagline candidates

| Variant | When to use |
|---|---|
| Local-first AI workspace for your folders | Default / homepage |
| Reads your folder. Edits with staged diffs. Gets better every time you say "no, that's wrong." | Long-form / blog |
| AI that learns *your* folder, not the internet's | Comparison / contrast posts |

### 6.3 What we stop saying

Drop from all surfaces:

- "Cursor / Claude Code alternative" (mis-frames the wedge)
- "Local-first coding agent" (Demo C is one of three, not the headline)
- "Self-learning" (we don't fine-tune; "promotion-learning" is honest)
- "All-in-one AI workspace" (too generic, lots of products say this)

---

## 7. The "should we build X?" decision rule

For any proposed feature, ask in order:

1. **Does it make Demo A, B, or C visibly stronger?** If yes → Tier 1
   or 2. If no, continue.
2. **Does it remove a barrier preventing a Demo from working at all?**
   (Auth, install friction, native deps, accessibility.) If yes → Tier 2.
3. **Is it on a competitor's critical path that we *can't* differentiate
   from?** If yes → don't build it. (Real-time editor autocomplete,
   IDE-tab management, etc.)
4. **Is it speculative — interesting but no concrete user demand?**
   Default no, unless explicitly time-boxed as research.

This rule + the three demos should resolve 80%+ of roadmap arguments
without further debate.

---

## 8. Open positioning questions

These are unresolved as of this writing. Each blocks a specific
downstream decision.

1. **Pricing model** if/when this stops being free. Local-first means no
   hosting cost on our side, which makes pure-OSS viable, but a
   "supporter tier" with hosted backups / template marketplace /
   priority models is also viable. Defer until the desktop app ships.

2. **Open-source license**. AGPL would prevent SaaS clones; MIT
   maximises adoption. Lean MIT for v0.1, revisit if a clone emerges.

3. **Brand split** if the desktop app gets traction — does
   "Ariadne Desktop" become the primary product and the web build
   becomes "Ariadne Server" for tunnel/remote users? Decide when desktop
   v0.1 ships.

---

## 9. References

- [`docs/PRODUCT_PLAN.md`](PRODUCT_PLAN.md) — feature vision (this doc
  refines its *positioning*, not its *content*).
- [`docs/RAG_HARNESS.md`](RAG_HARNESS.md) — the eval harness that backs
  the "measurably better" claim.
- [`docs/DESKTOP_APP_PLAN.md`](DESKTOP_APP_PLAN.md) — how the work-OS
  framing translates to a desktop binary.
- [`docs/PLANNED.md`](PLANNED.md) — deferred work, prioritised against
  the demos in §3.
