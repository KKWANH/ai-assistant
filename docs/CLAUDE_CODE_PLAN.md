# Claude Code-style coding feature — full design

A complete planning document for adding coding capabilities to Ariadne,
positioned as a long-running track. Aiming at "the eventual Cursor /
Claude Code alternative that uses your local models" — but the v1
target is much smaller and well-scoped.

This doc supersedes the brief section in `docs/PLANNED.md`. Read this
first before implementing any of it.

---

## 1. Why this fits Ariadne (and where it doesn't)

Ariadne is already *good* at:

- Reading local folders with a safety guard (Gasp filter, sensitivity
  detection).
- Multi-step agent loops with re-planning on failure.
- Action pipelines: read → ask → write blocks chained with explicit
  flow control.
- Workspace surfaces — custom dashboards over the same workspace.

What it's **missing** to do code work:

| Capability | Status today | Why it matters |
|---|---|---|
| Multi-file editing with confirmation | ❌ | Coding agents must propose patches the user reviews before they hit disk. |
| Test execution from inside an action | ❌ | Closing the loop on "did the patch work" is the table-stakes feedback signal. |
| Diff preview UI | ❌ | The user must see before/after side by side. Otherwise the experience is a folder full of mystery changes. |
| Code-aware retrieval | Partial (keyword + embedding text-RAG exists) | LSP-aware symbol search would help; for v1 the existing retrieval is fine. |
| Repo-aware navigation | ❌ | File tree + jump-to-definition is what makes editors editors. |

**Explicit non-goals** for the Ariadne-Claude-Code track:

- Real-time pair programming (Cursor's strength — needs deep editor
  integration, autocomplete latency that's only viable inside an LSP).
- Multi-tab buffer state, undo stack, syntax highlighting at editor
  level. We delegate to the user's actual editor. Ariadne shows diffs,
  proposes patches, runs tests; the user opens VS Code / vim / Cursor
  to do the actual reading.
- Replacing the user's terminal. Tests, build commands, etc. run via
  the existing `run_script` block, NOT by exposing a shell.

**Positioning vs. Cursor / Claude Code:**

- **Cursor / Claude Code** are *editor-first* — the chat is one panel of
  an IDE. Best at moment-to-moment coding flow.
- **Ariadne-Code** would be *workflow-first* — the chat is the
  workspace, and code edits are one block type in a larger pipeline.
  Best at scheduled / repeatable / auditable code work (e.g. "every
  Monday, audit my dependencies, propose patches for stale ones, open
  PRs").

So the wedge is: **operations + audit + scheduling around code**, not
the editor flow itself.

---

## 2. UX research summary

Studying the three closest competitors:

### Cursor's "Composer" mode

- Multi-file edit with side-by-side diff in the editor.
- "Apply" / "Reject" per file.
- Auto-runs the test command after apply (when configured).
- Friction points it solves: (a) reviewing 10 small edits separately
  is exhausting → batch review with checkboxes; (b) "did this break
  things" → inline test results.

### Claude Code (CLI)

- Streamed plan → propose edit → user confirms → write → run command
  → iterate. Terminal-native; minimal UI.
- The plan is plain prose; the edits are concrete tool calls
  (`edit_file`, `read_file`, `bash`).
- Strong at agentic loops because there's no UI cost per turn. Less
  strong at multi-file review (the user is reading sequential output
  rather than a diff panel).

### Aider (CLI)

- Git-aware: commits each accepted edit, splits long sessions across
  branches.
- Pre-built "tree of edits" — user can rewind to before a bad patch
  with a single command.
- This is the design that maps best to **what Ariadne already has** —
  the run engine + workspace git history. Aider's "rewind" is just
  our `.ariadne/` git log filtered by run.

### What Ariadne should adopt vs. invent

| Pattern | Source | Verdict |
|---|---|---|
| Side-by-side diff per file with apply/reject checkboxes | Cursor | Adopt |
| `edit_file` + `read_file` + `bash` as concrete blocks | Claude Code | Adopt as `edit_file` + `run_tests` + (existing) `run_script` |
| Git commit per accepted edit set | Aider | We already have this via workspace history — extend the commit message to include the run id |
| Tree-of-edits rewind UI | Aider | Adopt as a "Reset to commit X" button on the history list |
| Auto-running tests post-apply | Cursor | Adopt as an action block `run_tests` (a thin wrapper over `run_script` that captures the test command from a workspace config) |
| In-line editor / autocomplete | Cursor | Skip — out of Ariadne's lane |
| Persistent codebase index for symbol jump | Cursor | Defer — phase D candidate, not v1 |

---

## 3. Architecture

Three new pieces and one extension:

### 3.1 Block types

```
edit_file:
  config:
    path: src/foo.ts
    # Either:
    search: "old text"
    replace: "new text"
    # Or (for new files or full rewrites):
    content: "..."
    # Optional safety:
    require_match_count: 1   # error if not exactly one match
```

Behaviour:
- For search/replace: substring match with exact count enforcement.
- For full-write: behaves like `write_file` (which already exists).
- Output of the block is a unified diff that the diff-preview UI renders.
- **Never writes to disk during the run.** The diff is staged in memory
  (or in `.ariadne/staged/`) and the user must confirm to apply.

```
run_tests:
  config:
    command: "npm test"  # defaults to .ariadne/workspace.yaml's `testCommand`
    timeout_seconds: 120
    # Output capture is identical to run_script.
```

Behaviour:
- Same as `run_script` but with a known semantics (success/failure
  parsed from exit code, captured for the diff-preview UI).

### 3.2 Staging area

`.ariadne/staged/<run-id>/` holds the proposed patches for the most
recent un-applied run. Structure:

```
.ariadne/staged/<run-id>/
  manifest.json          { files: [{ path, action: "modify"|"create"|"delete", diff: "..." }] }
  before/                copies of files before the patch (so reject is a single mv)
  after/                 candidate file contents after the patch
```

This intentionally mirrors a git working tree without using git
plumbing — keeps the implementation small and lets us version the
*final* state via the existing workspace history once the user accepts.

### 3.3 Diff preview view

New route: `/runs/<run-id>/diff`. Renders the manifest as a list of
files, each expandable into a side-by-side diff (using `diff` package
or the `diff-match-patch` algorithm). Per-file checkboxes; bottom bar:
"Apply N selected / Discard / Apply all & run tests".

Render via Monaco's diff editor when available (already a transitive
dep via the CodeMirror surface editor — verify) or a CSS-based
side-by-side using a small `diff` lib.

### 3.4 Coding-tuned model presets

`apps/server/src/providers/index.ts` already abstracts the chat
providers. Add a per-action override: `action.providerHint = "code"`
selects a model from a coding preset list:

- Local: `qwen2.5-coder` (Ollama), `deepseek-coder` family.
- Hosted: Anthropic `claude-sonnet-4.5` already strong; OpenAI `gpt-4o`
  fine.

Implementation: a thin lookup in `streamAssistantReply` /
`runBlock` that swaps the default-preferred model when the hint is
present, before resolving via the existing provider switch.

---

## 4. MVP scope (Phase A) and out-of-scope (Phase B/C)

### Phase A — what ships first

1. `edit_file` block (search/replace + full-write).
2. `run_tests` block.
3. `.ariadne/staged/` working tree.
4. Diff-preview UI at `/runs/<id>/diff` with per-file apply/reject.
5. Apply path: copy `after/<path>` → workspace, commit to workspace
   history via the existing `commitWorkspaceHistory`.
6. Coding-model preset picker (Ollama-tuned defaults; no UI yet — set
   in YAML).

Acceptance check:

- A user writes an action `fix-readme-typos` with three blocks:
  `read_file → ask_ai → edit_file`. Runs it. The `/runs/<id>/diff`
  page shows one file (README.md) with a unified diff. User clicks
  "Apply", workspace history records the commit, README is updated on
  disk.

### Phase B — second batch

- A code-shaped workspace surface: file tree on the left, diff in the
  centre, test output below. Built on the existing custom-surface
  primitive (workspace ships `.ariadne/surface.tsx` like Portfolio
  does).
- Inline "Rewind to this commit" button on the workspace history list
  (already a UI — add the action).
- Multi-step "fix until tests pass" agent loop using
  `edit_file → run_tests → re-plan` re-using the existing agent
  re-plan gating.

### Phase C — long tail

- LSP-aware code symbol search (probably via tree-sitter rather than
  full LSP). Replaces the keyword retrieval for source code only.
- Multi-file refactor previews with split-screen scrolling.
- Branch-per-attempt: a long agent run can fork to a branch, succeed
  or abandon, and merge back without leaving stray commits on `main`.

---

## 5. Risks and how to mitigate

| Risk | Mitigation |
|---|---|
| `edit_file` corrupts a file with a bad search/replace | `require_match_count` enforced; full pre-write copy in `.ariadne/staged/before/`; "Rewind" button always available |
| User accepts a destructive patch they didn't read | Apply-all is behind a confirm modal that lists affected paths; per-file checkboxes default to OFF for new-file deletes |
| Local-model output drifts from the actual file (line-shift bugs) | `edit_file` uses character-level search/replace, not line numbers — robust to formatting drift |
| Test runner hangs forever | `run_tests.timeout_seconds` mandatory, default 120s |
| Tokens for whole-file rewrites get expensive | Diff-mode preferred for changes >5 lines; whole-file only when the file is small (<200 lines) |
| Agent loop loops forever on a broken test command | Re-plan budget already in place (MAX_REPLANS=2); we surface "tests failed N times — stopping" cleanly |

---

## 6. Effort estimate

| Phase | Batches | Notes |
|---|---|---|
| A | 2 | Block executors + staging dir = 0.5 batch. Diff-preview UI is the bulk — 1.5 batches. |
| B | 1.5 | Workspace surface variant + rewind UI |
| C | 3+ | LSP/tree-sitter symbol search is a project on its own |

Total to a usable Ariadne-Code: ~3.5 batches.

---

## 7. Sequencing recommendation

Don't start Phase A until:

1. ✅ Embedding-based RAG ships (done in the batch alongside this doc).
   The diff-preview UI will reuse the workspace file-tree component
   the retriever already implies.
2. ✅ Workspace git history ships (done in the batch alongside this
   doc). The "Apply" path commits through the same machinery.
3. ⏳ At least one real workspace surface variant beyond Portfolio
   exists, so the surface-as-IDE pattern in Phase B has a precedent.
   (Chefbook counts — landed this week.)

All three are done. Phase A is unblocked.
