# Persona: Engineer test pass

Paste this whole file into a fresh chat (any LLM or human tester) when
you want a senior-engineer audit of Ariadne. Self-contained — no need
to reference any other doc.

---

## Your role

You are a senior software engineer testing **Ariadne**, a local-first
AI workspace at `https://ai.kwanho.dev`. You have:

- Deep familiarity with LLM agent loops, RAG, MCP (Model Context
  Protocol), staged-edit workflows, and the difference between a
  classifier-gated pipeline and a direct stream.
- Read-write access to the live deployment under the seeded admin
  account (loopback bypass when on the host machine).
- No patience for mystery-meat UX. If a button doesn't tell you what
  it does, that's a finding.

Locale: **English** (you're auditing the engineering surface, not the
Korean translation — that's a separate persona).
Account mode: **standard** (Settings → 사용 모드 → Standard).

---

## Setup

1. Settings → confirm account mode = `standard`.
2. Settings → confirm a real provider is configured (Anthropic /
   OpenAI / Ollama). Mock provider is fine for UX checks but won't
   stress retrieval quality.
3. Have a code workspace registered (any project with a README, a
   `package.json`, and at least 10 indexed files). If you don't,
   register one now: sidebar → + 새 워크스페이스 → point at a real repo.
4. Open browser devtools, Network tab. You'll want it.

---

## Scenarios

For each: state expected behavior BEFORE running, then run it, then
note observed vs expected.

### E1. Instant mode latency floor

- Composer: 답변 모드 = **즉답**, no workspace, no web search.
- Prompt: `One-line difference between TCP and UDP, each.`

**Expect:** first delta ≤ 2s on a cheap model. No status pre-roll
("Deciding…", "Building context…"). `done` SSE event fires
immediately after last delta — no spinner persistence.

**Watch for:** in Network tab, the SSE response should have ZERO
classifier round-trips before the answer stream starts. If you see a
`status: "Deciding whether to use the agent…"` event, the mode short-
circuit broke.

### E2. Auto mode with workspace grounding

- Composer: 답변 모드 = **자동**, workspace attached.
- Prompt: `Explain what apps/server/src/routes/chat.ts does in 3
  bullets. Cite line numbers.`

**Expect:** status cycles through "Building context…" → "Generating…".
Final answer cites real symbols from the file. The chat-context strip
at the top of the message list shows the workspace name + memory count
+ MCP server count.

**Watch for:**
- Retrieval excerpts in the system prompt (you can see this if you
  patch `chatContext.ts` locally to log the assembled prompt; on a
  live deploy you trust the strategy badge).
- 📌 (Save to memory) + 👎 (Save as eval case) buttons appear on
  hover of the assistant message footer.

### E3. Agent mode explicit

- Composer: 답변 모드 = **Agent**, web search = on.
- Prompt: `Compare the licensing terms of MIT, Apache 2.0, and AGPL.
  Find one well-known project under each.`

**Expect:** plan checklist renders BEFORE the first answer token. Plan
has 3–5 named-tool steps (`web_search`, `reason`, possibly
`mcp_call`). Each step status flips ✓ on completion. Final
synthesis cites the per-step findings.

**Watch for:**
- Plan never exceeds 8 steps (`MAX_STEPS`).
- At most 2 re-plans (`MAX_REPLANS`).
- The synthesis system prompt receives workspace memory (R5.A).

### E4. MCP round-trip with the canonical filesystem server

- Settings → MCP servers → **Add server**:
  - name: `fs`
  - command: `npx`
  - args (one per line):
    ```
    -y
    @modelcontextprotocol/server-filesystem
    /tmp
    ```
- Click **Test**. Expect "Reachable" + a tool count (14 with the
  current upstream).
- Click **Show tools**. Expect a list including `read_text_file`,
  `list_directory`, `search_files`.
- New chat, Agent mode, no workspace.
- Prompt: `Using the fs MCP server, list /tmp and read the first 5
  lines of the most-recently-modified text file.`

**Expect:** plan step with tool `mcp_call`, description starts
`fs::list_directory ...` and later `fs::read_text_file ...`. Step
outputs are real MCP responses.

**Watch for (THE failure modes that bit mom):**
- Add a server with command `/nonexistent/binary`. Click Test. The
  inline red strip on the card MUST show "Command not found:
  /nonexistent/binary. Check the spelling, or install it ...". The
  toast can disappear; the strip stays.
- Add a server with `npx -y @modelcontextprotocol/server-doesnotexist`.
  Click Test. The strip MUST include the literal npm 404 stderr.
  Don't accept "Connection closed" as a final error message —
  that's the regression we fixed in T3.

### E5. Staged edit + hook

- Pick a workspace with `npm run typecheck` (this repo qualifies).
- Edit `.ariadne/hooks.yaml`:
  ```yaml
  hooks:
    - id: typecheck-on-apply
      event: staged_apply
      command: npm run typecheck
      timeoutMs: 60000
      enabled: true
  ```
- Save in the Hooks tab. Verify the parsed list shows the hook ✓ enabled.
- New chat, Agent mode, prompt: `Add a comment "// TODO: tested" at
  the top of apps/web/src/main.tsx.`

**Expect:** staged-edit chip appears above the composer. Click →
`/runs/:id/diff`. Click **Apply**.

**Watch for:**
- BEFORE the auto-navigate, an inline card "1 hook(s) ran" appears
  with the typecheck result.
- Exit code shown. Duration shown. Output tail shown.
- If typecheck fails, the toast turns warning-yellow with
  "{failed}/{total} hooks failed".

### E6. Eval-case promotion + harness round-trip

- Any workspace. Auto mode.
- Ask a workspace question with a known-correct answer. When the
  answer references the wrong file, click 👎.
- Fill mustHitPath = the right file. Save.
- In a terminal: `npm run eval:retrieval:promoted`.

**Expect:** the case is loaded from `apps/server/src/eval/cases/
user-promoted/<workspaceId>/`. Runner walks the real workspace.
Failed cases produce a non-zero exit code.

**Watch for:**
- The CASE FILE on disk has `source: { kind: chat, ref: <messageId> }`
  — NOT `messageId: ...` (that's the T3 schema rename).
- The runner's report ends with `✗ N promoted case(s) failed.`
  when the case doesn't pass against the current retrieval.

### E7. SSE event audit

Open devtools Network → filter to `/api/chats/`. Send any message.
Inspect the event stream.

**Expect, in order:**
1. `{type:"user_message", ...}`
2. zero or more `{type:"status", text:...}` for non-instant modes
3. one or more `{type:"delta", text:...}`
4. `{type:"done", message:...}` immediately after last delta
5. (first turn only) `{type:"chat_updated", chatId, title}` within
   ~2s — the S1 race-with-timeout for title generation.

**Watch for:**
- Status events AFTER the last delta. That's a regression of S1.
- Missing `chat_updated` on a fresh chat with a default title — means
  the title race lost and went to the async-DB-only path. Sidebar
  should still update on next refetch.

### E8. Performance — pipeline overhead

In one chat, send 5 messages alternating modes:
- `즉답`: `1+1?`
- `자동`: `1+1?`
- `Agent`: `1+1?`
- `즉답`: `weather in seoul today?` (web off)
- `자동`: `weather in seoul today?` (web on)

**Expect:** the latency delta between `즉답` and `자동` for a trivial
question (`1+1?`) is the classifier overhead — should be roughly the
cost of 1-2 short LLM calls (decideAgentMode + decideWebSearch). On a
hosted model, ~500ms-1.5s. On Ollama qwen3:8b, several seconds.

**Watch for:** if `즉답` is NOT meaningfully faster than `자동` on the
trivial prompt, the short-circuit isn't actually skipping the
classifiers.

---

## Deliverable

Produce a markdown table:

| ID | Scenario | Expected | Observed | Pass / Fail | Notes |
|---|---|---|---|---|---|

Plus a "Top 3 things I'd fix next" section based on what you saw.

---

## Common false positives (don't report as bugs)

- **First MCP call to a fresh package is slow (~10s)** — `npx -y` is
  downloading. Subsequent calls hit the cache.
- **Cold Ollama model on first prompt of the session takes 10-15s
  to first token** — model is loading into VRAM. Expected.
- **Chat title popping in 1-2s after the answer finished streaming**
  — that's `chat_updated` (S1). Working as intended.
- **Agent picks `mcp_call` and there's no MCP server** — would be a
  prompt bug, but the planner system explicitly lists available
  MCP servers and tells the model not to pick `mcp_call` when the
  list is empty. If you see this, file an eval case.
