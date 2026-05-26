# Intelligence tuning — how the chat hot path is wired for best answers

This doc names what we do to make a "normal chat with agent + web search
on" produce the best answer the model can give, and what we *don't* do
(and why). Companion to `docs/RAG_HARNESS.md` (which is about
measurement) and `docs/PERFORMANCE_ARCHITECTURE.md` (which is about
speed). This one is about *quality*.

## 0. The three response paths

When the user sends a chat message, one of three system prompts ends up
in front of the provider:

| Path | When | System prompt builder |
|---|---|---|
| **direct** | agent: off, OR planner returned empty plan ('Answer directly — no tools needed') | `buildDirectSystem()` |
| **planner** | agent: on or auto-decided yes; produces a 2–7 step plan | `buildPlannerSystem()` |
| **synthesis** | after the planner's steps execute, this writes the final answer using the step results | `buildSynthesisSystem()` |

The planner can also re-fire mid-execution if a step fails or returns
low-information — `buildReplannerSystem()`. Same shape, narrower job.

All four live in `apps/server/src/services/agent.ts`.

## 1. What the prompts demand now (AI4)

The earlier versions were three-line "be helpful, be concise" prompts.
That left too much variance in chat-with-search: the model would often
ignore search results and answer from priors anyway. The current
prompts force four explicit shifts:

### 1.1 Think before answering (silently)

The synthesizer now has a mandatory pre-answer reasoning pass:
1. Distinguish *confirmed* vs *plausible* vs *gaps* across step results.
2. Surface conflicts between sources.
3. Look for the calibrated answer (yes/no, numeric, directional) buried
   in findings.

This is silent — the user never sees the reasoning, only its output.
If the model narrates "Let me think through this…" out loud we'd
penalize that in a future revision. So far it hasn't been a problem.

### 1.2 Cite specifically

Both the synthesizer prompt and the direct prompt now require inline
`[1]`, `[2]`… citations when the answer leans on supplied context.

- **Direct path**: when web-search results, files, or attachments are
  in the prompt, the model cites them.
- **Synthesis path**: each step result is numbered `[1]…[N]` in the
  synth prompt; the model's citations map to those numbers.

The previous direct prompt **banned** `[1]`-style markers. That was
right for pure-LLM answers (which don't have sources), wrong for
answers built on actual context (which absolutely do).

### 1.3 Surface gaps honestly

> "When the user asks something the supplied context doesn't cover,
> answer from your own knowledge but say so ('I don't see anything
> about X in the supplied files — from general knowledge, …'). Never
> silently pretend the context covered a question it didn't."

This is the single biggest reliability fix. Without it, the model
glosses over gaps and the user has no way to know which parts of the
answer came from sources vs priors.

### 1.4 Stop padding

> "Lead with the answer, then back it up. No throat-clearing intros,
> no recap of the question."

> "Concise > comprehensive. A two-sentence answer beats a 200-word one
> if the question is two sentences worth."

This is a quality-of-life rule for the user. The "Great question!" /
"Sure! Here's a comprehensive…" patterns are penalized explicitly.

## 2. Planner upgrades

`buildPlannerSystem()` now:

- Allows **2–7 steps** (up from 2–5) to handle multi-part questions
  that need more research.
- Forces each `note` field to name the *specific finding the step is
  expected to surface*. Vague rationales ('gather info') were producing
  vague answers downstream.
- Names two failure modes explicitly:
  - **under-planning**: a 1-step `reason` plan for a question with real
    research components → "almost always wrong, return concrete tool
    steps instead."
  - **over-planning**: 8+ steps suggest the task should be smaller →
    cap at 7, let the re-planner extend if needed.
- Penalizes "verify"/"double-check" filler steps — the synthesiser
  already distinguishes confirmed vs plausible.

## 3. What we deliberately don't do (yet)

Each of these is a real win available; each is deferred for a real
reason.

### 3.1 Tool-level parallelism

The agent runs tools sequentially. Two independent `web_search` steps
that look up unrelated facts could run in parallel. Defer until we see
an agent message where this latency matters in practice — most
multi-step plans have a sequential dependency anyway (search → reason
→ search).

### 3.2 LLM-based reranker on web search results

Today the search step takes the provider's top 5 results verbatim.
Reranking would add a small LLM call per search step. The current
search providers (Tavily / Brave / DuckDuckGo) already do relevance
ranking; the marginal value of a second pass isn't proven. Defer
until we see specific cases where the top 5 are wrong-ordered.

### 3.3 Self-consistency / answer voting

Generate N answers, pick the most-consistent one. Triples the LLM
cost for ~5% accuracy gain in published benchmarks. Wrong tradeoff
for a workspace chat tool — defer indefinitely.

### 3.4 Constitutional / retry-on-faithfulness-violation

Run the answer through a faithfulness checker; if it fails (cites
something the sources don't say), regenerate. We have a faithfulness
eval (`docs/RAG_HARNESS.md` §generation) but it's offline. Putting it
in the chat hot path doubles cost and latency. Defer until we have a
specific user-reported regression class.

### 3.5 Memory retrieval over chat history

Currently the planner sees the last 6 history messages (300 chars
each). A vector retrieval over the full chat history would catch
longer-running threads. Defer — the existing
`workspace_memory_block` covers most of this need; long chats are
rare enough not to be the bottleneck.

### 3.6 Per-message guidance from the user

Slash commands or chips that let the user say "be extra careful here"
or "this is just a quick check" would let us pick prompt variants per
message. Nice idea, not built. Defer.

## 4. What to measure (and what we don't measure yet)

The retrieval harness (`docs/RAG_HARNESS.md`) measures retrieval
quality and faithfulness on offline fixtures. What it does **not**
measure:

- **Citation rate**: how often does the answer actually include
  `[1]`-style citations when sources are present? Worth a new eval
  case in the next harness pass.
- **Gap-acknowledgement rate**: when the fixture asks for something
  the sources can't answer, does the response say so? Also worth a
  new case.
- **Padding rate**: how many words before the actual answer starts?
  Could be measured cheaply (does the first sentence answer the
  question?) but isn't today.

These aren't blocking; the prompt itself does the heavy lifting.
Adding them to the harness would give us a regression alarm if a
future prompt rewrite quietly walks back the AI4 gains.

## 5. How to extend

When adding a new tool or a new agent path:

1. Decide which of the three prompts (direct / planner / synthesis)
   needs to know about it.
2. Add it minimally — one paragraph, named with a verb. No long
   "consider this, consider that" lists; planners follow the bullet
   that's most concrete.
3. If the new tool produces sources, plumb them through `sources` in
   the agent step result so the citation mapping stays correct.
4. Add an eval case in `apps/server/src/eval/cases/` that captures
   the new path's expected behaviour.

## 6. References

- `apps/server/src/services/agent.ts` — the prompts live here
- `docs/RAG_HARNESS.md` — measurement methodology
- `docs/VLLM_PLAN.md` §C — guided decoding (already enforces planner
  JSON shape — orthogonal but related)
- `docs/PERFORMANCE_ARCHITECTURE.md` §2.4 — the latency budget that
  constrains how much we can do per message
