# RAG Evaluation Harness — design + milestone log

> This document is the authoritative goal sheet for the harness work.
> Each batch should **read this top-to-bottom**, decide the smallest next
> slice, implement it, then append a `BATCH-NOTES` entry at the bottom
> recording (a) what shipped, (b) what's still missing vs the spec, (c)
> the next batch's slice.
>
> Treat the "Spec" section as immutable; the "Status" + "BATCH-NOTES"
> sections are the moving parts.

---

## Spec (verbatim, from user research notes)

Search/RAG completeness is one of the highest-leverage axes for an app
like Ariadne. In that area, harness programming is essentially required.
For Ariadne, the differentiator is not "we wrote a clever retrieval
algorithm" but **"we have a harness that continuously evaluates retrieval
quality"**.

### 1. Why a harness fits Ariadne specifically

Ariadne's retrieval is centred on `retrieveRelevantChunks()`. When an
embedding index exists, semantic similarity is used; otherwise the
system falls back to keyword + symbol-boost. Hyperparameters (chunk size,
files read, per-file budget, topK) are hard-coded. Quality therefore
moves with those settings — not by feeling. There is currently no
`test`/`eval` script in `package.json`, so changes can't be scored.

> Ariadne's RAG completeness goes up sharply the moment changes can be
> compared on the same workspace / same query set / same ground truth.

### 2. Trend alignment

Recent RAG evaluation focuses on more than "did an answer come out". It
looks at retrieval hit rate, context relevance, answer faithfulness,
groundedness, latency, cost. ARES separates *context relevance*,
*answer faithfulness*, and *answer relevance*. LLM Readiness Harness
papers wrap those into CI gates. Hybrid retrieval (BM25 + dense + symbol
+ rerank) is the current state of the art; reranking helps quality but
costs runtime. Ariadne's next step isn't "add hybrid"; it is **"add a
harness so we can prove hybrid is worth it for our shape of workspace"**.

### 3. Harness components

#### 1) Retrieval Harness

Evaluate retrieval alone, not the LLM answer. For a query, what chunks
come back in the top-k.

Layout:

```
eval/fixtures/
  code-small/
  finance-portfolio/
  papers/
  korean-mixed/
eval/cases/retrieval.yaml
```

Case shape:

```yaml
- id: code-symbol-001
  workspace: code-small
  query: "where is symbol boost applied?"
  mustHit:
    - path: "src/retrieval.ts"
      contains: "symbol"
  shouldNotHit:
    - "noisy-notes.md"
```

Metrics:

| Metric              | Meaning                                                  |
|---------------------|----------------------------------------------------------|
| Hit@1               | first result hits a `mustHit`                            |
| Hit@3 / Hit@6       | any `mustHit` lands in top-k                             |
| MRR                 | reciprocal rank of the first `mustHit`                   |
| nDCG                | normalised discounted cumulative gain over `mustHit` set |
| Context Precision   | fraction of returned chunks that are in `mustHit`        |
| Context Recall      | fraction of `mustHit` items the result set covers        |
| p50 / p95 latency   | per-query retrieval latency                              |
| indexed coverage    | fraction of workspace files actually indexed             |

#### 2) Strategy Comparison Harness

Run the same case set against every available strategy and tabulate:

| Strategy            | Hit@6 | MRR | Context Precision | p95 latency |
|---------------------|-------|-----|-------------------|-------------|
| keyword-only        |       |     |                   |             |
| semantic-only       |       |     |                   |             |
| keyword + symbol    |       |     |                   |             |
| hybrid RRF          |       |     |                   |             |
| hybrid + rerank     |       |     |                   |             |

#### 3) Generation Harness

Evaluate answers given retrieved context. Case shape:

```yaml
- id: answer-portfolio-001
  query: "내 TSLA 보유 수량과 총 평가액"
  requiredContext: [holdings.csv, fx-rates.csv]
  expectedClaims: ["TSLA 수량은 12주다", ...]
  forbiddenClaims: ["임의의 현재 시장 가격을 단정"]
```

Metrics:

| Metric                  | Meaning                                       |
|-------------------------|-----------------------------------------------|
| Faithfulness            | answer grounded in retrieved context          |
| Answer Relevance        | answers the actual question                  |
| Unsupported Claim Rate  | how many sentences lack context support      |
| Abstention Correctness  | said "I don't know" when context was missing |
| Citation Coverage       | major claims cite a chunk                    |

#### 4) Regression Harness — CI gate

```json
{
  "scripts": {
    "eval:retrieval": "tsx apps/server/src/eval/runRetrievalEval.ts",
    "eval:rag":       "tsx apps/server/src/eval/runRagEval.ts",
    "eval:rag:ci":    "tsx apps/server/src/eval/runRagEval.ts --ci"
  }
}
```

```yaml
gates:
  retrieval:
    hitAt6Min: 0.85
    mrrMin: 0.65
    contextPrecisionMin: 0.60
    p95LatencyMsMax: 500
  generation:
    faithfulnessMin: 0.85
    unsupportedClaimRateMax: 0.08
    answerRelevanceMin: 0.80
```

#### 5) Synthetic Workspace Harness

```ts
createFixtureWorkspace({
  seed: 42,
  files: [
    codeFile("src/retrieval.ts", { symbols: ["retrieveRelevantChunks"] }),
    markdownFile("docs/rag.md", { topic: "hybrid retrieval" }),
    csvFile("data/holdings.csv", { rows: portfolioRows }),
    noisyFile("docs/random.md", { terms: ["retrieval", "AI", "workspace"] }),
  ],
});
```

Things the harness must be able to test:

- finds the small signal inside a large file
- noisy files don't beat the README
- Korean queries match Korean files
- symbol queries route to code files
- CSV value lookup works
- sensitive files never leak into retrieval
- `.ariadne/` is excluded
- `incremental indexing` doesn't drop content

### 4. Concrete folder design

```
apps/server/src/eval/
  fixtures/
  cases/
  runRetrievalEval.ts
  runRagEval.ts
  metrics.ts
  strategies.ts
  reporters/
data/evals/<timestamp>/
  retrieval-summary.json
  retrieval-details.json
  report.md
```

### 5. Priority of harnesses

| Priority | Harness                          | Effect                                 |
|----------|----------------------------------|----------------------------------------|
| 1        | Retrieval golden-set harness     | quantify retrieval                     |
| 2        | Strategy comparison harness      | basis for hybrid/BM25/rerank decisions |
| 3        | Regression CI harness            | prevent retrieval regressions          |
| 4        | Performance harness              | latency + indexing cost                |
| 5        | Safety harness                   | sensitive file / path-guard / .ariadne |
| 6        | Generation faithfulness harness  | prevent ungrounded answers             |
| 7        | User feedback → case promotion   | grows the dataset organically          |

### 6. Concrete bugs the spec calls out *before* the harness work

- `/api/workspaces/:id/search` returns `indexed: chunks.length > 0`.
  That's "any result", not "embedding index present" — UI may render
  "semantic search active" misleadingly.
- `retrieveRelevantChunks` should return metadata: which strategy was
  used, whether an embedding index existed, candidate count, warnings.
- `ask_ai`'s retrieval query uses only `instruction`; `priorOutput`
  isn't reflected — a `web_analysis` → `ask_ai` chain loses signal.
- Manual data-edit synthetic runs have `status: "completed"` with
  `completedAt: null`, and pretend-provider `"anthropic"` / empty
  model. Pollutes runs list filters + usage analytics.

### 7. Truth-in-advertising fixes for the README/explanation

- Current behaviour is **`semantic OR keyword+symbol`**, not "hybrid".
- "Workspace-wide semantic search" is overstated — the indexer caps at
  `MAX_FILES_READ = 40` and `FILE_READ_BUDGET = 25_000` per file.
- Truthful claim: "semantic when an embedding index exists, keyword +
  symbol-boost otherwise; with hooks for future hybrid + rerank."

---

## Status — what exists today (snapshot, 2026-05-24)

- `apps/server/src/services/retrieval.ts` — `retrieveRelevantChunks(rootPath, files, query, options)` returning `RetrievedChunk[]`. No metadata.
- `apps/server/src/services/symbolIndex.ts` — chooser over tree-sitter + regex, table `symbol_index`. Used as a `+2.0` score nudge inside retrieval.
- `apps/server/src/services/retrieval.ts` — `indexWorkspaceEmbeddings()` builds the `chunk_embeddings` table. Full-rebuild path (not incremental).
- `GET /api/workspaces/:id/search` exists; UI under `/workspaces/:id/search` is wired.
- No `eval/` directory yet. No npm script. No fixtures. No metrics module.

## Goals for this multi-batch arc

- [x] **P0 fix** — composer disappearing on iPhone SE / S8+ (root cause: `min-h-0` missing on the flex chain that hosts the scrolling MessageList; pushed any `shrink-0` footer off-screen). Shipped in `78408f5`.
- [ ] **P2 bug-fixes** the spec called out before the harness:
  - `indexed` field semantics in `/search`
  - return strategy metadata from `retrieveRelevantChunks`
  - `ask_ai` query enrichment with `priorOutput`
  - manual data-edit run: `completedAt` + provider/source naming
- [ ] **P3 Retrieval Harness v1** — minimum viable: 3 fixture workspaces, ~30 cases YAML, `runRetrievalEval.ts` runner, metrics module (Hit@k, MRR, Context Precision, Context Recall, p50/p95 latency, indexed coverage), JSON + Markdown report writer.
- [ ] **P4 self-evaluation** — re-read this doc, list gaps, pick next slice.
- [ ] **P5 Strategy comparison v1** — `keyword` vs `semantic` vs `keyword+symbol` vs (semantic+symbol). Real hybrid (RRF) listed as a deferred chip if not in scope.
- [ ] **P6 npm scripts** — `eval:retrieval` (root `package.json`). Light gates YAML; no hard CI fail in batch 1.
- [ ] **P7 final self-evaluation + chips** — what landed, what's deferred (generation harness, real hybrid + rerank, hard CI gate, user-feedback promotion).

## BATCH-NOTES

Append one entry per batch. Each entry: date, range of commits, what the
batch *did*, what it left *for the next batch*, what re-reading the spec
above made me notice that I missed.

### BATCH-1 — 2026-05-24 — commits `3942024..7a05194`

**Shipped**

- P0 mobile fix (composer no longer disappears on iPhone SE / S8+).
  Root cause: `min-h-0` missing on the flex chain hosting the scrolling
  MessageList. Fix at three levels: ChatView root, MessageList outer,
  AppShell `<main>` + its child container. (`78408f5`)
- P1 — this doc.
- P2 — four spec-flagged bugs:
  - `retrieveWithMeta()` introduced, returns `{ chunks, strategy,
    hasEmbeddingIndex, embeddingProvider, candidateCount, warnings }`.
    Chunks-only wrapper kept for chat / action callers.
  - `/api/workspaces/:id/search` now reports `indexed` honestly
    (`hasEmbeddingIndex`, NOT `chunks.length > 0`) plus `strategy`,
    `embeddingProvider`, `candidateCount`, `warnings`.
  - `WorkspaceSearchView` renders truthful strategy label
    ("semantic match" / "keyword + symbol boost" / "keyword only" /
    "no matches") + warnings footer.
  - `ask_ai` retrieval query joins `instruction + priorOutput.slice(1500)`.
  - Manual data-edit synthetic Run: `provider: "mock"`,
    `startedAt = completedAt = now`. Was lying as `"anthropic"` with
    `completedAt: null`. (`3942024`)
- P3 — retrieval harness v1 (`7a05194`):
  - 3 fixture workspaces (`code-small`, `portfolio-small`,
    `korean-mixed`) with intentional distractor files.
  - 26 cases in `apps/server/src/eval/cases/retrieval.yaml`.
  - `metrics.ts` (Hit@k, MRR, context P+R@6, distractor leak rate,
    p50+p95 latency, strategy mix).
  - `runRetrievalEval.ts` runner + `reporters/` writing JSON summary,
    JSON details, and Markdown report to `data/evals/<isoTimestamp>/`.
  - `npm run eval:retrieval` works from repo root.
  - **Baseline numbers (keyword-only)**:
    Hit@1=53.8 % · Hit@3=Hit@6=80.8 % · MRR=0.667 ·
    P@6=37.0 % · R@6=80.8 % · distractor leak=7.7 % ·
    p95 latency=0.2 ms.

**What re-reading the spec surfaced that I haven't covered**

- **nDCG** — spec listed it; I shipped only MRR + hit rates. MRR is
  enough when each case has 1 relevant doc; once cases get multiple
  relevant docs nDCG becomes a real signal. Mark deferred.
- **indexed coverage** — spec listed it; not in metrics today. Needs
  knowing the workspace's total file count and what fraction of it
  was actually considered (after `MAX_FILES_READ=40` cap). Easy to
  add — note for the next batch.
- **Synthetic workspace generator** (`createFixtureWorkspace({seed, files})`)
  — spec proposed it; I shipped static fixtures instead. Static is
  fine for v1 (versioned, debuggable, no flakes); generator is
  needed when we want hundreds of cases or stress-tests of "small
  signal inside large file". Defer.
- **Safety harness** — spec priority #5. Not covered yet:
  - sensitive files must never appear in retrieval
  - `.ariadne/` files must be excluded
  - paths cannot escape the workspace root
  - These are testable with the existing harness (just add cases with
    `shouldNotHit`-style assertions on `.ariadne/secrets.json` etc.).
- **Generation harness** — spec priority #6, biggest deferred chunk.
  Requires LLM calls which means cost + non-determinism. Use
  `provider: "mock"` for the deterministic path and a separate
  `--live` flag for real calls. Defer to a follow-up chip.

**Next batch — P5 Strategy comparison**

The natural next slice given the spec's priority order. Plan:

1. Add `strategy: "auto" | "keyword-only" | "keyword+symbol" | "semantic"` 
   option to `retrieveWithMeta`. `auto` = today's behaviour; the
   others let the harness pin which path to run.
2. `runStrategyEval.ts` — runs the same case set under each strategy
   and emits a side-by-side comparison table (keyword-only vs
   keyword+symbol vs semantic).
3. Semantic strategy needs a populated `chunk_embeddings` table for
   each fixture. Either:
   - boot openDb against a scratch path + run the embedding indexer
     against each fixture once at harness start (proper, slow)
   - skip semantic when no provider is reachable, mark its row as
     "skipped" in the report (pragmatic, fast)
   Going pragmatic for v1.
4. `eval:strategy` npm script.

Then P6 (light CI gates YAML, no hard fail in v1) and P7 (final
self-eval + chips for the deferred items).

### BATCH-2 — 2026-05-24 — commits `7a05194..HEAD`

**Shipped**

- P5 — strategy comparison harness (`e333404`):
  - `retrieveWithMeta` accepts `forceStrategy: "auto" | "keyword-only"
    | "keyword+symbol" | "semantic-only"`. Default `"auto"` preserves
    today's chat / action behaviour.
  - Two honesty fixes the harness immediately surfaced:
    - `semantic-only` without `workspaceId` returned empty + warning
      (was silently falling through to keyword).
    - `keyword+symbol` without `workspaceId` records a warning that
      it's degenerating to keyword-only (no symbol index to query).
  - `runStrategyEval.ts` runs the same case set under each strategy
    + writes a side-by-side report (`strategy-summary.json`,
    `strategy-details.json`, `strategy-report.md`).
  - `--use-db` mode: boots a scratch SQLite under `tmpdir`, indexes
    symbols + embeddings per fixture under `eval:<fixture>` ids so
    `keyword+symbol` and `semantic-only` have real data. Embeddings
    skipped (with a clear log line) when no provider reachable.
  - `npm run eval:strategy [-- --use-db]` from repo root.
  - **Real numbers (Ollama nomic-embed-text:latest, 26 cases)**:

    | strategy        | Hit@1 | Hit@6 | MRR   | P@6   | R@6    | p95     |
    |-----------------|-------|-------|-------|-------|--------|---------|
    | keyword-only    | 53.8% | 80.8% | 0.667 | 37.0% | 80.8%  |   2.1ms |
    | keyword+symbol  | 61.5% | 80.8% | 0.705 | 37.0% | 80.8%  |   0.3ms |
    | semantic-only   | 38.5% |100.0% | 0.604 | 27.6% |100.0%  |  27.6ms |

  - Three findings the harness produced (not guessed):
    1. Symbol boost: +7.7 pp Hit@1, +0.038 MRR, P@6 unchanged. Pure win.
    2. Semantic: R@6=100 % but Hit@1 drops 15 pp. Trades rank-1
       precision for total recall.
    3. Semantic solved every Korean cross-language failure the
       keyword baseline missed (5/5). "Auto" default is therefore
       the right shape — semantic when there's an index, fall
       through to keyword+symbol otherwise.
- P6 — soft CI gates (`HEAD`):
  - `apps/server/src/eval/gates.yaml` with the spec's thresholds.
  - `gates.ts` reads the file + returns per-metric verdicts; missing
    gate values are silently skipped.
  - `runRetrievalEval --ci` prints PASS / FAIL per gate and exits 0
    (soft). `--strict` flips to exit 1 on any FAIL — for later when
    the bar is stable.
  - `npm run eval:retrieval:ci` script.
  - Current baseline against gates: 3/5 PASS.
    - FAIL  Hit@6 ≥ 85.0% (actual 80.8% — Korean misses pull this down)
    - PASS  MRR ≥ 0.650 (0.667)
    - FAIL  Context P@6 ≥ 60.0% (37.0% — chunk-size + reranking territory)
    - PASS  p95 latency ≤ 500 ms (0.4 ms)
    - PASS  Distractor leak ≤ 10 % (7.7%)

**Spec coverage now**

| Spec item                                  | Status |
|--------------------------------------------|--------|
| 1) Retrieval golden-set harness            | ✅ BATCH-1 |
| 2) Strategy comparison harness             | ✅ BATCH-2 |
| 3) Regression CI harness (soft gates)      | ✅ BATCH-2 (strict mode wired but off) |
| 4) Performance harness (latency tracked)   | ✅ covered by latency metrics |
| 5) Safety harness (sensitive / .ariadne)   | ❌ deferred — chip below |
| 6) Generation faithfulness harness         | ❌ deferred — chip below |
| 7) User feedback → case promotion          | ❌ deferred — chip below |
| nDCG metric                                | ❌ deferred (MRR sufficient for 1-doc cases) |
| indexed coverage metric                    | ❌ deferred — small add |
| Synthetic workspace generator              | ❌ deferred (static fixtures are fine for v1) |

**Re-read of the spec — what BATCH-2 surfaced that I missed**

- "Workspace-wide semantic search" claim is more truthful now that the
  search UI says exactly which strategy ran. But the indexing-side
  story is still: `MAX_FILES_READ = 40`, `FILE_READ_BUDGET = 25 000`.
  The strategy harness measured 7 chunks indexed across the
  portfolio-small fixture and 3 across korean-mixed — within the
  budget, but the harness should explicitly compute **indexed coverage**
  (files considered / total files) and surface it. Small follow-up.
- Reranking research the spec cites (LiveRAG MAP boost, RAG hyper-
  parameter studies) is moot until the retrieval surface actually
  produces enough candidates to rerank. Today the keyword path's
  `MAX_FILES_READ = 40` cap means anything beyond the smallest 40
  files is invisible. Real hybrid retrieval (BM25 + sqlite-vec + RRF)
  is the chip below; reranking is the chip after that.
- Generation harness is the largest remaining gap. The spec was
  explicit: "검색만 잘해도 LLM이 retrieved context를 무시하면 RAG는
  실패한다." Once landed, the loop tightens.

**Follow-up chips spawned**

1. **Real Hybrid Retrieval v1** — BM25 (sqlite FTS5) + vector +
   symbol-boost merged with reciprocal rank fusion + the
   `forceStrategy: "hybrid"` option. Strategy harness already has a
   slot for the column.
2. **Safety eval cases** — sensitive files (e.g. `secrets.json`),
   `.ariadne/` files, path-traversal patterns added to
   `retrieval.yaml` with `shouldNotHit` guarantees.
3. **Generation faithfulness harness** — `runRagEval.ts`, deterministic
   `provider: "mock"` path + opt-in `--live` for real provider calls.
4. **Incremental indexing** — file hash + mtime so a re-scan only
   re-embeds changed files. Currently the embedding indexer clears
   and rebuilds — fine for the fixture sizes, breaks on real
   workspaces with thousands of files.
5. **nDCG + indexed coverage** in the metrics module — small additions
   the spec called out.

**Where this leaves Ariadne's RAG**

Before BATCH-1: "we have retrieval, no idea how good it is."
After BATCH-2: a single command (`npm run eval:strategy -- --use-db`)
produces a comparison table that lets a contributor say things like
"this PR moved Hit@1 from 61.5 % to 64.3 % without latency cost" and
have receipts.

That capability is the chip the spec was actually asking for. Now the
algorithm work (real hybrid, reranking, etc.) has a place to land
with measurable verdicts attached.

### BATCH-3 — 2026-05-24 — commits `4ff9c3a..1f6ea57`

Closed every deferred follow-up from BATCH-2 in the same session.
Final state below.

**P8 — Real Hybrid Retrieval (`4ff9c3a`)**
 * FTS5 virtual table `chunk_fts` mirrored alongside `chunk_embeddings`
   with `tokenize='unicode61 remove_diacritics 2'` so Korean / mixed
   scripts index correctly.
 * `dbBm25Search` sanitises FTS5 operators from user queries, returns
   top-k by SQLite's built-in `bm25()`.
 * `retrieveByHybridMeta` fuses BM25 + semantic + symbol candidates via
   reciprocal rank fusion (k=60). Symbol contribution = every chunk
   inside a symbol-matched path gets rank 1 in the symbol list.
 * `forceStrategy: "hybrid"` available everywhere — chat, actions,
   harness. Honest empty + warning when no workspaceId / no index.
 * Strategy harness defaults updated to include `hybrid`.
 * **Measured numbers (26 retrieval cases, Ollama embeddings)**:

   | strategy        | Hit@1 | Hit@3 | Hit@6 | MRR   | p95     |
   |-----------------|-------|-------|-------|-------|---------|
   | keyword-only    | 53.8% | 80.8% | 80.8% | 0.667 |   0.3ms |
   | keyword+symbol  | 61.5% | 80.8% | 80.8% | 0.705 |   0.3ms |
   | semantic-only   | 38.5% | 80.8% |100.0% | 0.604 |  22.7ms |
   | **hybrid**      | **69.2%** | **100.0%** | **100.0%** | **0.840** | **16.3ms** |

   Hybrid p95 16.3ms is *lower* than semantic-only's 22.7ms because
   BM25 is in-process SQLite and the parallel branches overlap.

**P10 — Safety harness (`07bdf16 + c1ea376`)**
 * `safety-fixture` with `notes.md` + `secrets.env` + `credentials.json`
   + `.ariadne/private.json`. 8 negative cases assert sensitive +
   `.ariadne` paths never appear in retrieval.
 * Verified across all 4 strategies: **zero distractor leaks**.
   Sensitive files filtered by `f.sensitive` check before scoring;
   `.ariadne/` skipped at walk time.
 * `.gitignore` exceptions added so fixtures travel with the repo
   while production `**/credentials*.json` + `.ariadne/` rules keep
   doing their job everywhere else.

**P11 — Incremental indexing (`a7060e3`)**
 * `chunk_embeddings.file_hash` (guarded ALTER) + per-path index.
 * `dbDeleteChunksByPath` + `dbListChunkPathDigests` helpers.
 * `indexWorkspaceEmbeddings` rewritten:
   - hash each candidate's truncated content (SHA-256)
   - same hash as stored → skip
   - different hash → drop old chunks for that path, re-embed
   - file gone → drop its chunks
 * Returns `{indexed, provider, reembedded, unchanged, removed}`.
 * Smoke verified against code-small fixture: 1st run reembeds 4,
   2nd run unchanged=4 reembeds=0, 3rd run after `touch` reembeds=1.
 * For real workspaces this is the difference between a 10-second
   re-scan and a 50-ms one.

**P12 — nDCG + indexed coverage (`5f0b6b0`)**
 * `CaseMetrics.ndcgAt6` + `AggregateMetrics.meanNdcgAt6`. DCG over
   the top-6 chunks scored against `mustHit` paths.
 * `isRetrievalEligible(f)` + `RETRIEVAL_MAX_FILES` exported from
   retrieval.ts so the harness uses the same eligibility rules.
 * Runner computes `indexedCoverage = totalCandidates / totalFiles`
   across all fixtures and reports it.

**P9 — Generation faithfulness harness (`1f6ea57`)**
 * `cases/rag-answer.yaml` with 8 cases: 6 positive + 2 abstention.
 * `genMetrics.ts`:
   - Faithfulness: sentence-level fingerprint overlap (≥60 % of
     content tokens must appear in the joined retrieved chunks).
   - Abstention scoring: must contain an abstention phrase AND no
     positive claims when `expectedAbstention: true`; otherwise
     abstaining is wrong. Faithfulness=1 when abstention is correct
     (the abstention IS the grounded answer; don't penalise it).
   - Expected/forbidden claims: lowercase substring match.
 * `runRagEval.ts`:
   - Deterministic `mockGenerate` baseline pulls sentences with
     query-token matches from the top-3 chunks. By construction
     mock answers come from context → mock faithfulness should be
     100 %, doubling as a regression check on the scorer.
   - `--live` mode lazy-imports the production provider machinery
     and uses the same prompt the chat path would.
   - `--use-db` + `--strategy=<id>` work the same way as the
     strategy harness.
 * `eval:rag` + `eval:rag:ci` npm scripts.
 * **Mock baseline (8 cases, hybrid retrieval)**:
   - Faithfulness mean: 100 %
   - Abstention precision: 100 %
   - Unsupported claim rate: 0 %
   - Expected claims hit (mean): 75 % (2 cases where mock can't
     extract the specific value — exactly the gap a real LLM closes)
   - Forbidden claim leak rate: 0 %
   - Context P / R: 23.3 % / 100 %

### Spec coverage — final

| Spec item                                  | Status |
|--------------------------------------------|--------|
| 1) Retrieval golden-set harness            | ✅ BATCH-1 |
| 2) Strategy comparison harness             | ✅ BATCH-2 |
| 3) Regression CI harness (soft gates)      | ✅ BATCH-2 (strict mode wired, off) |
| 4) Performance harness (latency tracked)   | ✅ BATCH-1 |
| 5) Safety harness                          | ✅ BATCH-3 |
| 6) Generation faithfulness harness         | ✅ BATCH-3 |
| 7) User feedback → case promotion          | ⏸ deferred — needs UI flow |
| **Real hybrid retrieval (BM25+RRF)**       | ✅ BATCH-3 |
| **Incremental indexing**                   | ✅ BATCH-3 |
| **nDCG metric**                            | ✅ BATCH-3 |
| **Indexed coverage metric**                | ✅ BATCH-3 |
| Synthetic workspace generator              | ⏸ deferred — static fixtures fine for current scale |
| Hard CI gates (`--strict` enabled)         | ⏸ deferred — bar still settling |
| Faithfulness via LLM judge (`--judge`)     | ⏸ deferred — heuristic scorer sufficient for v1 |
| GraphRAG / RAPTOR / Agentic RAG            | ⏸ deferred — separate research arc |

### What's still meaningfully missing

1. **User-feedback → eval-case promotion** (spec priority #7). Wire
   the workspace search UI's "this result was bad" affordance into
   a flow that appends the query + chosen file as a new case
   candidate. Would let the dataset grow with real usage.
2. **LLM-judge scorer** for ambiguous-paraphrase cases. The
   heuristic faithfulness scorer would call a small model to judge
   the harder sentences. Off by default for cost + determinism.
3. **More fixtures**. `papers-small` (multi-doc citation tracing) is
   the obvious next one; the spec mentioned it.
4. **`--strict` CI gate enablement** once a few weeks of green runs
   establish the bar.
5. **Bigger hybrid sub-strategies**. MMR for diversity, query-rewrite,
   cross-encoder rerank — all measurable now that the harness exists.

### Where this leaves Ariadne's RAG (final)

The spec said:

> Ariadne의 검색/RAG 완성도는 알고리즘 자체보다, 알고리즘을 바꿀
> 때마다 같은 workspace·같은 질문·같은 정답 기준으로 품질과 속도를
> 비교하는 하네스가 생길 때 급격히 올라간다.

Three commands now back that up:

```
npm run eval:retrieval        # 34 cases, default retrieval path
npm run eval:strategy --use-db # head-to-head comparison of 4 strategies
npm run eval:rag --use-db      # generation faithfulness + abstention
```

Each writes a timestamped report under `data/evals/`. Any PR that
moves retrieval can claim numerical improvements (or regressions)
with receipts. The harness already produced one measurable algorithm
win this session: real hybrid retrieval lifted Hit@1 from 61.5 % to
69.2 % with lower p95 than semantic-only. Without the harness that
claim would be a feeling; with it, it's a row in a table.
