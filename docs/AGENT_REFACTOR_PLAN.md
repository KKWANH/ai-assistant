# Agent refactor plan — applying agent-internals research to Ariadne

> Companion to [`AGENT_INTERNALS.md`](AGENT_INTERNALS.md). That doc is *how
> ChatGPT/Claude harnesses work*; this doc maps each principle onto Ariadne's
> **actual code** and proposes prioritized refactors. **This is a plan (prep),
> not executed work** — each item is sized for a future session with file refs,
> concrete change, effort, risk, and a verification gate.
>
> Generated 2026-06-04 from a code-grounded assessment.

---

## 0. Current-state scorecard (Ariadne vs the canonical harness)

| Principle (AGENT_INTERNALS §) | Ariadne today | Where | Verdict |
|---|---|---|---|
| Model emits / harness executes (§5) | Clean: providers return text/tool_use; `runTool()` executes | `services/agent.ts` `runTool()` (~364) | ✅ aligned |
| Native tool-calling + structured output (§3.1, §3.3) | Anthropic `tool_use` + `input_schema`; OpenAI `json_schema`; vLLM xgrammar; `extractJson` fallback | `providers/anthropic.ts:20–33`, `providers/openai.ts:24–29`, `agent.ts:816–846` | ✅ aligned |
| ReAct-style loop + replan (§2.1–2.3) | `runAgent()` plan→execute→replan, `MAX_STEPS=8`, `MAX_REPLANS=2`, per-step timeout | `services/agent.ts:76–343` | ✅ good (see R4) |
| **Prompt/KV caching (§4.2, §6.1)** | **None.** No `cache_control`; prefix unstable (retrieval/memory/metadata re-injected each turn) | `anthropic.ts:21–34`, `chatContext.ts:186–217` | 🔴 **absent — top ROI** |
| Context compaction / budgeting (§4.3) | Linear growth; slice by msg-count + char-cap; no summarization; no token budget | `chatContext.ts:327–342`, `agent.ts:942` | 🟡 missing |
| Parallel tool calls (§3.2, §6.1) | Sequential `for` loop over steps | `agent.ts:217–301` | 🟡 partial |
| Sub-agent fan-out (§4.4) | None; single sequential pipeline (also `actionEngine` blocks) | `agent.ts`, `actionEngine.ts:116–150` | ⚪ absent (bigger) |

**Read:** the *intelligence* layer (loop, tool-calling, structured output) is already
canonical. The gaps are all on the **efficiency / scale** axis the paper stresses —
caching, context management, parallelism. That's where the leverage is.

---

## R1 — Prompt caching via a stable prefix (HIGHEST ROI)

**Principle (§4.2/§6.1):** the loop re-sends a large, mostly-stable prefix every
turn; caching it cuts input cost ~90% and latency ~80%. Ariadne re-sends but
**caches nothing**, and worse, **busts its own prefix** by re-injecting
retrieval/memory/metadata inline each turn.

**Two coupled changes:**

1. **Stabilize the prefix.** Split `buildChatContext()` (`services/chatContext.ts:260`)
   into `buildStablePrefix()` (system instructions + workspace metadata + memory +
   tool/action list + truncated history) and `buildDynamicTail()` (per-message
   retrieval chunks + web results + attachments). Send **stable prefix first**, the
   dynamic tail last. Do the same for the agent planner (`buildPlannerSystem`/
   `buildPlannerPrompt`, `agent.ts:848/942`) — assemble the stable planner context
   **once before the loop**, reuse across steps 2–8.
2. **Mark it cacheable.**
   - **Anthropic** (`providers/anthropic.ts:21`): add `cache_control:{type:"ephemeral"}`
     to the last block of the stable prefix (system + tools). Thread an optional
     `cacheable?: boolean`/breakpoint hint through `CompleteRequest`.
   - **OpenAI/vLLM** (`providers/openai.ts:30`): caching is automatic on a stable
     prefix ≥1024 tokens — stabilizing the prefix (change #1) is what unlocks it. No
     API change needed beyond ordering stable-before-dynamic.

**Files:** `providers/index.ts` (`CompleteRequest` + a cache hint), `anthropic.ts`,
`openai.ts`, `services/chatContext.ts`, `services/agent.ts`.
**Effort:** ~1 batch. **Risk:** medium — touches the hot path; behavior must be
identical (caching is transparent). **Verify:** Anthropic response `usage`
shows `cache_creation_input_tokens` then `cache_read_input_tokens>0` on turn 2+;
agent multi-step run shows cache reads on steps 2–8; outputs unchanged; tsc + live
chat. **Expected:** 30–50% planner input-token cut on multi-step runs; lower TTFT.

---

## R2 — Context compaction + token budgeting

**Principle (§4.3):** real harnesses compact (server-side summarize) on overflow
and make the model context-budget-aware. Ariadne grows linearly with only a crude
char/message slice — long chats silently lose old context and waste tokens.

**Changes:**
- `buildSummarizedHistory()` in `chatContext.ts`: when history exceeds a budget
  (e.g. ~50% of the model's window), summarize older turns via one `provider.complete()`
  ("summarize this turn in 1–2 sentences"), keep recent turns verbatim. Trigger from
  `routes/chat.ts` before `buildChatContext()`/`runAgent()`, and at agent step ≥3.
- **Budget awareness:** reuse the per-account token tracking just built
  (`dbGetAccountTokenUsage`, `usage_events.account_id`) + per-run `usage` to track a
  conversation's cumulative tokens; expose a budget number the planner can see (cf.
  the paper's `<system_warning>` injection).

**Files:** `services/chatContext.ts`, `services/agent.ts`, `routes/chat.ts`.
**Effort:** ~1 batch. **Risk:** medium (summary quality / losing detail — keep recent
turns verbatim, log what was compacted). **Verify:** a 30+ turn chat stays under the
window with coherent answers; token-per-turn stops growing linearly. **Synergy:**
compaction + R1 caching compound (smaller, more stable prefix).

---

## R3 — Parallel tool execution

**Principle (§3.2/§6.1):** models emit multiple tool calls per turn; independent
calls run in parallel. Ariadne runs steps strictly sequentially (`agent.ts:217–301`),
so a plan with two `read_file`s or a `read_file`+`web_search` pays serial latency.

**Change:** after planning, group **independent** steps (different files / read-only
tools with no data dependency) and run each group with `Promise.all` instead of the
plain `for`. Keep the replan-on-failure semantics; only parallelize leaf/independent
steps. A minimal first cut: parallelize consecutive *read-only* steps
(`read_file`/`list_files`/`web_search`) that don't feed each other.

**Files:** `services/agent.ts` (the execute loop). **Effort:** ~half a batch (minimal
read-only cut) to ~1 batch (dependency DAG). **Risk:** medium — must not parallelize
steps with ordering/data deps; keep it conservative. **Verify:** a 2–3 independent-read
plan completes in ~max(step) not sum(step); replan-on-failure still works.
**Expected:** 30–50% faster read-heavy runs.

---

## R4 — Sub-agent fan-out (bigger, optional)

**Principle (§4.4):** orchestrator-worker fan-out (spawn isolated sub-agents, merge
results) beats a single agent on broad tasks — at higher token cost. Ariadne has no
fan-out; everything is one sequential pipeline. (We literally used this pattern via
the deep-research workflow to *write* the companion paper.)

**Change (prep only):** an orchestrator that decomposes a large task, runs N
`runAgent()` instances with **isolated context** concurrently, and synthesizes a
merged result. Gate behind an explicit "deep" mode (cost-aware) — not the default.
The existing `Workflow`/sub-agent machinery in the dev harness is a reference shape.

**Files:** new `services/orchestrator.ts` + a `runAgent` entry that accepts a
sub-task. **Effort:** 2+ batches. **Risk:** high (cost, complexity). **Recommendation:**
**defer** until R1–R3 land; revisit only for genuinely broad research/audit tasks.

---

## Sequencing & guardrails

1. **R1 (caching + stable prefix)** — do first; biggest cost/latency win, unlocks the rest.
2. **R2 (compaction + budgeting)** — compounds with R1; reuses the new token metering.
3. **R3 (parallel reads)** — independent; conservative first cut.
4. **R4 (fan-out)** — defer; explicit deep mode only.

**Do NOT touch** the already-canonical pieces: the agent loop shape, native
tool_use/json_schema, the staged-diff write invariant. Each refactor is
behavior-preserving on the happy path — verify outputs are unchanged (the only
intended change is fewer tokens / lower latency), per the project's "never ship a
silent regression" bar. Each item ships + verifies independently.

---

## Open questions (carried from the research)
- Exact `cache_control` breakpoint placement for Ariadne's prefix order
  (tools → system → memory → history) to maximize hit rate.
- Whether to compact via summarization (cheap, lossy) or the paper's structured
  compaction-block approach (richer); start with summarization.
- Parallel-step dependency detection: heuristic (tool type + path) vs an explicit
  planner-declared dependency field in `buildPlannerSchema`.
