# Performance architecture — keeping Ariadne fast as it grows

The app is getting heavy. Web bundle ~900 kB gz, server-side eval
harness + retrieval + agent loops + MCP all converging. This doc names
where the hot paths live, where the slow paths *will* live in 6 months,
and the policy that keeps both fast.

It is the perf counterpart to `docs/ARCHITECTURE.md` (which describes
the *shape*) — this one describes the *speed contract*.

## 0. Speed contract

| Surface | p50 target | p95 target | Hard ceiling |
|---|---|---|---|
| Cold web load (no chat) | <1.5s | <3s | 5s |
| Chat TTFT (provider response start) | <1s on Anthropic/OpenAI; <3s on Ollama 8B | <2s / <6s | 10s |
| Chat message → done (300-token answer) | <8s | <15s | 30s |
| Workspace scan (≤200 files, fresh) | <2s | <5s | 10s |
| Workspace re-scan (incremental, ≤50 changed) | <0.5s | <1.5s | 3s |
| Retrieval (Hit@6 in eval) | ≥80% | ≥75% | <70% = regression |
| Per-token re-render on streaming | <16ms | <32ms | 60ms = jank |
| Eval harness `eval:retrieval` | <3s | <5s | 10s |
| Eval harness `eval:rag` mock | <10s | <20s | 60s |

Numbers from current measurements. A regression past the **hard
ceiling** column fails CI (when we put it there) or warrants a P0
fix at minimum.

## 1. Web bundle — what's allowed where

Three chunk categories. Anything that doesn't fit one needs explicit
justification (see §1.4).

### 1.1 Eagerly loaded (must be small)

What the user downloads before they see anything. Budget: **≤200 kB gz
total**.

- `vendor-react` (165 kB gz)
- `vendor-react-router` (in vendor-react)
- `index` (~90 kB gz) — App shell, routes definition, auth, queries

### 1.2 Lazy per route (paid on navigation)

What's loaded only when the user lands on a route. Budget: **≤100 kB gz
per route**, with exceptions called out.

- `ChatView` (~14 kB gz)
- `WorkspaceOverview` (~10 kB gz)
- `SettingsView` (~6 kB gz)
- `WorkspaceFileEditor` (~90 kB gz + vendor-codemirror 137 kB) — power-
  user surface; allowed >100kB
- `RunDetailView`, `AttemptsList`, `HistoryView`, `SearchView`,
  `ContextPickView`, `TableSheet`, `StagedDiffView`, `ReportsQueueView`,
  `ActionsEditor`, etc. — all ≤10 kB each.

### 1.3 Lazy per-feature (paid on first use)

What's loaded when the user actually does the thing. Budget: **≤200 kB
gz each**, in their own chunk.

- `vendor-markdown` (52 kB gz) — first assistant message renders
- `vendor-codemirror` (137 kB gz) — first edit
- `xlsx` (142 kB gz) — first xlsx attachment
- `TerminalPanel` (83 kB gz, xterm.js + fit) — first terminal open

### 1.4 Disallowed shapes

- A vendor lib that ships into both eagerly-loaded AND lazy chunks.
  Suspect: rollup picking the wrong static-import target. Fix: pin via
  `manualChunks` in `vite.config.ts` (the function form — see AD4).
- Anything > 200 kB gz in the *initial* index chunk.
- Any new dependency without a "what does this replace?" answer in the
  PR description.

### 1.5 Tools

```bash
npm run build:web                        # → apps/web/dist/, prints chunk sizes
npx vite-bundle-visualizer               # interactive treemap (npm i -D first)
ls -lhS apps/web/dist/assets/*.js | head # largest chunks
```

When a chunk grows: read the build output's "modules included in this
chunk" list, then either split the offender behind a lazy import or
pin it explicitly in `manualChunks`.

## 2. Server — hot paths

### 2.1 Chat hot path (per message)

The path from `POST /api/chats/:id/messages` to first delta out:

```
chat.ts → resolve account
        → dbInsertMessage (user)
        → buildChatContext   ←── §2.2 latency-critical
        → getProvider (cached)
        → provider.completeStream  ←── network-bound
        → SSE deltas to client
```

**Latency budget for the server-side portion (excluding provider
response time):**

- Total: **<300 ms p50 / <800 ms p95**
- buildChatContext: <150 ms p50 / <400 ms p95 — the rest is DB write +
  routing overhead

If we blow this budget, the provider's response starts noticeably late
and chat feels sluggish even on Anthropic.

### 2.2 buildChatContext — the file we keep an eye on

`apps/server/src/services/chatContext.ts`. Five sequenced phases per
message:

1. **Attachment parsing** — PDF/DOCX/XLSX extraction. Async, parallel
   across attachments. **DOCX writeFileSync** → fixed in AC4.3 (async
   variant).
2. **Web search** — kicked off as a *parallel* Promise the moment
   `wantsWebSearch` resolves; awaited at the end. Saves 200–600 ms TTFT
   when search is on (AC4.3).
3. **Workspace context** — scan snapshot + memory + retrieval. Memory
   list is read once per message and reused (was read 2× pre-AC4.3).
   Retrieval is itself a hot path — §2.3.
4. **History** — `dbListMessages(chatId)`. O(n) for n messages — slow
   chats with 200+ messages take >50 ms here.
5. **Assemble** — string concat. O(prompt size).

The hottest sub-call is **retrieval** when a workspace is attached.

### 2.3 Retrieval (the next thing to optimize)

`apps/server/src/services/retrieval.ts`. Hybrid BM25 + cosine
embeddings + symbol-boost via reciprocal rank fusion.

Current shape — single workspace, ≤1000 indexed files:

- BM25 / FTS5: <20 ms p50
- Symbol index lookup: <10 ms p50
- Vector cosine over precomputed embeddings: <30 ms p50 for ≤1000 chunks
- RRF + rerank: <5 ms

**Total**: <60 ms p50 today. Acceptable.

**Will get slow at**: ≥10 000 indexed chunks. We re-rank all candidates
linearly, so cosine cost grows linearly with chunk count. At that
scale we'd need either ANN (HNSW / IVF) or a chunk-count cap with the
top-N reranked by full cosine.

**Not optimized yet**:
- Embedding generation is N+1 over Ollama's `/api/embeddings` (4-way
  concurrent, but still N round-trips). Deferred for now; only
  matters when fresh-index of 1000+ files is a complaint.
- BM25 stopword list is hardcoded English. Korean / mixed-language
  workspaces have lower precision than they could.

### 2.4 Agent loop

`apps/server/src/services/agent.ts`. Plan → execute → conditional
re-plan → synthesize.

- **3–10 sequential LLM calls** per agent message.
- Each step is its own network round-trip to the active provider.
- vLLM + prefix caching collapses identical system prompts.
- Guided decoding (AC4.2) means the planner can't emit malformed JSON
  → no "silent agentic-mode-disabled" failures.

**Not optimized yet**:
- Tools run sequentially even when independent. Some pairs (e.g.
  `web_search` for two unrelated facts) could run in parallel. Defer
  until we see an agent message where it matters.
- MCP `listTools()` is cached 60s (AC4.3) — already optimized.

## 3. Client — render path

### 3.1 Per-token re-render budget

A 300-token streaming response renders the assistant bubble ~300 times.
Each render must complete inside **16 ms** to stay under 60 fps.

Today (post AC4.3 + AD4):

- `MarkdownContent` is `React.memo`d — re-renders only when content
  actually grows.
- `ChatView` doesn't re-render siblings on each delta (hints array memo
  deferred to follow-up — minor at current scale).

Will get slow at: a chat with **≥50 messages where many are streaming
in parallel**. Today there's only one streaming response at a time, so
this is a paper risk.

### 3.2 Workspace overview render

`WorkspaceOverview.tsx` is the heaviest single component (~1100 lines).
It renders 7 tabs (Chats / Surface / Data / Standard / Edit / Memory /
Hooks). Each tab's content is mounted only when its tab is active —
the tabs are *not* always-rendered.

If a tab gets slow, profile that tab specifically — they're isolated.

### 3.3 Surface bundle

Per workspace, a custom dashboard at `.ariadne/surface.tsx` (or
`.ariadne/surface/index.tsx` — AH.3 folder form). esbuild output is
~1.1 MB for the Portfolio v2 dashboard (single bundle, includes
React + chart primitives + the surface code).

**Loaded only when the user opens the workspace's Custom screen tab.**
A surface that's never opened costs zero on the client.

## 4. Database — when to worry

SQLite via `node:sqlite`. Single file at `data/ariadne.db`.

### 4.1 Current data shapes

| Table | Typical rows | Growth driver |
|---|---|---|
| `workspaces` | 1–20 | User adds workspaces |
| `chats` | 1–500 | New conversations |
| `messages` | 100–20 000 | Every send. Bounded loosely. |
| `snapshots` | 1 per workspace | Re-scan replaces |
| `files` (per snapshot) | 100–5 000 | Workspace size |
| `chunks` (per snapshot) | 500–50 000 | At ~10 chunks/file |
| `runs` | 1–100 | One per `Create & Run` execution |
| `eval_cases_promoted` | 0–N | Bad-answer promotions |

### 4.2 Indexed columns

Spot-check `apps/server/src/db/migrations/*.sql` for the actual list.
Anything we query repeatedly without an index is a leak.

### 4.3 Will get slow at

- **`messages` table > 100 000 rows total** — listChats across-account
  starts feeling it. Currently capped by user behavior; if a user has
  500 chats × 200 messages it's already 100k. Mitigation: paginate
  `dbListMessages(chatId)` (currently returns the full conversation —
  fine for ≤200 messages, slow at 1000).
- **`chunks` table > 1M rows** — retrieval over a huge multi-workspace
  index. Mitigation: index on `(workspace_id, chunk_id)` if not
  already; ANN over embedding column.
- **A workspace whose `.ariadne/` git history has 10 000+ commits**.
  Run history widget reads recent commits — currently fine, gets
  slow if abused. Mitigation: cap the rev-list to `--max-count=50`.

### 4.4 Backups

`data/ariadne.db` is not backed up by the app. Users responsible. The
data folder is gitignored. Recommend the user runs `cp ariadne.db
ariadne.db.bak` periodically; we don't ship automation because the
local-first promise means we don't touch the user's filesystem outside
the workspace folders.

## 5. Hot rules — what to do when something gets slow

1. **Measure first.** `console.time` + Chrome perf trace + server-side
   `performance.now()` brackets. Reading the bundle's `manualChunks`
   output. Don't guess.
2. **One commit = one win.** A perf PR fixes one bottleneck; refactors
   ride separate PRs. Diff is much easier to review when the
   intervention is one change.
3. **Budget enforcement comes after demonstration.** A new CI gate that
   fails the build on a regression should ship only after the metric
   has been stable for at least one week of normal use.
4. **Generalize where it pays.** A perf fix in `buildChatContext` may
   also pay in the agent loop (same context-build call). Always
   check.
5. **Don't pre-optimize.** Some entries in this doc say "will get slow
   at N" — that's the trigger. Don't refactor for N=100k chunks when
   we have 5k today; the abstractions won't fit.
6. **Bundle size has a one-way ratchet.** Removing a dependency is
   trivially easy; adding one and removing it later is hard because
   users come to rely on it. New deps require a written rationale in
   the PR.

## 6. Cross-references

- `docs/ARCHITECTURE.md` — the structural shape
- `docs/RAG_HARNESS.md` — the retrieval + generation eval methodology
  capacities + Tier-1 / Tier-2 / Tier-3 next steps
- AC4.3 commit — the last full perf-pass on the chat hot path
- AD4 commit — the last full bundle-pass on the web side
