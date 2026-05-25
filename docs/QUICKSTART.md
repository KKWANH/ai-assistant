# Quickstart — first chat in 5 minutes

Assumes you've finished `docs/INSTALL.md` and have Ariadne running at
`http://localhost:4319`. This walk-through gets you from "fresh install" to
"AI editing a real file via the staged-diff flow" in 5 minutes.

---

## 1. Open the app + look around (30 sec)

`http://localhost:4319` lands you straight in chat. The empty state shows two
suggestion chips ("Show me what this folder is about" / "Help me draft …") —
those are demo prompts, not magic; ignore for now.

Top-left: sidebar with **Chats**, **Workspaces**, **Runs**, **Reports**, **Search**.
Bottom of the chat: the **composer** with attach / web / agent / Skills toggles.

## 2. Create your first workspace (60 sec)

1. Sidebar → **Workspaces** → **+ New**.
2. **Name**: anything ("My code", "Notes 2026", …).
3. **Root path**: a folder on disk you already have. Code project, notes
   folder, whatever.
4. **Starter**: leave on **Blank** for now.
5. Click **Create**.

Ariadne immediately scans the folder (you'll see "Last scan: just now" with the
file count). Files larger than 200 KB or matching `*.env` / `credentials*.json`
/ `*secret*` are excluded by default — see `apps/server/src/security/sensitive.ts`
for the full list.

## 3. Chat against the workspace (60 sec)

1. Back to **Chats** in the sidebar → **+ New chat**.
2. In the composer, click the workspace icon (📁) and pick the workspace you
   just made. The icon turns accent-coloured.
3. Type a question that needs your files. Examples:
   - "Summarise what this codebase does."
   - "What functions does `xyz.py` define?"
   - "Find the file that mentions [some term you know is in there]."
4. Send.

You'll see:
- A streaming markdown reply
- A small footer on the answer with the **model that produced it** (e.g.
  `· anthropic / claude-opus-4.5`) — hover the assistant message to reveal
- (If web search was on) a sources card under the answer

The retrieval the model sees is the **hybrid** path (BM25 + semantic + symbol
boost via RRF) when an embedding index exists — same engine the eval harness
benchmarks. See `docs/RAG_HARNESS.md` for the measured numbers.

## 4. Make a staged file edit (90 sec)

This is the part that makes Ariadne different.

1. In the same chat, ask: *"Add a comment at the top of `<pick a real file>` saying 'tested by Ariadne'."*
2. Turn on **Agent** mode in the composer toolbar (the bot icon).
3. Send.

The agent will:
- Plan steps (you'll see a checklist render in the message)
- Call `read_file`
- Call `edit_file` — which **stages** the change, doesn't write it to disk
- Tell you it's done

Notice the small chip above the composer: **"Open attempt — review staged
edits"**. Click it. You land on `/runs/<runId>/diff` showing the unified diff
of the proposed change.

**Apply** writes it to disk (and creates a git commit in `.ariadne/`).
**Discard** drops the stage. Either way, the original file was never touched
until you clicked.

## 5. (Optional) Make a reusable Skill (60 sec)

1. **Settings** (gear icon, top right) → **Skills**.
2. New skill:
   - **Name**: `review`
   - **Prompt**: `Review the {language} code below. Find bugs, edge cases, and
     one improvement. Return only the findings — no preamble.\n\n{code}`
   - **Variables**: `language` (default `typescript`) + `code` (no default)
3. Save.

Back in chat, type `/review` — the picker pops, click your skill, fill in the
form, the prompt lands in the composer. Hit send.

You'll also see 6 **built-in** skills: `translate`, `summarise`, `rewrite`,
`review-code`, `explain-code`, `debug`. Useful out of the box.

---

## Recovery — "I'm stuck on the login screen"

If you ever see a 401/403 loop on `https://your-name.kwanho.dev`:

1. On the login screen, click the small underlined link below the **Sign in**
   button: *"Stuck on this screen? Reset session."*
2. The browser drops `ariadne_session` and reloads.
3. Log in fresh.

If that doesn't fix it (Cloudflare-side cookies are unrelated to ours), clear
all cookies for the site in your browser's site-settings UI.

---

## Next steps

- **Build a custom dashboard** (Surface) for a workspace — `.ariadne/surface.tsx`
  with a typed React component. See the C coding-test workspace surface for an
  example (textarea editor + "build & run" actions).
- **Schedule a recurring action** — Settings → Schedules. cron-style triggers
  for "every Monday at 9am, run this action."
- **Connect a real provider** — set the env vars in `docs/INSTALL.md` § 5 and
  restart. The settings UI switches between providers per chat.
- **Run the eval harness** — `npm run eval:strategy -- --use-db`. Strategy
  comparison table prints in 10 seconds. PR contributors should look here.
- **API integration** — `docs/API.md`.
