# Portfolio Starter v2 — multi-account workspace + 3-tier analysis architecture

The current `Investment portfolio` starter (one `holdings.csv` + a
multi-currency FX dashboard) is a **good demo of surfaces**. It is
**not** a faithful model of how someone actually holds and reasons
about a real portfolio.

A real portfolio looks more like:

- **Multiple accounts**, with different rules:
  - Tax-advantaged buckets (KR ISA — 20M KRW/year ETF cap; US Roth;
    EU ELI-PEA) where you want certain asset classes routed
    *first*.
  - Standard brokerage accounts (no tax shield).
  - Foreign-resident brokerage accounts (subject to closure / transfer
    rules — e.g. Revolute closing in a region by date X).
  - Bank cash + savings boxes ("idle money").
- **Mixed asset classes** in each: KR/US/EU equities, ETFs, commodities
  (gold/silver), crypto, robot-advisor funds, bonds.
- **Operational urgencies** that aren't visible in a holdings table:
  - "Account X closes in 30 days — migrate or liquidate"
  - "ISA quota only Y/20M used — route next ETF buy here"
  - "Z million sitting in low-yield savings — reallocate?"
  - "Position W down 70% — review thesis or take loss"
- **Analysis you maintain**, not just numbers you watch:
  - **Macro**: Fed cycle, ECB cycle, KR rate path, USD/EUR/KRW
    trend, geopolitics, tech-cycle phase.
  - **Meso**: sector outlook (AI infra, defense, bio, energy, etc.),
    country/region exposure, currency hedge thesis.
  - **Micro**: per-position thesis (why I bought), target price,
    stop-loss, time horizon, last review date.

The v1 starter handles **none of the operational urgency layer** and
collapses the analysis into a single monthly macro brief. v2 redesigns
the starter around the actual shape.

This document is the **architecture** — file shapes, surface sections,
action templates, hook triggers. Implementation lands in subsequent
batches; this doc is the spec.

> **Privacy note**: every example value in this doc and the seeded
> starter files is **anonymized / illustrative** (e.g. `AAPL`, `MSFT`,
> `BROKER_A`, `BANK_X`). Real portfolio data lives on the user's
> machine, never in the repo, never in any AI provider's training
> set. The starter is a *schema*, not a leak vector.

> **Scope boundary**: Ariadne does *not* give investment advice. The
> portfolio starter produces **analysis structure** (where you stand,
> what you said your thesis was, what news affects your stated
> exposure). It does **not** generate buy/sell recommendations.
> Target prices, stop losses, and theses are **user-entered fields**,
> not AI-generated values. The macro/meso/micro brief actions
> summarise public information against your *user-entered* thesis —
> never substitute their own.

---

## 1. New file layout

```
<workspace-root>/
├── accounts/
│   ├── _index.yaml                  # account metadata (type, currency, rules, status)
│   └── README.md                    # what each account is, when, why
├── positions/
│   ├── current.csv                  # everything you currently hold
│   ├── watchlist.csv                # tracked but not held
│   └── closed.csv                   # exited positions (for backtest of own decisions)
├── cash/
│   └── _index.yaml                  # idle / savings / emergency-fund positions
├── analysis/
│   ├── macro/
│   │   └── YYYY-MM.md               # monthly macro notes (your thesis, not AI's)
│   ├── meso/
│   │   ├── sectors-YYYY-Qn.md       # quarterly sector reviews
│   │   └── regions-YYYY-Qn.md       # quarterly region/currency reviews
│   └── micro/
│       └── <ticker>.md              # per-position thesis, target, exit criteria
├── goals/
│   └── YYYY-allocation.md           # annual target allocation + rebalance schedule
├── briefs/
│   └── YYYY-MM-DD-{kind}.md         # action-template output archive
└── .ariadne/
    ├── actions.yaml                 # the action templates (see §4)
    ├── hooks.yaml                   # post-apply triggers (see §5)
    └── surface.tsx                  # the dashboard (see §3)
```

### 1.1 `accounts/_index.yaml`

The account list with rules / urgency metadata. Schema:

```yaml
accounts:
  - id: broker_a_isa
    label: "Broker A — ISA (tax-advantaged)"
    type: brokerage
    currency: KRW
    tax_advantaged: true
    annual_cap_currency: KRW
    annual_cap_amount: 20000000
    annual_cap_used: 0           # the user maintains this; surface shows delta
    preferred_asset_classes: [ETF]   # surface hints when buying outside this
    notes: "ETF purchases routed here first to use the tax-shield."

  - id: broker_a_std
    label: "Broker A — Standard"
    type: brokerage
    currency: KRW

  - id: broker_b
    label: "Broker B"
    type: brokerage
    currency: KRW

  - id: foreign_a
    label: "Foreign Broker A"
    type: brokerage
    currency: MIXED                 # EUR + USD
    status: closing
    closing_date: 2026-06-30
    closing_action_required: true
    closing_options:
      - migrate_to: broker_b_eu
        cost: "USD 35 per position"
      - liquidate_and_repatriate
    notes: "Resident-eligibility issue — must decide before 2026-06-30."

  - id: foreign_b
    label: "Foreign Broker B (mobile-only)"
    type: brokerage
    currency: EUR

  - id: bank_a_savebox
    label: "Bank A — SaveBox (Idle)"
    type: cash
    currency: KRW
    is_idle: true                    # surface flags this with a yellow strip

  - id: bank_b
    label: "Bank B (Idle)"
    type: cash
    currency: KRW
    is_idle: true
```

### 1.2 `positions/current.csv`

Extends the v1 `holdings.csv` with **account binding** and **thesis
metadata**:

```csv
account_id,symbol,name,asset_class,sector,currency,shares,buy_price,current_price,target_price,stop_loss,thesis_id,horizon_months,confidence,last_reviewed
broker_a_isa,SPY,SPDR S&P 500 ETF,ETF,분산투자,USD,10,617.00,686.00,740.00,,SPY-2026-01,60,medium,2026-04-15
broker_a_std,AAPL,Apple Inc.,주식,기술,USD,40,271.00,309.00,345.00,250.00,AAPL-2026-01,24,medium,2026-04-12
broker_b,005930,Samsung Electronics,주식,기술,KRW,200,261000,292500,330000,250000,005930-2026-01,12,low,2026-03-21
foreign_a,NVDA,NVIDIA Corp.,주식,기술,USD,3,176.00,215.00,260.00,180.00,NVDA-2026-01,18,high,2026-04-29
```

Each `thesis_id` resolves to `analysis/micro/<thesis_id>.md`. Empty
`target_price` / `stop_loss` is allowed — surface flags positions that
have neither as "needs review".

### 1.3 `positions/watchlist.csv`

Same schema minus shares + buy_price. Used by the macro brief to ask
*"is the conviction-trigger you wrote down still missing, or is it
time to start a position?"*.

### 1.4 `cash/_index.yaml`

```yaml
buckets:
  - id: bank_a_savebox
    label: "Bank A SaveBox"
    currency: KRW
    amount: 0                  # user-maintained
    apr: 2.5
    is_emergency_fund: false
    target_amount: 0
    notes: "Sitting at 0% real return after inflation."

  - id: bank_b_checking
    label: "Bank B Checking"
    currency: KRW
    amount: 0
    apr: 0.1
    is_emergency_fund: true
    target_amount: 6000000     # 3-month living expenses

  - id: broker_a_deposit
    label: "Broker A — Uninvested cash"
    currency: KRW
    amount: 0
    apr: 0
    is_emergency_fund: false
```

### 1.5 `analysis/micro/<thesis_id>.md` (per-position thesis)

A user-maintained file. The action templates **summarise news against
this**, never rewrite it. Suggested skeleton:

```markdown
# AAPL-2026-01 — Apple thesis (opened 2026-01-12)

## Why I bought
- Services revenue >25% of total, growing
- Vision Pro adoption curve uncertain but cheap-tail-option priced in
- Buyback support floor near $250

## What would change my mind (exit triggers)
- Services growth deceleration below 10% YoY for 2 consecutive quarters
- Margin compression on Mac/iPad below 35% gross
- China revenue continues -15% YoY beyond 2026-Q2

## Target / stop
- Target: $345 (12-month, ~13% from buy)
- Stop loss: $250 (8% below cost basis)
- Time horizon: 24 months

## Review log
- 2026-04-12 — Services beat by 4%; thesis intact
- 2026-03-08 — China weakness disclosed; within tolerance
```

The micro file is the **anchor** for every per-position action — the AI
reads it for context, never overwrites it.

---

## 2. The 3-tier analysis flow

```
MACRO  (monthly, user-driven)
  ↓ analysis/macro/YYYY-MM.md
  ↓ "Fed-cut path / KR rate / USD trend / geopolitics / tech cycle"
  ↓
MESO   (quarterly, user-driven, AI-assisted)
  ↓ analysis/meso/sectors-YYYY-Qn.md
  ↓ "Given the macro, which sectors over/under-weighted from my mix?"
  ↓
MICRO  (per-trigger, user-driven)
  ↓ analysis/micro/<thesis_id>.md
  ↓ "Has anything in this position's thesis broken?"
```

Each level **flows down** but never **dictates** the next. The macro
brief informs which sector reviews you do this quarter; the sector
review informs which micro positions you reconsider this month; the
micro review informs (sometimes) a buy/sell **decision**, which lives
in a separate `decisions/` folder (see §6).

Importantly, **none of the three levels is the AI's job alone**. The
AI:

- Pulls and summarises news / data sources you point it at.
- Compares your *stated* thesis against new information.
- Highlights **gaps and contradictions**.
- Drafts a structured brief you then edit.

The AI does **not**:

- Decide allocation.
- Predict market direction.
- Generate target prices or stop losses you didn't supply.
- Recommend buys / sells.

---

## 3. Surface dashboard sections

`.ariadne/surface.tsx` now renders **six** sections, stacked:

### 3.1 Top action strip (always visible)

A horizontal row of action cards, sorted by urgency:

- 🚨 **Closing accounts** — pulled from `accounts/_index.yaml`
  `status: closing` + `closing_date` minus today. Renders as
  *"Foreign Broker A — closes in 35 days. Migrate or liquidate."*
- 💰 **Tax-advantaged quota** — for each `tax_advantaged: true`
  account, *"ISA: 2.5M / 20M used (12.5%)"*.
- 💤 **Idle cash flagger** — sum of `cash/_index.yaml` entries with
  `is_idle: true`, formatted in the reporting currency. *"Total
  idle: ₩40.4M (4.3% of net worth)"*.
- ⚠️ **Stale theses** — count of `positions/current.csv` rows where
  `last_reviewed` > 90 days ago.
- 📅 **Scheduled reviews due** — pending macro/sector/position
  reviews per the schedule in `goals/YYYY-allocation.md`.

Each card is *clickable* and jumps to the matching action template.

### 3.2 Net-worth header

Single big number — total value in the reporting currency (per the
existing `fx_rates.csv`). Sub-row: split by account type
(brokerage / cash / commodity / crypto).

### 3.3 Allocation breakdown (tabbed)

Four breakdowns of the same money, tab-switched:

- **By asset class** — Stock / ETF / Bond / Commodity / Crypto /
  Cash
- **By currency** — KRW / USD / EUR (with FX-effect overlay)
- **By region** — Korea / US / EU / Global / Cash
- **By sector** — Tech / Defense / Bio / Energy / Financials /
  Consumer / etc.

Bar chart per tab. Hover a bar → list of positions feeding into it.

### 3.4 Accounts table

Rows are accounts, columns are: value (base ccy), positions, idle
cash, last activity, status flag. Click an account → that account's
holdings filtered in §3.5.

### 3.5 Positions table

Same as v1, but with extra columns:
- **Account** (filterable)
- **Thesis** (link → `analysis/micro/<thesis_id>.md`)
- **Target** (red if no target set)
- **Last reviewed** (red if > 90 days)
- **Conviction** (sortable)

### 3.6 Analysis sidebar

A right-side strip with links to current analysis files, grouped by
tier:

- Macro — `analysis/macro/2026-05.md` (current month)
- Meso — most-recent sector + region briefs
- Micro — micro reviews due this month (positions with
  `last_reviewed` > 90 days)

Each link opens the markdown editor inline (existing file editor).

---

## 4. Action templates (`.ariadne/actions.yaml`)

Five action templates replace the v1 pair. Each one writes to a
distinct output path so multiple runs don't collide.

### 4.1 `macro_brief_monthly`

Reads: `accounts/_index.yaml`, `positions/current.csv`, the previous
month's `analysis/macro/YYYY-MM.md`.

Pulls: month-windowed web search for Fed / ECB / BoK rate decisions,
inflation prints, major geopolitics.

Asks AI to draft a 4-section brief:

1. This month's macro events
2. **My portfolio's exposure to those events** (sector + currency
   breakdown vs the events; computed from `positions/current.csv` —
   AI cites numbers, doesn't invent them)
3. 3 risks to watch over the next 1–3 months
4. **Open questions** for the user to resolve (not recommendations
   — questions like *"Is the BoK rate path priced into your KRW
   exposure?"*)

Writes: `analysis/macro/{YYYY-MM}.md`.

### 4.2 `sector_review_quarterly`

Reads: latest `analysis/macro/`, `positions/current.csv` grouped by
sector.

Asks AI to draft a sector-by-sector outlook against the user's
stated macro view. For each sector the user has exposure to:

- What changed in the sector this quarter
- Which positions in this sector have stale theses
- What sector concentration looks like vs `goals/YYYY-allocation.md`

Writes: `analysis/meso/sectors-{YYYY-Qn}.md`.

### 4.3 `region_review_quarterly`

Same shape, but by region (KR / US / EU / Global). Includes
**currency** view since region and currency overlap heavily here.

Writes: `analysis/meso/regions-{YYYY-Qn}.md`.

### 4.4 `position_check` (per-ticker)

Reads: `analysis/micro/<thesis_id>.md`, recent news for the ticker,
the row in `positions/current.csv`.

Asks AI to evaluate:

- Which exit triggers in the thesis have moved?
- Which haven't?
- Has the price moved through any user-set target / stop?
- Time-horizon check: how far from purchase?

Writes: appends to the *Review log* section of
`analysis/micro/<thesis_id>.md`. Never overwrites the *Why I bought*
or *Exit triggers* sections.

### 4.5 `rebalance_audit`

Reads: `positions/current.csv`, `cash/_index.yaml`,
`goals/YYYY-allocation.md`.

Computes current vs target allocation (the user's target). Outputs:

- Current allocation table
- Target allocation table
- Gap table
- **Tax-advantaged routing hint** — if there's an ETF buy in the
  gap, where the ISA quota currently sits (read from
  `accounts/_index.yaml` → `annual_cap_used`).

Writes: `briefs/{YYYY-MM-DD}-rebalance.md`.

### 4.6 `account_closure_planner` (rare, fires for `status: closing`)

Reads: the closing account's positions, `closing_options`,
`closing_date`.

For each option (`migrate_to` / `liquidate_and_repatriate`),
asks AI to draft a checklist of operational steps + estimated cost.
Surfaces tax implications **as questions for the user / their
accountant**, not as answers.

Writes: `briefs/{YYYY-MM-DD}-closure-{account_id}.md`.

---

## 5. Hook triggers (`.ariadne/hooks.yaml`)

Optional automation. Examples:

```yaml
hooks:
  - id: log_review_date
    on: staged_edit_apply
    when: "path matches 'analysis/micro/*.md'"
    run: |
      # Bumps last_reviewed for the matching thesis_id in
      # positions/current.csv. Bash + awk; the user can swap in any
      # script.
      bash .ariadne/scripts/bump_review_date.sh "{{path}}"

  - id: monthly_macro_reminder
    on: schedule
    cron: "0 9 1 * *"   # 09:00 on the 1st of each month
    run: |
      # Fires the macro_brief_monthly action without prompting.
      ariadne action run macro_brief_monthly
```

These are **opt-in** — the starter ships them commented out so a
first-time user sees the shape without surprise automation.

---

## 6. Decisions folder (separate from analysis)

The `decisions/` folder is **not** in this starter v2 — it's a
follow-up. The shape:

```
decisions/
├── YYYY/
│   ├── 2026-01-12-buy-AAPL.md     # one file per decision
│   └── 2026-03-04-trim-NVDA.md
```

Each decision links to the analysis that led to it and the order
confirmation that executed it. This is the **paper trail** that
makes the eval-case promotion analogy work for portfolio reviews:
bad decisions become eval cases for next year's review.

The `Decisions log` starter (already shipping) covers the PRD/ADR
case; a portfolio-decisions surface would be a thin variant on top.

---

## 7. Implementation phasing

This is a meaningful redesign. Phasing into 3 PRs:

### Phase 1 — schema + seeds (this batch)

- New `portfolioStarter.ts` shipping the v2 file layout with
  **anonymized** illustrative data.
- New `.ariadne/actions.yaml` with the 5 + 1 templates.
- This doc lands.
- The surface stays v1-compatible (reads `holdings.csv` if present,
  shows a note pointing at v2 if `positions/current.csv` is present).

### Phase 2 — surface

- Surface reads the v2 layout.
- Top action strip + analysis sidebar implemented.
- Allocation breakdown gains tabs.

### Phase 3 — hooks + decisions folder

- Hook seeds enabled.
- `decisions/` folder added.
- Position-check action wired to bump `last_reviewed` automatically
  on apply.

Phase 1 is what AF1 (this commit) ships. Phases 2 and 3 land as
follow-ups in AF2 / AF3.

---

## 8. What this does *not* solve

Stated honestly so future work isn't misaimed:

- **No tax computation.** The starter tracks ISA quota usage but
  doesn't compute realized gains taxes, dividend taxes, or
  cross-border tax treaty effects. Those require jurisdiction-
  specific logic + are the user's accountant's job.
- **No live market data ingestion beyond the v1 quote SDK.** The
  same `postMessage` SDK that fetches FX + quotes today is what
  the v2 surface uses. Custom data sources (e.g. broker statement
  ingestion) are a separate plug-in shape, not part of this starter.
- **No trade execution.** Ariadne is *not* a brokerage UI. The
  action templates produce analysis briefs and operational
  checklists; the actual orders are placed by the user in their
  broker's app.
- **No prediction.** No price target generation, no "AI says buy".
  The starter is *for* the user's analysis, not *instead of*.

---

## 9. References

- [`docs/POSITIONING.md`](POSITIONING.md) §3 — the demo this fits
  (CSV folder → dashboard + monthly report)
- [`docs/PRODUCT_PLAN.md`](PRODUCT_PLAN.md) — custom surface
  architecture (`.ariadne/surface.tsx` + postMessage SDK)
- [`docs/DEMO_WORKSPACES.md`](DEMO_WORKSPACES.md) §Demo 2 — the
  recording target this starter has to satisfy
- [`apps/server/src/surface/portfolioStarter.ts`](../apps/server/src/surface/portfolioStarter.ts) — current v1
  starter (this doc supersedes)
