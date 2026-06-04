# Launch Plan — what to do, week by week

> **⚠️ Execution playbook, not a definition doc. For what the product
> is, read [`PRODUCT.md`](PRODUCT.md).** The repo ships **AGPL-3.0-or-later**
> (PRODUCT.md §6) — the Week 1 "ship an AGPL-3.0 LICENSE" step is now correct.

A concrete launch sequence for taking Ariadne from "running on my Mac
mini" to "people on the internet are using it." Picks up where
[`PRODUCT_STRATEGY.md`](PRODUCT_STRATEGY.md) §5 left off (which listed
10 tasks but didn't sequence them).

**Audience:** kwanhokim (founder/maintainer).

**Premise:** the strategy doc settled the *what* and the *why*. This
doc settles the *when* and the *how*. Each week has 1–3 specific
deliverables, a single go/no-go gate at the end, and a "what *not* to
do this week" list to prevent scope creep.

**Total runway:** 6–8 weeks to a real public launch. Front-loaded
weeks are heavier; later weeks are lighter so you don't burn out.

---

## 0. Pre-flight — answer 3 questions before week 1

Don't start the plan until these are answered. Each has a default
recommendation; override only if you have a strong reason.

| Question | Default answer | Why |
|---|---|---|
| **Audience?** | Solo devs + technical knowledge workers (researchers, PMs, writers, analysts) who already use AI but distrust SaaS data flow. | This is the audience the local-first story sells to. Trying to land "non-technical users" first means rebuilding the install flow before anything else. |
| **Distribution channel for v0.1?** | One Hacker News *Show HN* post + one r/LocalLLaMA post + a Korean *Velog/GeekNews* post. | Three channels, three audiences, one launch. Don't pre-spread on Twitter for weeks beforehand — you only get one "first impression." |
| **What's the demo?** | The "3 canonical demos" from POSITIONING §3 — pick *one* as the headline screencast for launch. | One demo, not three, in the launch post. The other two go in the README. |

→ **If you can't answer all three by the end of week 1, the launch is
not actually happening — you're in marketing-strategy-as-procrastination
mode. The plan below assumes you've answered them.**

---

## Week 1 — make it installable by a stranger

**Goal:** anyone with Node ≥22 and an API key can install Ariadne in
<10 minutes by following the README. Today, that's roughly true but
brittle in a dozen places.

### Deliverables

1. **`LICENSE` file at repo root** — AGPL-3.0 (PRODUCT_STRATEGY §1.3).
   This must ship *first*; without it, the repo is technically
   undistributable. (One PR. ~30min.)
2. **`CONTRIBUTING.md` with DCO sign-off.** (PRODUCT_STRATEGY §1.3.)
   Use the boilerplate at <https://developercertificate.org/>. (One PR.
   ~30min.)
3. **Install flow QA — fresh install on a fresh machine.** Borrow a
   friend's Mac, or use a clean VM. Time yourself doing the README's
   QUICKSTART. Note every place you got confused or had to look at the
   code. Fix those, then time it again. (1–2 days.)
4. **`make setup` / `npm run setup` one-shot** if the install needs
   more than a single command. Right now it's `npm install && cp
   .env.example .env && edit .env && ./ops/ariadne.sh start`. That's
   already pretty close — don't over-engineer this. (Maybe 1 hour.)
5. **README polish.** Add: badges (license, node version, last-commit),
   one screenshot of the empty chat → first answer → memory-pin flow,
   one screenshot of the workspace view with files indexed. (Half a
   day.)

### Don't do this week

- ❌ New features. Anything not on the deliverables list.
- ❌ Refactors. Even ones you've been itching to do.
- ❌ Marketing copy ("Ariadne is the …"). README's job is to install,
  not to sell.
- ❌ Setting up Twitter/X. Wait until there's something to show.

### Go/no-go gate

> **A non-Ariadne person can clone, install, and ask one question that
> gets a useful answer, in under 10 minutes, with only the README open.**

If yes → go to week 2. If no → stay in week 1 until yes.

---

## Week 2 — make it trust-worthy at a glance

**Goal:** when someone lands on the repo, the first 30 seconds tell
them this isn't another vibe-coded weekend project.

### Deliverables

1. **GitHub Actions CI** — typecheck + the eval harness CI gate
   (`npm run eval:retrieval:ci` already exists). Green check on every
   PR. (Half a day.)
2. **`SECURITY.md`** — short. Where to report a vulnerability
   (`kwanhokim+security@gmail.com`), what's in scope (auth, file
   access), what's out of scope (the model providers). Take the
   PRODUCT_STRATEGY §0 invariants and frame them as a security
   posture. (1–2 hours.)
3. **`PRIVACY.md`** (EN + KO) — the "not-a-processor" argument from
   PRODUCT_STRATEGY §2.2 made formal. (2–3 hours.)
4. **Repo housekeeping:**
   - Issue templates (bug, feature, question).
   - PR template (one paragraph: what changed, why, how tested).
   - `CODE_OF_CONDUCT.md` (use Contributor Covenant v2.1 verbatim — no
     custom wording).
   - Labels: `bug`, `feature`, `docs`, `good-first-issue`, `help-wanted`.
   (Half a day total.)
5. **GitHub repo description, topics, social preview image.** Topics:
   `local-first`, `ai-assistant`, `rag`, `agent`, `evals`,
   `typescript`, `react`. Description: one sentence — the load-bearing
   one from POSITIONING §1. (1 hour.)

### Don't do this week

- ❌ Make any breaking API changes.
- ❌ Open a Discord / Slack / Matrix. Premature — wait for week 4+.
- ❌ Add analytics, even "anonymous" ones. PRODUCT_STRATEGY §4.3.

### Go/no-go gate

> **A skeptical engineer (the kind who reads LICENSE / SECURITY /
> CI status before starring) sees nothing that makes them bounce.**

---

## Week 3 — the launch artifact

**Goal:** the one piece of content that does the launching. Spend the
*whole week* on this if you have to. The launch post is the single
highest-leverage thing you'll write all year.

### Deliverables

1. **The headline screencast** (~2 min, no audio, MP4 + GIF for the
   README + post). One of the POSITIONING §3 demos. Recorded *cleanly*
   — fresh database, no test workspaces, one workspace with realistic
   files, one question, one answer, one staged-diff apply. Re-record
   until it's tight. (1–2 days. This will take longer than you think.)
2. **The launch post draft** (~600–900 words for HN; ~300 words for
   Reddit; ~500 for Korean GeekNews/Velog). Each tailored to its
   audience — don't paste the same text three times. (1 day.)
3. **The README's first screen.** What's visible *above the fold* on
   github.com when someone clicks the repo link, before they scroll:
   - One sentence (POSITIONING §1).
   - One animated GIF (the screencast, looped).
   - One install command.
   - Three bullet "what it does" (concrete, not aspirational).
   (Half a day, iterating on the GIF.)
4. **Draft of a `BLOG.md`-style technical writeup** for someone who
   reads the launch post and wants to go deeper. ~1500 words on *one*
   technical choice that's interesting (the eval-case promotion
   pattern, the staged-diff invariant, the hybrid retrieval, the
   three-tier reply mode picker — pick one). Save it for week 5 —
   don't publish yet. (1–2 days.)

### Don't do this week

- ❌ Launch yet. The post is *drafted* this week, not posted.
- ❌ Show the draft to anyone outside one or two trusted reviewers.
  Avoid the "many cooks" trap.
- ❌ Add a "buy now" / "sponsor" / "pricing" line to the README.
  PRODUCT_STRATEGY §3 says supporters tier waits until v0.2.

### Go/no-go gate

> **The headline screencast is something you'd be willing to put on
> your résumé. The launch post survives the "would I read this on
> HN?" test.**

---

## Week 4 — soft launch

**Goal:** get the first 5–10 real users without the pressure of a
public post. Find the bugs that will tank the public launch *before*
the public launch.

### Deliverables

1. **Tag `v0.1.0`** on GitHub. Release notes = a shorter version of
   the launch post + a list of every feature category. (1 hour.)
2. **DM the link to 5–10 specific people** who match the target
   audience and whose feedback you trust. Personal note for each —
   *no mass DM*. Examples: a researcher friend who manages a corpus
   of papers, a dev who runs Cursor + Claude Code, a PM at a Korean
   startup that uses Notion + ChatGPT. (1 day to send + collect a
   response from each.)
3. **Fix everything they bounce on.** Real-world install issues, real
   crashes on first messages, real confusion in the UI. Watch the
   server logs while they're using it. (2–3 days.)
4. **One genuinely good first-time UX touch.** Examples: a sample
   workspace pre-populated with a few PDFs + a sample chat that asks
   the right kind of question. The kind of thing that makes someone
   say "oh, I see what this is for" in 30 seconds. (1 day.)

### Don't do this week

- ❌ Public posts of any kind.
- ❌ "While I'm at it" feature additions. Stay focused.
- ❌ Defend design decisions on feedback. Listen, log, prioritize,
  ship. If you spend more than 10 minutes arguing with a piece of
  feedback, you're not in launch-prep mode anymore.

### Go/no-go gate

> **At least 3 of the soft-launch users actually used Ariadne for a
> real task and would describe it to a friend without prompting.**

If yes → week 5. If no → there's a fundamental UX or fit issue. Stay
in week 4, fix the biggest single thing, retest.

---

## Week 5 — public launch

**Goal:** the launch happens. Don't over-engineer this week — the
launch post does the work; you just need to be present to answer
questions.

### Deliverables

1. **Monday 9am PT** (= 1am Tuesday KST — uncomfortable but optimal
   for HN front page): post Show HN. Don't ask for upvotes. Reply to
   every comment for the first 4 hours. (Half a day clearing the
   schedule.)
2. **Tuesday 8am KST:** post on GeekNews + Velog (Korean audience).
   Different framing — lead with the local-first / 데이터 주권 angle
   for the Korean post. (1 hour to post, 2 hours to reply.)
3. **Wednesday:** post on r/LocalLLaMA. Different framing again —
   lead with the eval harness + the multi-provider support, not the
   workspace OS angle. (1 hour to post.)
4. **Publish the technical writeup** drafted in week 3 — on
   wherever-you-blog (own domain ideal; dev.to or Medium fine). Link
   it from the launch posts so readers who want depth have somewhere
   to go. (1 hour.)
5. **Answer issues + PRs every day for the rest of the week.** Don't
   batch-process. Same day, ideally same hour, response — even if
   it's "I'll look at this Friday." (Real-time monitoring.)

### Don't do this week

- ❌ Start week 6 work. The launch *is* the work this week.
- ❌ Refuse feedback for being "off-topic." Sometimes the feedback
  is telling you the positioning is off, not the product.
- ❌ Take the lack of front-page placement personally. HN is a coin
  flip. Reddit is mood-dependent. The launch isn't a referendum on
  the product; it's a noisy signal.

### Go/no-go gate

> **GitHub stars > 50, issues opened > 10 (good — engagement),
> at least one external PR or substantive issue.**

If yes → week 6. If no → that's actually OK. Skip to week 7.

---

## Week 6 — capitalize on momentum (only if there is momentum)

**Goal:** convert launch-week attention into the next 90 days of
engagement.

### Deliverables (pick 2 of 4 — don't do all)

1. **Discord or Matrix server.** Only if there are ≥10 people asking
   for it. Don't pre-create it. (1 day to set up, ongoing maintenance.)
2. **Office hours / open development.** Stream yourself fixing one
   week's worth of issues, 1 hour, once. See if anyone shows up. If
   yes, do it weekly. (2 hours per session.)
3. **Outreach to 1 specific use-case community.** E.g., academic
   research Twitter, an Obsidian power-user group, a Korean
   tech-writing community. *One*, not five — depth beats spread. (1
   day of writing personal notes.)
4. **First "good first issue" wave.** Label 5–10 issues clearly with
   acceptance criteria, file paths, and the rough shape of the fix.
   Lower the floor for first-time contributors. (Half a day.)

### Don't do this week

- ❌ Build features the launch-week feedback didn't ask for.
- ❌ Start thinking about monetization. PRODUCT_STRATEGY §3.6 puts
  Tier-1 (sponsors) at v0.2 — that's months out.

### Go/no-go gate

> **There are at least 3 people other than you opening issues or
> PRs in the past 14 days.**

---

## Week 7 — recovery + planning

**Goal:** rest, then write the next 90-day roadmap based on what the
launch actually taught you. Do NOT skip the rest — burnout in week 8
is a real launch killer.

### Deliverables

1. **Take Monday off.** Genuinely. No GitHub.
2. **Tuesday–Wednesday: write `docs/POST_LAUNCH_REVIEW.md`.** What
   went better than expected, what worse, the 3 biggest pieces of
   feedback. Be honest. This doc is for *you* and for the next 90
   days of decisions; it doesn't have to be polished. (1 day.)
3. **Thursday–Friday: refresh `PLANNED.md`** with the next 90 days
   of work, prioritized against what the launch told you. Move
   defunct items to a "won't do" section. (1 day.)

### Don't do this week

- ❌ Ship anything that isn't a launch-week bug fix.
- ❌ Make license/monetization decisions based on launch feedback.
  PRODUCT_STRATEGY §3 stands; revisit after the next 90 days.

### Go/no-go gate

> **There's a clear, written 90-day plan. You are rested. Both.**

---

## Week 8 — back to the codebase

By now you should be back to normal development cadence, with one
important difference: there are *users* whose feedback you can pull
from. Every feature decision should now be testable against "do real
users want this?" instead of "do I think this would be cool?"

This week onwards is post-launch development. Out of scope for this
plan.

---

## Cross-cutting principles (re-read whenever you feel lost)

1. **Don't pre-build for problems you don't have.** No billing
   infra, no team-tier features, no marketplace, no fancy analytics
   dashboard. Those are problems you'll *earn* by having users.
2. **The local-first story is the moat.** Anything that compromises
   it (managed-key tier, hosted SaaS, central telemetry) costs you
   more than it adds — see PRODUCT_STRATEGY §2.3.
3. **Time-bound everything.** A bug that's been open 3 months is a
   feature decision; either fix it or close it. Open issues are not
   "tasks" — they're public obligations.
4. **One post per launch, not a campaign.** PMF doesn't come from
   reach; it comes from a small number of right people. A great Show
   HN with 80 comments beats a Twitter thread with 10K views.
5. **Korean *and* English from day 1.** Already done in the product
   (i18n). Do it for the launch too — the GeekNews post is not an
   afterthought. The "Korean local-first AI tool" angle is a
   distinct positioning win in KR where SaaS data flow is a real
   employer concern.

---

## What's deliberately *not* in this plan

| Topic | Where it lives |
|---|---|
| Licensing decision | `PRODUCT_STRATEGY.md` §1 |
| Monetization tier menu | `PRODUCT_STRATEGY.md` §3 |
| Regulatory analysis | `PRODUCT_STRATEGY.md` §4 |
| Feature roadmap | `PRODUCT_PLAN.md` (will be refreshed in week 7) |
| Desktop app port | `DESKTOP_APP_PLAN.md` (post-v0.1 work) |
| Trademark / incorporation | `PRODUCT_STRATEGY.md` §6 ("not deciding yet") |

---

## TL;DR for someone who wants the plan in 60 seconds

| Week | Theme | One sentence |
|---|---|---|
| 0 | Pre-flight | Answer audience + channel + demo questions. |
| 1 | Installable | A stranger can install + ask a question in 10 min. |
| 2 | Trustworthy | LICENSE, SECURITY, PRIVACY, CI green. |
| 3 | Launch artifact | The 2-min screencast + the launch post draft. |
| 4 | Soft launch | 5–10 personal DMs, fix what they bounce on. |
| 5 | Public launch | Show HN + GeekNews + r/LocalLLaMA in one week. |
| 6 | Momentum | Discord + good-first-issues only if engagement justifies. |
| 7 | Recovery | Rest, then write the 90-day plan from real data. |

**Start today with one thing:** the LICENSE file (week 1, item 1).
30 minutes. Everything else follows from that being in place.
