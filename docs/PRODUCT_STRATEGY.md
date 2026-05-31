# Product Strategy — licensing, IP/data sovereignty, monetization, regulation

> **⚠️ Superseded for product definition by [`PRODUCT.md`](PRODUCT.md).**
> Kept for the business/legal/regulatory rationale. Note: its §1.3 AGPL+
> commercial licensing recommendation is **dead** — the repo ships **MIT**
> (PRODUCT.md §6). Read this only for the data-sovereignty argument and
> the local-first invariants, not for "what the product is."

This is the strategy memo from the **lawyer / license / PM** angle. It
picks up where [`POSITIONING.md`](POSITIONING.md) §8 ("open positioning
questions") punted, and gives Ariadne a defensible, *legible* shape for
the next 12–18 months of decisions.

Not legal advice. Written so a lawyer or a PM can read it and arrive at
the same operational conclusion without needing the other to translate.

**Audience:** the founder/maintainer (kwanhokim), prospective
contributors, prospective design partners.

**Status:** draft v1. Anything labeled **DECIDE** below is an open
question that this doc takes a position on but does not commit code on.

> ## Update — §1 licensing recommendation superseded
>
> The §1 recommendation below is **AGPL-3.0 + commercial dual license**.
> After a launch-readiness review (see [`docs/LAUNCH_PLAN.md`](LAUNCH_PLAN.md)
> + reviewer notes in the project conversation), the decision was
> **flipped to plain MIT** for v0.1. The repo now ships [`LICENSE`](../LICENSE)
> as MIT.
>
> **Why the flip:** AGPL deters hosted-SaaS clones but also deters the
> contributors and enterprise users we actually want in the first year.
> The reviewer's case ('the bet you should make is kernel positioning +
> stars + ecosystem; monetize via packaging, marketplace, support,
> managed setup, not via core-license restriction') is the stronger
> argument *now* given (a) no evidence of imminent SaaS cloning, (b)
> the local-first shape already forecloses most "AWS forks it"
> scenarios, and (c) the "your data never leaves your machine" story
> is more credible under an OSI-approved permissive license.
>
> The §1 analysis below is preserved as the alternative reasoning —
> we may revisit if a real hosted-clone competitor appears, at which
> point a v2.0 relicensing decision (only-feasible-because contributors
> sign DCO, not a CLA) becomes available. AGPL → MIT was one-way easy;
> MIT → AGPL is one-way hard, so this is a real bet, not a hedge.

---

## 0. The product's legally relevant shape

Before any license/monetization analysis, what matters legally about
Ariadne is *what it actually is*. Five facts drive every recommendation
below:

1. **Local-first by construction.** User files live on the user's
   machine. The server is a Node process the user starts; the SQLite DB,
   index, and `.ariadne/staged/` directory all sit on local disk. The
   Cloudflare tunnel exposes *that local instance* to the user's other
   devices — it is not a multi-tenant service.
2. **AI calls are user-owned.** API keys are pasted into the user's
   own `.env` and used to call the user's own provider account
   (Anthropic, OpenAI, Gemini, Moonshot/Kimi, Ollama). We do not
   intermediate. We are not a "processor" in GDPR/PIPA terms because we
   do not host the personal data — we hand the user the keys to their
   own toolbox.
3. **No telemetry.** No analytics, no crash reports, no usage
   beacons. (As of `main@68029a4`. If this ever changes, it must be
   opt-in and disclosed in the README — see §4.3.)
4. **Staged-diff invariant.** AI never writes user files directly. All
   edits go to `.ariadne/staged/` and require a human "Apply" click.
   This is a *legal* property as much as a UX one — it constrains
   liability exposure (see §4.2).
5. **Eval-case promotion is a product moat, not a legal one.** The
   "measurably better" promise is delivered by promoting bad answers to
   eval cases. The eval cases are stored locally per user — *we do not
   collect them centrally*. The moat is the system + the dataset shape,
   not the data itself.

Anyone proposing changes that break (1)–(4) is taking on legal risk
this doc does not cover. Re-read this section before doing so.

---

## 1. Licensing — the central decision

POSITIONING.md §8.2: "Lean MIT for v0.1, revisit if a clone emerges."
This memo argues that's a reasonable *interim* position but the wrong
permanent one for an AI-adjacent local-first product. Concretely:

### 1.1 The four candidate licenses

| License | What it forces a redistributor to do | Effect on a hosted clone |
|---|---|---|
| **MIT / Apache-2.0** | Keep the copyright notice. That's it. | Cloner can take the code, host a SaaS version, never share their changes back. (See: Redis → AWS ElastiCache, Elasticsearch → OpenSearch.) |
| **AGPL-3.0** | If they *host* the modified code as a service to others, they must release their modifications under AGPL. | A cloner who hosts a SaaS must open-source their fork. Enterprises with strict "no GPL in our stack" policies will refuse. |
| **SSPL / BSL** | Source available; commercial use or hosting requires a license. Not OSI-approved. | Strongest cloner deterrent. Cannot be called "open source" by OSI definition; some communities will boycott. |
| **Dual: AGPL + commercial** | Same as AGPL for free use; commercial license available for buyers who can't accept AGPL terms. | Cloner choice: open-source their fork, or pay. Common monetization wedge (MongoDB, Sentry pre-2019, MariaDB MaxScale). |

### 1.2 Applied to Ariadne specifically

Three Ariadne-specific facts shift the calculus from "default to MIT":

- **The hosted-SaaS-clone risk is real but constrained.** Ariadne is
  designed to run on the user's own machine. A SaaS clone would have to
  add multi-tenancy, shared storage, auth, billing — basically build a
  different product. The clone risk is closer to "someone repackages
  Ariadne Desktop with a different name" than "AWS forks it."
- **Bundling the model API key is the actual monetization wedge.** The
  thing a paying user wants is *not* the source — it's bring-your-own-key
  hassle gone. A managed-key tier (see §3.2) does not require restrictive
  licensing to defend.
- **MCP / hooks / actions are an ecosystem play.** We want third parties
  to write MCP servers, hooks, action templates. AGPL on the *core* +
  permissive on the *ecosystem packages* is the standard playbook here
  (cf. WordPress GPL core, MIT plugins).

### 1.3 **DECIDE: dual license, AGPL-3.0 + commercial, with permissive ecosystem packages**

**Recommendation:**

- **Core repo** (this monorepo, `apps/server`, `apps/web`, `apps/admin`,
  `packages/shared`): **AGPL-3.0**.
- **Ecosystem packages** when they exist (future `@ariadne/mcp-*`,
  `@ariadne/skills-*`, `@ariadne/template-*`, the Tauri shell from
  `DESKTOP_APP_PLAN.md`): **MIT** or **Apache-2.0**.
- **Commercial license** available on request, no public price list
  until there's evidence of demand (do not pre-build a billing system).

**Why this shape:**

- AGPL deters a hosted-SaaS clone without us having to police anything.
- The "release your modifications" requirement is exactly what we want
  from a fork — if someone builds a better Ariadne, we want to see it.
- The permissive ecosystem packages remove friction for enterprises who
  *can't* depend on AGPL but want to write an internal MCP server or
  template — they can do so freely.
- A commercial dual-license option keeps the door open for "we love it
  but legal won't sign AGPL" deals without forcing us to pick now.

**What this requires before shipping:**

1. Add `LICENSE` file at repo root (AGPL-3.0 full text from
   <https://www.gnu.org/licenses/agpl-3.0.txt>).
2. Add SPDX header `// SPDX-License-Identifier: AGPL-3.0-only` to a
   sample of source files (linting can enforce later — don't gate v0.1
   on it).
3. Add `license` field to `package.json`: `"license": "AGPL-3.0-only"`.
4. Add a `CONTRIBUTING.md` with a one-paragraph DCO-style sign-off
   (`Signed-off-by:`) so contributors implicitly consent to AGPL.
   Don't use a CLA — those scare contributors and we don't need
   relicensing rights yet.
5. Document the dual-license offer in README: "Need a commercial
   license? Email …"

**Risks of this choice:**

- AGPL adoption is lower than MIT in some communities (especially the
  enterprise/JS ecosystem). For an early project chasing contributors,
  this is real friction.
- If we later want to switch to a more permissive license, every
  contributor must sign off (or we re-implement their contributions).
  This is why CONTRIBUTING.md should use DCO not CLA — we're not
  optimising for future relicensing, we're optimising for the *current*
  AGPL choice.
- If a commercial license request comes in tomorrow, we have nothing to
  offer. That's fine — say "let's talk" and price it case-by-case.

**Reversibility:** AGPL → MIT is *one-way easy* (we own the copyright
if all contributors signed DCO; we can dual-release new versions under
both). MIT → AGPL is *one-way hard* (already-distributed MIT copies
remain MIT forever). This asymmetry is a second reason to start
restrictive.

### 1.4 What the v0.1 → v1.0 sequence looks like

| Version | License state | Trigger to advance |
|---|---|---|
| v0.1 (now) | Repo has no LICENSE — implicitly **all rights reserved**, undistributable. | DECIDE the license. |
| v0.1.1 | AGPL-3.0 added. Sample SPDX headers. CONTRIBUTING.md with DCO. | First external contribution. |
| v0.2 | First permissive ecosystem package (e.g., `@ariadne/mcp-postgres`) released under MIT. | First MCP server contributed externally. |
| v0.3+ | Public commercial license terms posted, if/when demand materializes. | First paying customer or design partner asks. |

---

## 2. IP and data sovereignty — the legal narrative

The story that lets a legal-conservative buyer (university research
office, healthcare team, EU public sector, Korean fintech) say yes:

> "Your files never leave your machine. Ariadne is a process you run
> locally. The AI calls are made with *your* API key against *your*
> provider account. We can't see your data because we have no servers
> that touch it. The vendor relationship with Anthropic/OpenAI/etc. is
> directly between you and them, governed by *their* DPA, not ours.
> Cloudflare carries traffic but cannot read the contents (TLS, plus
> our cookie auth)."

This is unusually clean for an AI product, and is the most defensible
piece of strategic real estate Ariadne owns. Implications:

### 2.1 Compliance posture by user category

| User category | What they need from us | What we provide today | Gap |
|---|---|---|---|
| **Solo dev / researcher** | Nothing formal. | Everything. | None. |
| **Small team (≤5)** | Maybe a 1-pager "how data flows" they can show their CTO. | Architecture doc + this strategy doc. | A "Security one-pager" PDF (§5.1). |
| **University / academic** | Statement that no student data is uploaded; eval evidence of safety cases. | Local-first, RAG_HARNESS safety cases. | None — *write this up* in a "For academic use" section of POSITIONING. |
| **Healthcare / legal / regulated SMB** | DPA (Data Processing Agreement) from us, or proof we're not a processor. | We are *not a processor* — see argument below. | A 1-page legal memo making this argument, signable. |
| **EU enterprise** | AI Act risk classification, GDPR Art. 28 processor DPA, transparency record-keeping. | We are likely **GPAI consumer**, not provider; see §4.1. | Public AI-Act compliance statement (§4.1.4). |
| **Korean enterprise** | PIPA Article 26 outsourcing terms if we touch personal info; localization claim if it's about "Korean AI." | We do not touch the personal info. | PIPA-specific FAQ; consider Korean-language version. |

### 2.2 The "not a processor" argument

A GDPR/PIPA *processor* is an entity that processes personal data on
behalf of a controller. Ariadne does not host, store, or transmit user
files to any server we operate. The user's files sit on the user's disk;
the AI call goes from the user's machine *directly* to the model
provider's API. The Cloudflare tunnel carries the user's web traffic to
the user's own server.

→ We are closer to a **software vendor** (like Microsoft selling Excel)
than a **processor** (like AWS hosting your customer database).

This needs to survive lawyer scrutiny — there are edge cases (the
account context extractor stores a profile string in our local DB; the
chat history is in our SQLite). But because all of that lives on the
user's own disk, *we* aren't processing anything — the user is.

The legal-memo task (§5.1) should make this argument formally so a
buyer's legal team can review it without having to invent it.

### 2.3 What breaks this story

- Any hosted-by-us feature (managed key tier — §3.2 — is the obvious
  candidate). The moment we touch user data on our servers, we *become*
  a processor and inherit Article 28 obligations.
- Any telemetry/analytics, even anonymized.
- Any "marketplace" where templates are submitted to us for review and
  re-distribution — that crosses into "we host user-generated content"
  and brings DMCA / takedown / moderation duties.

The strategic implication is that **monetization paths that preserve
the local-first story are far cheaper to operate** than paths that
break it. §3 ranks accordingly.

---

## 3. Monetization paths — ranked by legal/operational friction

POSITIONING §8.1 punts on this: "Defer until the desktop app ships."
This memo agrees with the timing but takes a position on the *menu*.

Five candidate paths, ranked low-to-high friction:

### 3.1 **Supporter tier (donations / Patreon / GitHub Sponsors)** — Tier 1

- **Legal friction:** Zero. No new entity, no DPA, no payment data
  handling on our side.
- **Operational friction:** Low. Set up a sponsors page; thank
  publicly.
- **Revenue ceiling:** Low. Few projects sustain a single FT
  engineer on sponsors alone (notable exceptions: tailwindcss-pre-v3,
  some Rust crates).
- **Recommendation:** Enable at v0.2. Frame as "if Ariadne saved you
  time, fuel the next version." Don't expect more than $X/mo for a long
  time — but the *signal* of paid users matters for the next steps.

### 3.2 **Managed API key tier ("hosted Kimi / Claude / GPT credits")** — Tier 2

User pays us a flat monthly fee; we pre-pay provider credits and they
get a single key to paste. No file data leaves their machine; we are
only a billing/credit pass-through.

- **Legal friction:** Medium. We become a *reseller* of provider API
  services. Need to read provider TOS (esp. Anthropic's, OpenAI's —
  reselling is sometimes restricted or requires special agreements).
- **Operational friction:** Medium. We hold a balance sheet of pre-paid
  credits, need usage metering, refunds, fraud handling. Stripe is fine
  for billing.
- **Revenue ceiling:** Medium-high. Realistic recurring revenue per
  user is $5–$50/mo with margin in the 10–30% range — not a venture
  business but a real lifestyle one at scale.
- **Critical:** *user files still do not touch our servers*. We only
  intermediate the API call's auth token. This preserves the §2
  story almost intact (we move from "pure vendor" to "vendor + payment
  intermediary," not "processor").
- **Recommendation:** Defer until (a) v1.0 ships, (b) ≥100 active
  installs, (c) provider TOS reviewed. Probably 6–12 months out.

### 3.3 **Dual-license commercial sales** — Tier 2

Enterprise buyer says "we want Ariadne but our legal won't accept AGPL
on internal forks." We sell them a commercial license, priced per
seat-year or flat-org.

- **Legal friction:** Low — this is exactly what dual-licensing
  *enables*. Need a commercial-license template (Sentry's pre-2019
  license is a good public template).
- **Operational friction:** Low at the start (case-by-case), high if it
  becomes a sales motion. Stay case-by-case until ≥10 inquiries.
- **Revenue ceiling:** Highly variable. One enterprise contract can be
  $10K–$100K/yr. Few buyers will sign; the ones who do are sticky.
- **Recommendation:** Make the *offer* visible in README ("commercial
  license available, email maintainer") at v0.1.1. Don't build sales
  infrastructure.

### 3.4 **Hosted-Ariadne-for-teams (multi-tenant SaaS)** — Tier 3

The "obvious" SaaS shape — let teams sign up, host their workspaces in
our cloud, charge per seat.

- **Legal friction:** **High.** Becomes a processor under GDPR, needs
  DPAs, possibly EU-resident hosting (Schrems II), AI Act provider
  obligations if we tune anything, SOC2 expectations from enterprise
  buyers.
- **Operational friction:** High. New ops team, on-call, security
  audits, multi-tenant data isolation, abuse handling.
- **Revenue ceiling:** Highest in theory, but only at a scale that's
  unrealistic for ≥18 months given the local-first DNA.
- **Recommendation:** **Avoid.** This is the path POSITIONING §2.3
  explicitly rules out. The dual-license route (3.3) gives enterprise
  buyers what they need without us becoming a SaaS provider.

### 3.5 **Template / skill marketplace with revenue share** — Tier 3

Third parties publish action templates / skills / MCP configs; we host
the registry, take a cut.

- **Legal friction:** Medium-high. Becomes "we host user-generated
  content" → DMCA, takedown duties, content moderation, possibly
  consumer-rights obligations on the marketplace side.
- **Operational friction:** Medium-high.
- **Revenue ceiling:** Famously hard — the Cursor/VSCode/Obsidian
  marketplaces all under-monetize relative to the host platform.
- **Recommendation:** **Defer indefinitely.** A *free* package registry
  on GitHub (npm tags, GitHub Topics) gives the ecosystem effect
  without the legal weight. Revisit only if there's clear demand for
  paid templates.

### 3.6 Tier summary

| Tier | Path | Build-by | Defensible margin |
|---|---|---|---|
| 1 | Supporter (3.1) | v0.2 | Low / signal-only |
| 2 | Dual-license commercial (3.3) | v0.1.1 (offer); v0.5 (template) | Medium / per-deal |
| 2 | Managed API key (3.2) | v1.0+ | Medium / recurring |
| 3 | SaaS (3.4) | **don't** | High but wrong shape |
| 3 | Marketplace (3.5) | **defer indefinitely** | Low / high ops cost |

---

## 4. Regulatory landscape

### 4.1 EU AI Act

Status: Regulation (EU) 2024/1689, in force since Aug 2024, with
staggered application dates. The risk-class system applies to *AI
systems*; the GPAI (general-purpose AI) chapter applies to *foundation
models*.

**Ariadne's classification:**

- We are **not a provider of a GPAI model.** We integrate third-party
  models (Anthropic, OpenAI, etc.). The provider obligations
  (model documentation, training-data disclosure, copyright policy)
  sit on those providers.
- We are a **deployer of an AI system** in the AI Act sense —
  specifically, a *high-utility, low-risk* system. We do not operate in
  any of the Annex III high-risk categories (biometric ID, critical
  infrastructure, education access, employment selection, essential
  services, law enforcement, migration, justice, democratic process)
  unless the *user* uses Ariadne for one of those tasks. If they do,
  *they* take on the deployer obligations — we should disclose this
  expectation in our docs.
- The **transparency obligations** (Art. 50) require that users of an
  AI system know they're interacting with one and that AI-generated
  content is labeled. Ariadne's UI already shows model name + provider
  on every response — that satisfies the spirit.

**Actions:**

1. Add a short "AI Act statement" to README (or a `docs/AI_ACT.md`):
   - Ariadne is not a GPAI provider.
   - Ariadne is not classified as high-risk under Annex III by default.
   - The user is the *deployer* if they use Ariadne in a high-risk
     context, and they take on the corresponding obligations.
   - All AI-generated content in the UI is labeled with the originating
     model + provider.
2. Maintain a `provenance` field in chat messages (already present —
   `provider` + `model`). This is the audit trail.
3. **DECIDE:** if/when we ship the desktop app (`DESKTOP_APP_PLAN.md`),
   consider whether the bundled installer makes any AI-Act labeling
   claims on our behalf. Keep claims minimal.

### 4.2 Liability — the staged-diff invariant pays for itself

§0(4): "AI never writes user files directly. All edits go to
`.ariadne/staged/` and require a human Apply click."

This is a **liability shield**. If an AI suggestion deletes the wrong
file or breaks code, the user clicked Apply — they own the action. We
provide the suggestion + the diff view; they review and accept.

This pattern is well-precedented (GitHub Copilot's accept-line model,
git's staging area, every IDE's "preview diff before commit"). The
courts have not produced a doctrine specific to AI-suggested edits, but
the "informed human in the loop" framing is the safest known posture.

**Actions:**

1. Keep the staged-diff invariant. Treat it as load-bearing.
2. Make sure the Apply button shows the diff clearly — not buried under
   tabs. (UI: today's `AttemptDiffView` is good.)
3. Add to the future Terms of Use: "All file modifications are applied
   only at your explicit confirmation. You are responsible for
   reviewing diffs before applying."

### 4.3 GDPR / PIPA

The §2.2 "not a processor" argument means GDPR Article 28 obligations
(processor DPA, sub-processor disclosure, audit rights, security
measures) do not apply to *us*. But two narrower points:

- **Our website / repo / docs** (if we publish anything that collects
  personal data — a sponsors page, a contact form) is a normal GDPR
  surface and needs the usual cookie/privacy basics.
- **Korean PIPA Article 26** governs outsourced processing of personal
  information. Same argument — if we're not processing on the user's
  behalf, Article 26 doesn't trigger. Korean enterprise buyers are more
  used to *demanding* signed outsourcing terms than EU ones; a 1-page
  PIPA-specific FAQ removes the friction.

**Actions:**

1. Do not add analytics/telemetry. If we ever do, opt-in only, with a
   plain-language disclosure in the install flow.
2. Write a `docs/PRIVACY.md` (~1 page) covering both GDPR and PIPA in
   parallel. Translate to Korean.
3. The `accountContext` extractor — which stores a free-text "who am I"
   profile in the user's local DB — should have a clear opt-out in
   settings. (As of today: it's auto-extracted; the user can edit/clear
   it but the *extraction* is not opt-out.) Consider gating extraction
   on first-run consent.

### 4.4 Provider TOS

Each model provider has terms governing how we can use their API. The
ones that matter for Ariadne:

| Provider | What to watch |
|---|---|
| Anthropic | Cannot use API output to train competing models. Cannot reverse-engineer Claude. Reseller (§3.2) requires distinct agreement. |
| OpenAI | Same prohibitions. Plus: data submitted to API is *not* used for training by default (opt-in for the user's account). |
| Google (Gemini) | Per-region terms; data residency claims; cannot use for restricted use cases (e.g., medical advice). |
| Moonshot / Kimi | Less mature. Two endpoints (`api.moonshot.ai` international, `api.moonshot.cn` China-platform Kimi) have different terms — China-platform may have export-control implications for users outside CN. |
| Ollama | Local model — runs entirely on user's machine. Terms are model-specific (Llama, Qwen, etc., each carry their own license). |

**Actions:**

1. Add a `docs/MODEL_PROVIDERS.md` summarizing each provider's data
   handling claim in 1 line, with a link to their docs.
2. For the Moonshot/Kimi case specifically (which we just fixed in
   commit `57d36c9`): document the prefix-based routing and note that
   users outside China who hold an `ak-` key are talking to a
   China-platform service — this has implications for some employers.

---

## 5. Concrete next steps (prioritized)

Each item is one PR's worth of work. None of them touch product code
unless noted.

1. **Add LICENSE file + SPDX headers + package.json license field.**
   AGPL-3.0. (§1.3.) — 1 hour.
2. **Write `CONTRIBUTING.md` with DCO sign-off.** (§1.3.) — 1 hour.
3. **Write "Security & data flow one-pager"** (`docs/SECURITY.md`).
   For the small-team / academic / regulated SMB use case. Cover §0
   and §2 in a buyer-readable format. — 2 hours.
4. **Write `docs/PRIVACY.md`** (EN + KO). GDPR + PIPA + the
   "not-a-processor" argument made formally. — 2 hours.
5. **Write `docs/AI_ACT.md`.** Short — see §4.1 actions. — 1 hour.
6. **Write `docs/MODEL_PROVIDERS.md`.** Per-provider TOS summary. — 1
   hour.
7. **README updates:**
   - Add license badge (AGPL-3.0).
   - Add "Commercial license? Email …" line.
   - Add link to SECURITY.md and PRIVACY.md.
   — 30 minutes.
8. **Gate `accountContext` extraction on first-run consent.** This is
   the only product-code change in this list. The current behavior is
   benign but the *principle* matters. — 2 hours.
9. **Add "Sponsors" link** (after v0.2 ships, not v0.1.1). — 30 min.
10. **Set up `commercial@ariadne.dev` or similar inbox** for
    license/sales inquiries. (Not strictly needed — `kwanhokim@gmail` is
    fine — but a dedicated address makes it look more like a real
    product to enterprise buyers.) — 15 min.

Total: ~12 hours of writing + 2 hours of code, mostly one-and-done.

---

## 6. What this doc does **not** decide

- **Whether to incorporate.** No revenue, no payroll, no inventory →
  no need today. When tier-2 monetization (§3.2 or §3.3) actually
  ships, revisit.
- **Trademark on "Ariadne."** The name is unprotected today. The
  Greek mythological figure is unregistrable as a single word in most
  classes, but a logo + stylization is. Defer until there's something
  worth defending — i.e., a paying user.
- **Korean / EU / US entity for tax purposes.** Same — defer until
  there's revenue.
- **Open governance / foundation move.** Premature. Single-maintainer
  is fine; codify governance only if/when there are ≥3 active
  contributors.

---

## 7. References

- [`docs/POSITIONING.md`](POSITIONING.md) — what Ariadne is. This doc
  picks up §8 ("open questions").
- [`docs/PRODUCT_PLAN.md`](PRODUCT_PLAN.md) — feature roadmap.
- [`docs/DESKTOP_APP_PLAN.md`](DESKTOP_APP_PLAN.md) — Tauri shell.
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — the local-first runtime
  this strategy is built on.
- [`docs/API.md`](API.md) — server endpoints (the surface a SaaS
  cloner would replicate).
- AGPL-3.0 text — <https://www.gnu.org/licenses/agpl-3.0.txt>
- EU AI Act — Regulation (EU) 2024/1689,
  <https://eur-lex.europa.eu/eli/reg/2024/1689/oj>
- GDPR Art. 28 (processors) — <https://gdpr-info.eu/art-28-gdpr/>
- PIPA Art. 26 (outsourcing) —
  <https://www.law.go.kr/lsInfoP.do?efYd=20240315&lsiSeq=247514>
- DCO (Developer Certificate of Origin) —
  <https://developercertificate.org/>
