# Harness speed + intelligence — applying the context-engineering deep-research to Ariadne

> Companion to [`AGENT_REFACTOR_PLAN.md`](AGENT_REFACTOR_PLAN.md) (which applied
> agent-internals research as R1–R4), [`PERFORMANCE_ARCHITECTURE.md`](PERFORMANCE_ARCHITECTURE.md)
> (the speed contract), and [`INTELLIGENCE_TUNING.md`](INTELLIGENCE_TUNING.md)
> (answer quality). This doc records a deeper **context-engineering** pass — how
> the leading tools (Claude Code, Cursor, Cline, Aider, T3 Chat) compress, store,
> and reuse context for *both* speed and intelligence — and maps each finding
> onto Ariadne's actual code with shipped changes.
>
> Generated 2026-06-05 from a 110-agent deep-research workflow (27 primary
> sources, 129 claims extracted → 25 adversarially verified, 0 refuted) plus a
> code-grounded harness map.
>
> **Status: Tier 1–3 shipped** (local commits, unpushed):
>
> | Tier | Change | Commit |
> |---|---|---|
> | 1 | Fuse per-message triage (4 calls → 1) + opt-in fast-tier routing | `0817341` |
> | 2 | Sub-agent return distillation + structured compaction | `6e76ed2` |
> | 3 | Ollama context window 4096→16384 + keep-warm (+ HOW_TO_USE doc) | `2f549e2` |
>
> Speculative decoding was **considered and deferred** — see §5.

---

## 1. What the research established (verified, primary-sourced)

Every claim below survived a 3-vote adversarial verification against a primary
source. Confidence is the verifier's, not the author's.

| # | Mechanism | One line | Confidence | Source |
|---|---|---|---|---|
| 1 | **Sub-agent isolation** | Specialists burn 10k+ tokens but return only a 1–2k-token distilled summary; detail stays out of the orchestrator | high | Anthropic [multi-agent](https://www.anthropic.com/engineering/multi-agent-research-system) |
| 2 | **Compaction on overflow** | Summarize near-full context → reinitialize, preserving decisions/bugs/recent files, dropping redundant tool output | high | Anthropic [context-engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) |
| 3 | **Just-in-time retrieval** | Hold lightweight identifiers (paths/queries/links), load at runtime via tools; hybrid (some up-front) beats grep-only +12.5% | high | Anthropic; [Cursor semsearch](https://cursor.com/blog/semsearch) |
| 4 | **Code-graph compression** | Aider PageRank-over-dependency-graph fits a whole repo into a ~1k-token map sent every turn | high | [Aider repomap](https://aider.chat/docs/repomap.html) |
| 5 | **Context rot / lost-in-the-middle** | Recall is U-shaped and degrades as context grows; a bigger window does NOT fix it → compress, put key content at the ends | high | [arXiv:2307.03172](https://arxiv.org/abs/2307.03172) |
| 6 | **Tiered memory (MemGPT)** | LLM self-pages its own memory via tool calls under a "memory-pressure" signal, not auto-injected RAG | high | [arXiv:2310.08560](https://arxiv.org/abs/2310.08560) |
| 7 | **Model routing / cascade (FrugalGPT)** | Triage on a cheap/fast tier, reason on the strong one — match GPT-4 at ~50–75% (up to 98%) lower cost | high | [arXiv:2305.05176](https://arxiv.org/abs/2305.05176) |
| 8 | **Speculative decoding** | Small drafter proposes, big model verifies in parallel → 2–3x faster, identical output. Serving-layer lever (self-host only) | high | [arXiv:2211.17192](https://arxiv.org/abs/2211.17192) |
| — | **Design philosophy** | Simplest augmented-LLM first; add agentic complexity only when an eval warrants it — agents trade latency/cost for performance | high | Anthropic [building-effective-agents](https://www.anthropic.com/research/building-effective-agents) |

One-line synthesis: **keep working context small and high-signal, pull detail on
demand, and route easy work to a cheap fast model.**

> Caveat from the research: prompt/KV **caching** was a core ask but no claim
> survived verification (sources were fetched — Anthropic/OpenAI caching docs,
> the Manus "context engineering" post — but none reached the top-25). Treat
> Ariadne's caching posture (R1 + stable-prefix) as principle-based, not
> independently re-verified here.

## 2. Current-state scorecard (Ariadne vs the research)

Mapped from a precise code read of `apps/server/src` (per-message call sites,
model selection, compaction, caching, sub-agent return, memory, assembly order).

| Principle | Ariadne before this pass | Where | Verdict → action |
|---|---|---|---|
| Simplest-first / few round-trips | **6–8 LLM calls per standard message** (4 pre-classifiers + plan + 0–2 replan + synthesis) | `routes/chat.ts`, `services/triage.ts` | ❌ → **Tier 1** fuse 4→1 |
| Model routing / cascade | **None** — every call uses the single active model (incl. slow local qwen3:8b for triage) | `config.ts`, `providers/index.ts` | ❌ → **Tier 1** fast triage tier |
| Sub-agent isolation (1–2k return) | Deep mode passed each sub-agent's **full** answer to synthesis, unbounded | `services/orchestrator.ts` | ❌ → **Tier 2a** distill cap |
| Compaction preserves decisions | Flat 5–10 prose bullets; decisions/threads could drop | `services/chatContext.ts` | ⚠️ → **Tier 2b** structured digest |
| JIT retrieval | Files (index + excerpts) and web (full-page fetch, #9) already loaded on demand | `services/chatContext.ts` | ✅ aligned |
| Stable-prefix assembly | System `[base→profile→workspace→memory]`; dynamic tail `[attach→web→file→history→msg]` — no per-turn churn in the prefix | `services/chatContext.ts` | ✅ aligned |
| Local context not truncated | **Ollama defaulted to 4096-token window** — Ariadne's rich prompts were silently cut | ollama server | ❌ → **Tier 3** raise window |

## 3. Shipped changes

### Tier 1 — fused triage on a fast tier  ·  `0817341`

- **Finding:** simplest-first (#design) + FrugalGPT cascade (#7).
- **Before:** `decideAgentMode`, `decideWebSearch`, `detectActionIntent`,
  `generateChatTitle` each made a separate round-trip on the slow active model.
- **Change:**
  - `services/triage.ts` — new `triage(provider, content, needs)` returns
    `{agentMode, webSearch, title, actionIntent}` in **one** structured call;
    only the requested decisions are asked, skipped entirely when none are
    needed; fails open to cheap defaults. Removed the three now-dead classifiers
    (`generateChatTitle` kept for instant mode; `triageReport` untouched).
  - `config.ts` — `getTriageSettings()`: **opt-in** routing via a `triageProvider`
    (+ optional `triageModel`) setting; falls back to the active model so a
    configured cloud key never silently routes triage off-box.
  - `routes/chat.ts` — standard path kicks off one `triage()` on the fast tier
    (metered separately), consumed for the agent branch (blocking), title
    (async), action suggestion (async), and the web-search decision.
- **This install:** `triageProvider=gemini` → triage runs on **Gemini Flash**
  (`gemini-3.5-flash`), reasoning stays on local **qwen3:8b**. Exactly the
  cheap-triage / strong-reason cascade.
- **Verified:** tsc green; live — hard prompt → `{agent:true, web:true, title}`,
  chit-chat → `{agent:false, web:false, title}`; Gemini path returns valid
  structured output.

### Tier 2a — sub-agent distillation  ·  `6e76ed2`

- **Finding:** sub-agent isolation returns 1–2k tokens (#1); lost-in-the-middle (#5).
- **Before:** `runDeepAgent` concatenated every sub-agent's full answer (up to
  ~16k chars × 4) verbatim into the synthesiser.
- **Change:** `services/orchestrator.ts` — `distillFinding()` caps each finding
  to ~1.5k tokens (`FINDING_CHAR_BUDGET = 6000`) before synthesis. Bounds the
  synthesiser input to ~24k chars (and the fail-open fallback with it).
- **Verified:** tsc green; logic is a pure cap + truncation marker.

### Tier 2b — structured compaction  ·  `6e76ed2`

- **Finding:** compaction must preserve decisions/open-threads — "the first
  context lost in compression" (#2).
- **Change:** `services/chatContext.ts` — the summariser prompt now emits a
  structured digest (`## Context / ## Decisions / ## Open threads / ## Facts`)
  with dedicated, non-droppable slots, told to favour meaning over brevity for
  decisions and threads.
- **Verified:** live on a 26-msg / 14.5k-char synthetic history (qwen3:8b) —
  produced all four sections with decisions, open threads, and facts correctly
  preserved.

### Tier 3 — ollama context window + keep-warm  ·  `2f549e2` (doc)

- **Finding:** lost-in-the-middle / don't silently truncate (#5); keep the
  serving stack warm.
- **The real bug:** `ollama ps` showed **CONTEXT 4096** (ollama's VRAM-based
  default). Ariadne builds rich prompts — workspace memory, file excerpts (6k
  chars each), full web-page text (the #9 page-reader), long history — that
  exceed 4096 tokens, so the **tail was silently truncated**: the local model
  looked weaker than it is, and the #9 page-reading work was partly wasted on
  ollama. The OpenAI-compatible `/v1` endpoint (how Ariadne calls ollama)
  **ignores** per-request `num_ctx`/`keep_alive` (verified empirically), so the
  fix lives in the ollama **server** env.
- **Change (machine config, not repo code):** added to the ollama LaunchAgent
  `EnvironmentVariables` — `OLLAMA_CONTEXT_LENGTH=16384`, `OLLAMA_KEEP_ALIVE=-1`
  (alongside the pre-existing `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`
  which keep the larger window cheap on memory). Documented for all local users
  in [`HOW_TO_USE.md`](HOW_TO_USE.md).
- **Verified:** `ollama ps` → **CONTEXT 16384**, **UNTIL Forever**; SIZE 5.9→6.6GB
  (q8 KV cache keeps the bump to +0.7GB on 24 GB RAM); warm round-trip ~0.35s.
  (qwen3:8b's own max is 40960, so 16384 is well within range.)

## 4. Considered & deferred

### Speculative decoding — not viable on qwen3 + ollama today

Dug in (empirical + primary sources), conclusion: **defer.**

- ollama 0.23.1 exposes **no** generic draft/speculative flag in CLI, `serve`
  env, or the runner (`ollama runner --help`) — verified locally.
- The speculative decoding ollama *does* have (shipped requiring exactly v0.23.1+)
  is **Gemma 4 MTP** (multi-token prediction): a `DRAFT` Modelfile command +
  `--quantize-draft`, **MLX-runner-first**, and "still being validated across
  versions as of May 2026."
  [ollama#15980](https://github.com/ollama/ollama/pull/15980),
  [buildfastwithai](https://www.buildfastwithai.com/blogs/gemma-4-mtp-drafter-faster-inference)
- **Generic** draft+target (e.g. qwen3:0.6b drafting qwen3:8b — the llama.cpp
  style) was requested and the PR **rejected**; still unsupported.
  [ollama#9216](https://github.com/ollama/ollama/issues/9216),
  [ollama#5800](https://github.com/ollama/ollama/issues/5800)
- **Why defer:** getting it would mean abandoning qwen3:8b for Gemma 4 **and**
  switching to the MLX runner **and** adopting an immature feature — a large,
  risky change conflicting with the stated "don't swap to a different local
  model lightly" preference, for an uncertain gen-speed gain. Tier 1 (cloud
  triage) already removed the dominant latency; keep-warm (Tier 3) removed
  reload lag. Revisit if/when ollama ships generic draft models on the default
  runner, or if a Gemma-4 switch becomes desirable on its own merits.

### Other deferred items

- **Stable-prefix guard test** — the assembly order is already cache-correct
  (§2); a regression test is low-value polish. Skip until the prefix is touched.
- **MemGPT-style JIT memory** (#6) — workspace memory is injected inline today.
  It's in the *stable* prefix (cache-friendly) and capped at 60 entries / ~6k
  chars, so it's fine at current scale. Revisit (tool-based read/write on a
  memory-pressure signal) only when a workspace's memory grows large.
- **Repo-map analog** (#4) — Ariadne isn't a code agent; the existing workspace
  file index + on-demand excerpts is the right lightweight equivalent. No action.

## 5. Remaining levers / when to revisit

| Lever | Trigger to revisit |
|---|---|
| Larger ollama window (→32k) | If deep-mode synthesis or very long chats start truncating at 16k |
| Generic speculative decoding | When ollama supports draft models on the default runner |
| Triage on Flash-Lite ($0.1/$0.4 vs Flash $1.5/$9) | If triage cloud cost ever matters — ~10x cheaper, same classification quality (set `triageModel=gemini-3.1-flash-lite`) |
| MemGPT tool-based memory | When per-workspace memory outgrows the inline 6k budget |
| Eval-driven tuning | Before adding any further agentic layer — gate it behind `eval:retrieval` (PERFORMANCE_ARCHITECTURE §0) |
