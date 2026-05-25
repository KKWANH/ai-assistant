# vLLM — where it fits in Ariadne, and where it doesn't

A research note on whether [vLLM](https://github.com/vllm-project/vllm)
should join `apps/server/src/providers/` as a fourth local option
(alongside `ollama`, the hosted providers, and `mock`). Bias toward
honesty over hype — the Mac mini constraint dominates.

---

## 0. TL;DR

- vLLM is *not* a drop-in replacement for Ollama on the Mac mini. Stock
  vLLM is Linux + CUDA. Two community plugins (`vllm-metal`,
  `vllm-mlx`) exist for Apple Silicon but are sub-v1.0 and text-only as
  of May 2026.
- The integration is **~30 lines of code** when the time comes —
  vLLM exposes the same OpenAI shape Ollama does, so it slots behind
  `OpenAIProvider` exactly like `MoonshotProvider` and `OllamaProvider`.
- The real prize is **not solo chat**. It's the **eval harness** and
  **plan-and-execute agent loop** — both issue bursts of correlated
  LLM calls that Ollama serves sequentially. vLLM's continuous batching
  + prefix caching could move the needle there.
- Recommended: ship a thin `vllm` provider as **Tier 2** (sits next to
  `ollama` in the picker, off by default, documented for users with a
  Linux/GPU box on the LAN). Defer the embedding-server swap and the
  guided-decoding wiring until we see a real bottleneck.

---

## 1. Mac mini 문제 — the honest assessment

Ariadne's reference deployment is `ai.kwanho.dev` running on the
founder's Mac mini. That single fact rules out 80% of vLLM's value
proposition. vLLM was built for Linux servers with NVIDIA GPUs; its
batching and PagedAttention assume that hardware shape.

What exists for Apple Silicon today:

| Plugin | Backend | Maturity (May 2026) | Notes |
|---|---|---|---|
| [`vllm-metal`](https://github.com/vllm-project/vllm-metal) | MLX + custom Metal kernels | v0.2.0, ~1.2k stars, text-only | First-party plugin. No published throughput numbers. Requires native arm64 Python 3.12 + Rust toolchain to build. |
| [`vllm-mlx`](https://github.com/waybarrios/vllm-mlx) | MLX | sub-v1.0, community | 525 tok/s on Qwen3-0.6B 4-bit on M4 Max. `pip install`. Adds multimodal + embeddings. |

Both are explicitly experimental. Ollama remains the right local
default on the Mac mini in 2026: one Mac-native binary, every model
the box can fit, zero dependency churn.

**So this doc is "use vLLM on a Linux/GPU box you also own, reached
over the LAN" — not "swap Ollama out."** vLLM becomes the obvious
backend once the fleet grows past the Mac mini.

---

## 2. Integration shape A — drop-in `vllm` provider

The cheapest, highest-leverage piece. vLLM's [OpenAI-compatible
server](https://docs.vllm.ai/en/stable/serving/openai_compatible_server/)
exposes `/v1/chat/completions` on `http://localhost:8000/v1` by default,
identical shape to OpenAI / Moonshot / Ollama. So the provider is:

```ts
// apps/server/src/providers/openai.ts
export class VllmProvider extends OpenAIProvider {
  override readonly id: ProviderId = "vllm";
  constructor(model: string) {
    const base = process.env.VLLM_BASE_URL ?? "http://localhost:8000";
    super(model, { apiKey: "vllm", baseURL: `${base}/v1` });
  }
}
```

Plus the entry in `getProvider()`'s switch, plus `"vllm"` in
`packages/shared/src/config.ts` `PROVIDERS`, plus a `VLLM_BASE_URL` env
in INSTALL.md. **~30 lines of code, including the labels.**

Where it wins for users who DO self-host on a Linux/GPU box:

- **Agent loop** (`apps/server/src/services/agent.ts`): each run fires
  planner → 1..8 tool steps → optional re-planner → synthesis. That's
  3–10 sequential LLM calls per agent message. vLLM's **automatic
  prefix caching** lets the planner / synthesis system prompts skip
  prefill entirely after the first turn — published numbers show
  TTFT dropping dramatically at high cache-hit rates, with <1% overhead
  at 0% hit.
- **Re-plan branch in agent.ts:267**: each re-plan currently costs a
  full provider round-trip with a *fresh* prompt. The system prompt is
  identical to the original planner — vLLM's APC would skip its
  prefill verbatim.

Where it doesn't:

- Solo chat is TTFT-dominated by the network hop from the user's
  browser to the server, then provider TTFT. Local vLLM on a remote
  GPU box helps; local vLLM on the same Mac mini that's already
  running Ollama doesn't.

---

## 3. Integration shape B — eval-harness batch backend

`apps/server/src/eval/runRagEval.ts` and `runStrategyEval.ts` both loop
cases sequentially: one `await liveGenerate(c, ...)` per case. ~30
cases today; linear in case count.

vLLM is the canonical "many requests with shared prefix" workload.
Continuous batching packs in-flight requests into the same forward
pass; PagedAttention + prefix caching means the shared system prompt
prefills once, not N times. Published 2–4x throughput claims assume
exactly this shape.

Win shape: a `--concurrency=N` flag on the eval scripts, behind a
`Promise.all` pool. **Caveat: this only pays off against a batched
backend.** Ollama serialises and doesn't share KV across requests, so
concurrent calls on Mac mini are no faster (sometimes slower) than
serial. Default `N=1` to preserve current behaviour.

---

## 4. Integration shape C — guided decoding for the planner

`agent.ts:parsePlan()` calls `JSON.parse(extractJson(raw))` inside a
try/catch that returns `{ steps: [] }` on failure — which then routes
through the "no steps → answer directly" path. So a malformed planner
response silently disables agentic mode. The planner schema
(`buildPlannerSystem`) is fixed and small:

```
{ "summary": "...", "steps": [ { "description": "...", "tool": "...", "note": "..." } ] }
```

That's exactly what [vLLM's structured
outputs](https://docs.vllm.ai/en/latest/features/structured_outputs/)
enforce via `response_format: { type: "json_schema", json_schema: ... }`
— xgrammar / outlines restrict next-token choices to the schema, so
parse failures become impossible. Benchmarks show time-per-token only
marginally above unconstrained.

Wiring: extend `CompleteRequest` (`providers/index.ts`) with
`jsonSchema?: object`, forward in `OpenAIProvider.complete()`. OpenAI
4o, Gemini, and Anthropic (via tool input_schema) all support the
shape — **the win exists without vLLM**, and vLLM extends it to local
Qwen/Llama/Mistral. Most generalisable shape in this doc.

---

## 5. Integration shape D — embedding server replacement

`providers/embedding.ts:OllamaEmbeddingProvider.embedMany` fires 4-way
concurrent single-text calls because Ollama's `/api/embeddings` doesn't
batch. Re-indexing ~200 files = 200 round-trips. Slowest part of a
fresh workspace scan on the Mac mini.

vLLM's `/v1/embeddings` batches natively (same shape
`OpenAIEmbeddingProvider` already uses). But: `vllm-metal` is text-only
and ships no embedding models; native vLLM sentence-transformer
support is gappy ([vLLM
#17493](https://github.com/vllm-project/vllm/issues/17493)). Ollama
embeddings work on every Mac in the field today. **Defer until
re-index time becomes a complaint, or the deployment leaves the Mac
mini.**

---

## 6. What we'd give up

| Axis | Ollama | vLLM |
|---|---|---|
| Install | One Mac-native `.dmg` | Python venv + CUDA/MLX backend + model download |
| Apple Silicon | First-class | Plugin (`vllm-metal`/`vllm-mlx`), sub-v1.0, text-only |
| Process model | Single binary, lazy model load | One server per model (no hot-swap) |
| Model swap UX | `ollama pull foo` | Restart with new `--model foo` |
| Single-user TTFT | Excellent | About the same — vLLM only wins under concurrent load |

The "one model per process" bite matters: Ariadne lets users swap
models per chat. vLLM-backed deployments either pre-launch every model
(RAM-heavy) or restart on swap (latency-heavy). Framing:
**vLLM = "I picked one model and want to serve it hard," Ollama = "I
want to fiddle with five different models."**

---

## 7. Recommendation

| Tier | Shape | Prereq | Why |
|---|---|---|---|
| **Tier 1 — do now** | C: guided decoding for the planner | Add `jsonSchema?` to `CompleteRequest`; wire OpenAI/Anthropic/vLLM. No new provider needed. | Cross-provider win, fixes a real bug (silent planner parse failures), unblocks future vLLM. |
| **Tier 2 — do soon** | A: thin `vllm` provider | Tier 1 done. ~30 LOC + INSTALL.md note. | Lets self-hosters route there. Zero cost to Mac-mini users (off by default). |
| **Tier 3 — do when** | B: parallelise `--live` eval cases | Tier 2 done AND user actually runs `eval:rag --live` against a vLLM endpoint, AND the case set grows past ~100. | Otherwise the parallelism is a footgun against Ollama. |
| **Tier 4 — punt** | D: embedding swap | Either Ariadne's primary deployment moves off the Mac mini, OR Mac vLLM ships a stable embedding backend. | Ollama embeddings work everywhere today; this is a perf nice-to-have. |

The thing not to do: **don't make vLLM the default local backend**.
Ariadne's whole "local-first, double-click-to-install" promise (see
`docs/POSITIONING.md` §1) depends on the local backend being a
single-binary, Mac-native install. Ollama is that. vLLM is not — yet.

---

## 8. Concrete next steps if we proceed

1. **PR-1 (Tier 1, do first)**: extend `CompleteRequest` with
   `jsonSchema?: object`; forward in `OpenAIProvider.complete()` as
   `response_format: { type: "json_schema", ... }`. Anthropic translates
   to `tools: [{ input_schema }]`. Define `PLANNER_SCHEMA` as a const in
   `agent.ts`, pass on the `safeComplete()` call. Verify: a previously
   parse-failing planner prompt now returns a valid plan.

2. **PR-2 (Tier 2)**: `VllmProvider extends OpenAIProvider`, register in
   `providers/index.ts`, add `"vllm"` to `PROVIDERS`/`DEFAULT_MODELS` in
   `packages/shared/src/config.ts`, document `VLLM_BASE_URL` in
   `docs/INSTALL.md`. Verify: chat round-trip against `vllm serve
   qwen2.5-1.5b-instruct` (or a mock at `localhost:8000`).

3. **PR-3 (docs)**: `docs/SELF_HOSTING.md` section "Using vLLM on a
   second machine" — wire diagram, ports, latency expectations.

4. **PR-4 (Tier 3, conditional)**: `--concurrency=N` flag on `runRagEval`
   / `runStrategyEval`, default `N=1`. Document that `N>1` requires a
   batched backend (not Ollama).

5. **Future**: revisit Shape D (embedding swap) only when fresh-index
   time becomes a real complaint or the deployment leaves the Mac mini.

---

## References

- [vLLM](https://github.com/vllm-project/vllm) · [OpenAI server](https://docs.vllm.ai/en/stable/serving/openai_compatible_server/) · [Structured Outputs](https://docs.vllm.ai/en/latest/features/structured_outputs/) · [Automatic Prefix Caching](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/) · [Tool Calling](https://docs.vllm.ai/en/latest/features/tool_calling/)
- Apple Silicon: [vllm-metal](https://github.com/vllm-project/vllm-metal) · [vllm-mlx](https://github.com/waybarrios/vllm-mlx) · [Comparison writeup](https://blog.labs.purplemaia.org/two-paths-to-vllm-on-apple-silicon-vllm-metal-vs-vllm-mlx/)
