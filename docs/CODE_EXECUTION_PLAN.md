# Agent code & math execution — design and rollout

The agent today plans steps and calls tools, but it can't *compute*.
When a task wants "what's 17% of $48,200" or "filter holdings.csv by
sector then average buy_price", it either fabricates a number or asks
the LLM to do mental arithmetic — both unreliable. This doc sequences
the three execution capabilities, with explicit security boundaries.

The big design constraint: **Ariadne runs on the user's own machine
against their own files.** Any code the agent executes inherits the
host process's permissions. That changes which guardrails matter (no
hosted-multi-tenant blast radius) and which ones still do (an LLM
that decides to `rm -rf` is bad regardless of who owns the disk).

---

## Phase 1 — math evaluator (ships now)

**Tool name:** `calculate`

**Surface area:** the agent's planner can pick `calculate` whenever
a step is "compute a number from these inputs". The description field
carries the expression; the executor returns the numeric result.

**Implementation:** in-process `mathjs` (BSD, well-maintained, ~600 KB
in `node_modules` only — not bundled to the web client). mathjs is
deliberately built for safe expression evaluation: no `eval`, no
arbitrary code, just an arithmetic/algebra AST with a frozen function
registry (`sqrt`, `pow`, `log`, `mean`, …) and dimensioned units.

**Risks: very low.**
- No filesystem, network, or process access from the expression.
- 100 ms hard timeout (mathjs honours an `AbortSignal`).
- Output is always a number or a math-object string — never a side
  effect.

**Why ship this first:** it's the highest-value, lowest-risk slice of
the bigger ask. Most "the agent got the math wrong" failures are
arithmetic, not deep computation.

---

## Phase 2 — sandboxed JavaScript (next batch)

**Tool name:** `run_js`

**Surface area:** the agent generates a small JS snippet (parse a
CSV, filter an array, compute aggregate stats) and executes it. Use
when the task wants imperative data wrangling — `calculate` can't
loop, `run_js` can.

**Implementation choices** (pick one in the actual implementation
batch):

### A — `isolated-vm` (recommended)

V8 isolates. Memory + CPU bounded per-call. Mature, used by
Cloudflare Workers under the hood.
- ✅ Strong isolation (separate heap, no shared globals with host).
- ✅ Memory cap (e.g. 50 MB), CPU cap (e.g. 5 s) enforced by V8.
- ❌ Native dependency. `prebuild-install` covers most platforms but
  Alpine + odd ARM can fail.

### B — `node:vm` with frozen context

Built-in, zero deps. Less strict isolation but enough for code the
agent itself generated (vs. user-supplied untrusted code).
- ✅ Zero deps; works on every Node version.
- ❌ Shared heap with host; a worker process is needed for memory
  isolation. CPU cap via `timeout` option is best-effort.

**Recommendation:** ship A. If install friction comes up in practice,
fall back to B in a `worker_threads` worker (CPU isolation via
process boundary, memory cap via `resourceLimits`).

**Risks: medium.**
- The agent could still write filesystem paths into a `fs` call IF we
  expose `fs` — so the sandbox MUST refuse `fs` / `child_process` /
  `network`. mathjs already does the right thing here for math; for
  JS we explicitly whitelist `console` + a frozen utility namespace.
- LLM could write a CPU-bound infinite loop. The 5 s cap catches it.

**UI:** off by default. Opt-in per chat via the composer's "..." menu
(Phase 1 work, see below). The toggle persists per chat.

---

## Phase 3 — Python execution (deferred)

**Tool name:** `run_py`

This is meaningfully harder than JS:

- **Pyodide (WASM Python)** — portable, ~10 MB initial download, slow
  cold start (~3 s), no native libs. Good for pure-Python data work.
- **Native Python via `child_process`** — fast, has numpy/pandas, but
  inherits the host's full file/network access. No real sandbox
  short of Docker / nsjail / seccomp.
- **Docker** — proper isolation, but requires Docker on the host,
  adds 5–15 s per invocation for container startup, complicates
  deployment.

**Recommendation:** ship Pyodide first if/when there's demand. Native
Python only behind an explicit `ARIADNE_ALLOW_NATIVE_PYTHON=1`
environment toggle for power users who accept the trade-off. Docker
is its own batch (image management, lifecycle, image pull bootstrap).

---

## Security check layer (Phase 2.5 — optional)

The user floated "a second agent that security-checks generated code".
This is a real pattern (Anthropic's tool-use cookbook calls it "code
review"); it's worth ~one short LLM call per `run_js` invocation:

- Input: the snippet the planner produced + the task description.
- Output: `{ "safe": true } | { "safe": false, "reason": "..." }`.
- Failure mode: hostile or pathological code → refuse with the
  reason surfaced to the user.

Cost: ~300 ms per call (small classifier model). Trade-off: extra
latency for every `run_js` step, even safe ones. Mitigation: cache
the verdict per (snippet hash, task hash) so re-runs of the same plan
don't re-pay.

**Recommendation:** ship as opt-in initially (env flag), promote to
default-on once the false-rejection rate is acceptable in practice.

---

## UI sequencing — the "..." overflow menu

The composer chip strip currently shows: Attach · Web · Agent ·
Skills · Workspace · Model. Adding 2–3 more pills for `run_js` /
Python / security-check would crowd the bar.

**Sequencing decision:** the overflow menu lands in the same batch
as `run_js` (Phase 2), not before. Building it now with nothing to
put in it is premature; the existing chip strip is still readable.

When Phase 2 ships:
- A new **"..." (More)** button at the right edge of the chip strip.
- The overflow menu collects: Skills (existing), `run_js` toggle
  (new), `run_py` toggle (new), any other less-used switches.
- On mobile (`md:` breakpoint and below), every chip is icon-only
  (no label) — already partially supported by the existing
  responsive classes.

Math (`calculate`) lands as **always on** because the risk is
trivial — no user toggle. `run_js` and Python need the toggle
(real side-effect surface).

---

## Performance budget

Targeting the planner's existing budgets:
- `calculate`: < 5 ms typical, hard cap 100 ms.
- `run_js` (Phase 2): < 50 ms typical for small loops, hard cap 5 s.
- `run_py` (Phase 3): cold start 1–3 s (Pyodide), warm < 200 ms;
  Docker is in seconds — fine for a long-running analysis, wrong
  for tight loops.

The agent's re-plan budget is already 2 — these tools fit cleanly
under it because each call is bounded and atomic.
