# Ariadne — Product Definition (Canonical)

> **This document is the single source of truth for what Ariadne is.**
> It supersedes the positioning/scope sections of `PRODUCT_PLAN.md`,
> `PRODUCT_STRATEGY.md`, `POSITIONING.md`, `LAUNCH_PLAN.md`, `PLANNED.md`,
> and `PROMOTION.md`. Those remain as historical context / execution
> playbooks, but where any of them disagree with this file on **what the
> product is, who it is for, or what the layers are**, this file wins.
>
> Last set: 2026-05-31. Owner: kwanhokim.

---

## 1. The one sentence

**Ariadne is a local-first AI workspace platform: end-users get a
batteries-included app on day one, and builders ship their own
domain apps as custom surfaces on top of the same engine — all running
on your own machine, against your own model keys, with every answer
traceable to its source.**

Shorter, by audience:

- **Homepage / GitHub:** "Local-first AI workspace for your folders — your files, your models, your trail."
- **For builders:** "An AI runtime you extend. Ship a dashboard as a sandboxed React surface; the host hands you files, quotes, retrieval, and the LLM."
- **One-breath:** "Notion-meets-Claude that runs on your laptop and that you can program."

This resolves the long-standing contradiction between the *origin*
framing ("a narrow evidence compiler, not an agent" — PRODUCT_PLAN) and
the *current* framing ("a broad work OS that also edits" — POSITIONING):
Ariadne is **a narrow, safe, traceable core** (the engine) **with a wide
extension surface** (the SDK). Narrow where safety matters, wide where
builders need room.

---

## 2. Who it is for

Three concentric rings. Decisions optimize for the inner ring first.

| Ring | Who | What they touch | Success = |
|---|---|---|---|
| **1. End-user** | Solo technical knowledge workers — analysts, researchers, professors/lecturers, investors, writers. Korean + English. | Chat, workspaces, the **Portfolio cockpit** (flagship app), document Q&A. | "It just works on my folder, and I trust the answers." |
| **2. Builder** | Developers who want a private AI app over their own data without building a backend. | The **custom-surface SDK** (sandboxed React + postMessage host API), templates, actions, MCP. | "I shipped my vertical in an afternoon; the host gave me files + quotes + LLM." |
| **3. Self-host operator** | Same person, ops hat. Family/small-group sharing (e.g. running it for a parent). | Install, Cloudflare tunnel, multi-account, access split. | "One process on my box serves me and the people I trust." |

**Explicit non-users (v1):** enterprise/SSO/RBAC/multi-tenant teams;
people who want a Cursor/Claude-Code coding agent as the headline;
casual one-shot Q&A users who don't have a folder of work.

---

## 3. The layer model (the thing that was never written down)

This is the mental model that ends the "is it a harness or an app?"
confusion. **It is both, in stacked layers.**

```
┌─ Layer 3 — APPS (verticals on top of the platform) ──────────────┐
│   Portfolio cockpit  ← flagship reference app (deep)             │
│   reading · budget · chefbook · code · decisions · papers (starters)│
│   <your vertical>    ← built via Layer 2                         │
├─ Layer 2 — EXTENSION (the platform's product surface) ───────────┤
│   Custom surfaces: sandboxed React bundles, postMessage SDK      │
│     (readCsv/readText/listFiles/getQuotes/getFxRates/            │
│      getQuoteHistory/getQuoteCalendars/getQuoteNews/             │
│      getDividendHistory/stageFile)                               │
│   Templates · Actions · Runs · Schedules · Skills · Memory · MCP │
├─ Layer 1 — WORKSPACE (file grounding) ───────────────────────────┤
│   Local folder → scan → snapshot → retrieval                     │
│     (embedding + keyword + symbol-index hybrid)                  │
│   Document pipeline: PDF/DOCX/PPTX/XLSX/HWP → markdown            │
│     (markitdown + PyMuPDF auto-dispatch; LibreOffice screenshots;│
│      hash-keyed cache; scan-time warm queue; SSE push)           │
├─ Layer 0 — ENGINE (the harness core) ────────────────────────────┤
│   Multi-provider LLM gateway (Anthropic/OpenAI/Gemini/Moonshot/  │
│     Ollama) + per-run token-priced cost                          │
│   Chat (SSE stream) · Agent mode (plan→execute→replan + approval)│
│   Evidence/citation engine (claim → source, unsupported flag)    │
│   Staged-diff invariant: AI never writes user files directly     │
└──────────────────────────────────────────────────────────────────┘
```

- **Layers 0–2 are the platform** (the harness). This is what's
  defensible and what a builder buys into.
- **Layer 3 is apps.** The Portfolio cockpit is the one we built deep,
  to prove the platform can carry a real product. The starters are
  shallow demos of breadth.
- **The custom-surface SDK (Layer 2) is the moat.** No other local-first
  AI tool lets you ship a programmable dashboard that the host feeds with
  files + live market data + retrieval + the model, inside a security
  sandbox.

---

## 4. Load-bearing invariants (never violate without a product decision)

These are the promises. Breaking one is a P0, not a feature trade-off.

1. **Local-first.** User files never leave the machine. Cloud is only
   the user's own model API (their key) and the optional self-owned
   tunnel. No telemetry.
2. **Staged-diff.** The AI never overwrites a user file directly. All
   writes land in a staged manifest the user reviews and applies.
3. **Traceable.** Generated claims map back to sources; unsupported
   claims are flagged. Output is auditable, not vibes.
4. **Never blank-screen.** A crash in one view (surface, chat, a doc) is
   contained; the app degrades gracefully and tells the user what
   happened. (This is the active hardening track — see §7.)
5. **Your keys, your models.** Provider-agnostic; Ollama works fully
   offline. Cost is shown per run, never hidden.
6. **Extensible without a backend.** A builder ships a vertical with
   only a React bundle + the host SDK. No server changes required.

---

## 5. What is the killer feature? (settling the 4-way disagreement)

The old docs each planted a *different* flag (evidence pack / eval
promotion / source-thread / data sovereignty). Canonical ranking:

1. **Programmable custom surfaces over a local-first AI engine** — the
   platform thesis. This is what nothing else does. (Layer 2)
2. **Traceable, staged-diff-safe output** — the trust thesis. Why you'd
   run AI over files you care about. (Layer 0)
3. **Batteries-included flagship (Portfolio)** — the proof it carries a
   real product, not just demos. (Layer 3)

Data sovereignty and eval-promotion are *supporting* arguments, not the
headline.

---

## 6. Tech reality (as built, not as originally planned)

- **Monorepo:** npm workspaces. `apps/server` (Fastify + tsx, `node:sqlite`),
  `apps/web` (React 18 + Vite + Tailwind v4, served as a static build by
  the server), `apps/admin` (supervisor), `packages/shared`.
- **Providers:** Anthropic, OpenAI, Gemini, Moonshot (Kimi), Ollama.
- **Retrieval:** hybrid embedding + keyword + symbol-index over scan
  snapshots. (NOT the abandoned "Gasp Filter" from PRODUCT_PLAN — that
  vocabulary is dead; do not reuse it.)
- **Documents:** markitdown + PyMuPDF (Korean auto-dispatch) + hwp5txt
  (HWP) + LibreOffice headless (DOCX/PPTX page screenshots). Hash-keyed
  markdown cache, scan-time warm queue, SSE-pushed badges.
- **Surfaces:** esbuild-bundled React IIFE in a sandboxed iframe, talking
  to the host via a postMessage SDK.
- **Deploy:** single process, Cloudflare Tunnel, LAN/tunnel access split
  with per-route origin checks, multi-account.
- **License:** **MIT.** (The AGPL recommendation in PRODUCT_STRATEGY §1.3
  and LAUNCH_PLAN Week 1 is SUPERSEDED — repo ships MIT.)

---

## 7. Active engineering philosophy (the BA–BE track)

Apple-grade: **architectural/operational stability + precise UI/UX flow.**
Operationally that means:

- **Never ship a silent no-op.** Every increment is verified in the real
  app (preview MCP) before commit — a referenced-but-undefined token, a
  dangling keyframe, a cancelled edit are all P0 regressions, not
  cosmetic.
- **Contain every crash.** Hardening pass in flight: DB JSON corruption
  guard (done, BD1), nested error boundaries on heavy views (SurfaceView,
  ChatView, WorkspaceOverview), EventSource reconnect.
- **One motion + elevation system.** Token-driven (`--motion-*`,
  `--ease-*`, `--elevation-*`); all entrances share the spring easing.
- **Every interaction has intent + feedback.** Destructive actions
  confirm; mutations show success/error; loading uses content-shaped
  skeletons, not spinners-everywhere.

---

## 8. Doc map (what to read for what, after this consolidation)

| Question | Read |
|---|---|
| What is the product / who / layers? | **this file** |
| How do I run / install it? | `INSTALL.md`, `QUICKSTART.md`, `HOW_TO_USE.md` |
| How is the code structured? | `ARCHITECTURE.md`, `PERFORMANCE_ARCHITECTURE.md` |
| API surface? | `API.md` |
| How do I build a custom surface (Layer 2 SDK)? | `SURFACE_SDK.md` |
| Retrieval internals? | `RAG_HARNESS.md`, `SYMBOL_INDEX_PLAN.md` |
| Portfolio app schema? | `PORTFOLIO_STARTER_V2.md` |
| Backlog / what's next? | `PLANNED.md` |
| Launch mechanics (historical)? | `LAUNCH_PLAN.md`, `PROMOTION.md` |
| Business/legal strategy (historical)? | `PRODUCT_STRATEGY.md` |
| Origin vision (historical)? | `PRODUCT_PLAN.md` |

Docs marked *historical* are kept for context but are not authoritative
on product definition. A future cleanup batch should add a one-line
"superseded by PRODUCT.md for definition; kept for X" banner to each.
