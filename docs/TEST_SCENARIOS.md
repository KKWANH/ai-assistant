## Manual test scenarios

Short prompts you can paste into a fresh chat on `https://ai.kwanho.dev`
(or `http://localhost:4319`) to spot-check the UX for two different
personas. The point isn't to grade the answer — it's to grade what the
**user experiences** (latency, clarity, errors, discoverability).

For each scenario: empty context, fresh chat, the suggested settings,
paste the prompt, watch what happens. Notes below each item tell you
what to look for.

---

## A. Developer persona (account mode: standard)

### A1. Direct factual ask — Instant
- **Composer**: 답변 모드 = `즉답`
- **Workspace**: none
- **Prompt**: `Difference between TCP and UDP in one sentence each.`

What to look for:
- First token within ~2s on a cheap model (gpt-4o-mini / haiku / qwen)
- No "status" pre-roll ("Deciding whether to use the agent…" etc.)
- `done` event fires immediately when last token streams — no spinner
  lingers
- Chat sidebar title updates to something like "TCP vs UDP" within 2s

### A2. Workspace-grounded factual ask — Auto
- **Composer**: 답변 모드 = `자동`, workspace attached
- **Workspace**: any code repo with a README
- **Prompt**: `What does this project do? Be concrete.`

What to look for:
- Workspace context strip shows at top: name · N memories · M MCP
- Status line cycles "Building context…" → "Generating…"
- Answer references files by path (e.g. `src/index.ts`)
- 📌 (Save to memory) + 👎 (Save as eval case) buttons appear in the
  assistant message footer on hover

### A3. Multi-step research — Agent
- **Composer**: 답변 모드 = `Agent`, web search = on
- **Workspace**: none
- **Prompt**: `Compare the licensing terms of MIT, Apache 2.0, and AGPL.
  Find one real-world project for each.`

What to look for:
- Agent plan checklist renders BEFORE first answer token
- Plan has 3–5 steps with named tools (`web_search`, `reason`, etc.)
- Each step ticks ✓ as it completes
- Final synthesised answer cites the per-step findings
- Trace doesn't loop forever — caps at 8 steps (`MAX_STEPS`)

### A4. MCP tool call
- **Setup**: Settings → MCP servers → add:
  - name: `fs`, command: `npx`, args: `-y`, `@modelcontextprotocol/server-filesystem`, `/tmp`
  - Click **Test** — should show "Reachable" + tool count
- **Composer**: 답변 모드 = `Agent`
- **Workspace**: none
- **Prompt**: `Using the fs MCP server, list everything in /tmp and pick
  the most-recently-modified text file. Read its first 5 lines.`

What to look for:
- Plan includes a step with tool = `mcp_call`
- Step description starts `fs::list_directory ...` and later
  `fs::read_text_file ...`
- Output of each step is the actual MCP server response (file list,
  file contents)
- If you DELETE the fs server and re-ask, the plan falls back to
  `read_file` / `list_files` (workspace tools) instead

### A5. Staged edit + hook
- **Setup**: pick a workspace with a `package.json` that has
  `npm run typecheck`. In the workspace's `.ariadne/hooks.yaml` add:
  ```yaml
  hooks:
    - id: typecheck-on-apply
      event: staged_apply
      command: npm run typecheck
      timeoutMs: 60000
      enabled: true
  ```
- **Composer**: 답변 모드 = `Agent`
- **Prompt**: `Add a /** TODO test marker */ comment to the top of
  apps/web/src/main.tsx.`

What to look for:
- Run leaves a staged edit (orange chip above composer)
- Click → `/runs/:id/diff` shows before/after
- Click **Apply** → instead of auto-navigating, an inline card appears:
  "1 hook(s) ran", with `typecheck-on-apply` ✓ and the duration
- If you intentionally break the edit so typecheck fails, the card
  shows ✗ + the failure tail

### A6. Eval-case promotion
- **Setup**: workspace with at least one indexed file
- **Composer**: 답변 모드 = `자동`
- **Prompt**: ask a workspace question you know has a "right" answer.
  When the answer is wrong, click 👎.

What to look for:
- Modal opens with the question pre-filled (read-only)
- mustHit + note fields editable
- Save → success toast → file lands at
  `apps/server/src/eval/cases/user-promoted/<workspaceId>/...yaml`
- `npm run eval:retrieval:promoted` (in a terminal) picks the case up
  and runs it against the real workspace, exits non-zero if it fails

---

## B. Non-developer persona (account mode: simple)

Switch in Settings → "사용 모드" → `simple` first. The composer + tabs
visibly simplify.

### B1. "What time is it in Berlin?"
- **Composer**: 답변 모드 = `즉답` (auto-selected in Easy mode)
- **Workspace**: none
- **Prompt**: `지금 베를린 몇시인지 알려줘.`

What to look for:
- ZERO progress messages — direct answer streams immediately
- No agent/MCP UI elements clutter the composer (Agent button hidden
  in Easy mode? — actually visible because T1 unified it, but Auto +
  Agent options are still there for discoverability)
- Title updates without spinner lag

### B2. "Help me write a thank-you email"
- **Composer**: 즉답
- **Prompt**: `친구 결혼식 끝나고 보낼 감사 메시지 짧게 써줘.`

What to look for:
- Tone is friendly, Korean-native (not translated-feel)
- Output uses Korean punctuation
- No "I am a local-first AI workspace…" preamble

### B3. Click-the-chip onboarding
- **Setup**: brand new chat (empty state visible)
- **Action 1**: click "파일 첨부 후 질문하기" chip
- **Action 2**: click "내 자료 폴더 연결하기" chip

What to look for:
- **A1**: native OS file picker actually opens (S3 fix)
- **A2**: "새 자료 폴더 만들기" dialog actually opens
- The two remaining chips (no more web chip after T2) are both clearly
  actionable, no dead-button feel
- No 로컬 / 워크스페이스 / 템플릿 jargon visible anywhere on the screen

### B4. Add a workspace memory
- **Setup**: any workspace
- **Action**: send a chat that produces a fact the AI confirmed (e.g.
  "이 폴더의 모든 CSV는 세미콜론 구분이야. 기억해줘.")
- Click 📌 on the assistant reply

What to look for:
- Modal opens with editable text pre-filled from the assistant
  message
- After save, the chat header's "메모리 N" chip increments
- Next message in same chat: the AI honors the memory (semicolons
  CSV) without being re-told

### B5. Connect a folder
- **Setup**: pick a small folder on disk (3–10 files)
- **Action**: 사이드바 → + 새 워크스페이스 (left as canonical term) →
  fill name + browse to folder
- After scan, ask: "이 폴더 안에 뭐가 있는지 알려줘."

What to look for:
- The "찾아보기" button actually opens the folder picker (FolderPicker)
- Last scan time + file count appear within a couple seconds
- Chat answer lists actual file names (not made-up ones)

---

## C. Cross-cutting checks

Run these once on each account-mode for a full sanity sweep.

| Check | Standard | Simple |
|---|---|---|
| Composer answer-mode picker shows 즉답/자동/Agent | ✔ visible | ✔ visible (T1) |
| Web search toggle visible | ✔ | ✔ |
| Settings → MCP servers section | ✔ visible | ✘ hidden (S4) |
| Workspace → Hooks tab | ✔ visible | ✘ hidden (S4) |
| Workspace → Memory tab | ✔ visible | ✔ visible |
| Default reply mode for new chats | `auto` | `instant` (S4) |
| `done` SSE event fires immediately on last token | ✔ (S1) | ✔ (S1) |
| Eval-case 👎 button on assistant messages | ✔ | ✔ |
| Save-to-memory 📌 button on assistant messages | ✔ | ✔ |

---

## D. Common gotchas

- **"Title pops in 1-2s later"** — that's the `chat_updated` SSE event
  (S1). Not a bug; the spinner has already cleared.
- **MCP test shows raw stderr** — intentional (T3). For non-devs the
  friendly hint comes first, the stderr after.
- **Agent picks `mcp_call` with no MCP server registered** — that's a
  prompt bug; the planner is told MCP isn't available when the list is
  empty. If it picks it anyway, file an eval case.
- **First MCP call to a new server is slow (~10s)** — `npx -y` is
  downloading the package on first run. Second call is cached.

---

## E. Quick-paste sandbox

For lazy testing — these are the bare-minimum prompts to run in order
in a single Simple-mode chat against any workspace:

1. `지금 몇시야?` (즉답)
2. `이 폴더에 뭐가 있어?` (자동)
3. `한국어 문장 하나 추천해줘.` (즉답)
4. (click 📎 chip in empty state — verify file picker opens)

If all four feel right (fast, clear, no jargon, every click does
something), the non-dev UX is in good shape.
