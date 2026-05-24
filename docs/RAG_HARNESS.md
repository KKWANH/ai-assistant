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

### BATCH-1 (date TBD on commit)

— pending —
