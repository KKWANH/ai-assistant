# Promotion strategy

> **⚠️ Mixed-vintage launch playbook — for the product definition read
> [`PRODUCT.md`](PRODUCT.md).** Contains stale vocabulary ("Gasp filter",
> "evidence pack" as the headline). The canonical killer-feature ranking
> is in PRODUCT.md §5 (platform/custom-surfaces first). Overlaps with
> LAUNCH_PLAN.md.

This file is the launch playbook for Ariadne. It captures the audience,
the message, the channels, and the assets to prepare. Keep it as a working
doc — update each row as something ships or as a channel proves out.

---

## 1. Who Ariadne is for

Three concrete personas, ranked by how much pain Ariadne solves for them
today. The earlier readers are highest-leverage for the v0.1 launch.

| # | Persona | Their pain | What Ariadne replaces |
|---|---|---|---|
| 1 | **Independent analyst / consultant** writing weekly briefs from a folder of PDFs, CSVs, and notes | Can't cite where each paragraph in their brief came from when the client asks; rebuilds the same prompt every Monday | A folder full of "brief.docx (final v3 FINAL)" + ad-hoc ChatGPT chats |
| 2 | **Graduate researcher** chasing a literature thread across PDFs and lab notes | Lost source attribution; re-running an analysis after new papers come in means redoing it from scratch | Notion + ChatGPT + Zotero stitched together by hand |
| 3 | **Senior IC / staff engineer** drafting design memos from RFCs, ADRs, and codebases | The LLM hallucinates a missing decision they "remember reading"; no way to spot the hallucination later | Cursor + Notion + ad-hoc chats with no audit trail |

Anti-personas (politely ignore for v0.1):
- Casual users who only want general-knowledge Q&A → ChatGPT is fine.
- Enterprise teams needing SSO + audit logs + RBAC → Ariadne is single-tenant.
- Developers who want a coding agent → Cursor / Claude Code is the right tool.

---

## 2. The message (rank-ordered)

These are the three lines, in priority order, that should appear in every
piece of promotion. Pick one per medium based on length budget.

1. **"Every answer carries a thread back to its sources."**
   The headline. Ties to the Ariadne myth and to the unique evidence pack.
2. **"A local-first AI workspace — your folders, your models, your trail."**
   The positioning. Local-first + multi-provider + reproducible.
3. **"Re-runnable work briefs. Not just chat."**
   The differentiator vs. ChatGPT and clones. Use when the audience is
   already AI-fluent.

Avoid in v0.1:
- "Replace ChatGPT" — it doesn't, and we don't want to fight that battle.
- "Open source" alone — that's necessary, not sufficient. Lead with what
  it *does*, not its license model.
- Coding-agent framing — Cursor / Claude Code own that.

---

## 3. Channels — what, when, where

### Phase 0 — Soft launch (the next 2 weeks)

- **Personal X / Twitter thread** (5–7 tweets). Hook: a 20-second screen
  recording of the **intent-chip** moment (Screenshot #5). Lead with the
  "thread back to its sources" line, end with the GitHub link.
- **Personal LinkedIn post** — same screen recording, longer prose, ends
  with the GitHub link and an ask for early users.
- **One-paragraph DM** to 10–20 specific people in personas 1–2. Skip
  persona 3 here — devs are easier to reach via HN later.

### Phase 1 — First public posts (weeks 2–4)

- **Show HN** post. Title: `Show HN: Ariadne – a local-first AI workspace
  with evidence-mapped answers`. Body: 80–120 words, link the demo
  screenshot, link to the GitHub repo, link to the live tunnel URL
  (ephemeral or your custom domain). Time: Tuesday or Wednesday, 09:00 PT.
- **r/LocalLLaMA** post. Title: `Ariadne — local-first workspace that
  pairs Ollama with evidence-backed runs and re-run diffs`. Focus the
  body on Ollama default + the Gasp filter + the .ariadne/ portability.
- **r/selfhosted** post. Title: `Ariadne — self-hostable AI workspace
  with Cloudflare-tunnel + named-domain setup in two commands`. Focus
  the body on `ops/setup-tunnel.sh` + the supervisor + the admin
  dashboard.
- **Hacker Newsletter / TLDR-AI** — submit via their forms with the same
  screen recording.

### Phase 2 — Sustained presence (months 2+)

- **Weekly devlog** on the repo's GitHub Discussions or a personal blog.
  One post per shipped feature with the screenshot from `docs/screenshots/`.
- **YouTube short** (60 s) on the **portfolio dashboard custom-surface**
  demo (Screenshot #1). The visually loudest moment Ariadne has.
- **Conference / meetup talks** — Korean AI meetups (특히 비개발자 대상
  세션이 좋은 회로) for the supported-Korean angle; SF AI dinners for
  the evidence-pack angle.
- **Comparison blog post** — "Ariadne vs Open WebUI vs LibreChat" — pull
  the table from the main README's *How Ariadne is different* section
  and expand each row into a paragraph. Pitch to AI newsletters.

---

## 4. Assets to prepare (checklist)

This is the asset checklist that maps onto the screenshot plan in
`docs/screenshots/README.md`. Tick each item as it lands.

- [ ] All 8 required screenshots captured (`docs/screenshots/*.png`).
- [ ] 3 bonus screenshots captured (composer-modes, settings-providers,
      workspace-rename).
- [ ] **20-second screen recording: intent chip in action.** Send "내
      포트폴리오를 요약해줘" in the Portfolio chat. Capture from before
      sending through chip appearing. Use this everywhere the medium
      supports motion.
- [ ] **30-second screen recording: portfolio dashboard scrolling.** The
      `라이브 시세` badge ticking is mesmerising — useful for X/Twitter.
- [ ] **GitHub social preview image** (1200 × 630). Use the hero SVG over
      a dark background, with the headline message. Set via repo
      Settings → Social preview.
- [ ] **OG image for the live URL** (1200 × 630). Same as social preview
      or a screenshot composite. Wire via a `<meta property="og:image">`
      tag in `apps/web/index.html`.
- [ ] **Demo video (90 s)**, sequence: portfolio (5 s) → workspace
      overview (5 s) → action run (15 s) → intent chip (10 s) → agent
      mode (20 s) → edit-regenerate (10 s) → re-run diff (15 s) → outro
      with GitHub URL (10 s).

---

## 5. Talking points by channel

A cheat-sheet for tailoring the same message to each platform's culture.

| Channel | Lead with | Avoid |
|---|---|---|
| X / Twitter | screen recording + the *thread* metaphor | feature lists |
| LinkedIn | persona pain → solution narrative | code, jargon |
| Hacker News | the architecture (Gasp filter, .ariadne folder, tunnel split) + a screenshot | superlatives ("revolutionary"), buzzwords ("agentic") |
| r/LocalLLaMA | Ollama default, no key needed, evidence-backed runs | comparisons to paid providers as the lead |
| r/selfhosted | tunnel + supervisor + admin dashboard + 2-command deploy | LLM marketing speak |
| Korean dev communities (geeknews.io, dev.to/kr, 디스콰이엇) | first-class Korean, 비개발자 모드, 한국 사용자 우선 디자인 결정들 | 영어 그대로 번역 — 한국 청중에는 한국 사용자 시점에서 작성한 글이 통함 |

---

## 6. Metrics

Define what "promotion is working" looks like. Concrete, weekly.

- **Lagging indicators (vanity but informative):** GitHub stars, repo
  traffic from Insights, X impressions.
- **Leading indicators (the ones to optimise):**
  - Number of `ops/install-aliases.sh` runs (proxy: count the script's
    HEAD requests if it's hosted, otherwise survey).
  - Number of public-tunnel sign-ins on the demo deploy.
  - Number of GitHub issues opened by non-author accounts.
  - Number of pull requests opened (any size).
- **Conversion question per post:** did at least one new user open the
  repo *and* run `ariadne start`? If a post yields zero of those, the
  message or the channel is wrong — adjust before doing it again.

---

## 7. The 6-week timeline

Concrete dates calibrated to a Monday-week start.

| Week | Headline action | Asset deadline | Channels |
|---|---|---|---|
| 1 | Soft launch | All 8 screenshots, 20-s intent-chip recording | Personal X, LinkedIn, 10–20 DMs |
| 2 | Show HN | 90-s demo video, GH social preview | Hacker News (Tue 09:00 PT) |
| 3 | Reddit cluster | None new — reuse week-1 assets | r/LocalLLaMA, r/selfhosted, r/SideProject |
| 4 | Korean dev posts | Korean-localised tweet + blog draft | geeknews.io, 디스콰이엇, 페이스북 한국 AI 그룹 |
| 5 | First newsletter pitch | Comparison-blog draft | Hacker Newsletter, TLDR-AI, Bytes.dev |
| 6 | Comparison blog goes live | Cleaned-up blog post + chart updates | Cross-post to dev.to, personal blog, X |

After week 6, switch to the sustained-presence cadence in §3 Phase 2.

---

## 8. Things to *not* do (yet)

- Don't pay for ads. The audience is small and well-targeted enough that
  organic + niche communities will outperform paid by 5–10× per signup.
- Don't promise enterprise features (SSO, RBAC, team workspaces) — they
  are on the roadmap but not v0.1. Setting that expectation now creates
  pressure to ship them before product-market fit is clear.
- Don't open-source-license-bait — license can shift later; lead with
  what the tool *does* not what it *isn't*.
- Don't compete with Cursor / Claude Code framing. Ariadne is for
  research-flavoured knowledge work, not coding.
