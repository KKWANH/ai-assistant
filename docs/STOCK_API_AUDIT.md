# Stock API audit — current capabilities, limits, and what to add

A reviewer asked: **"주식 api는 지금 버전으로 충분한가?"** This doc
answers it concretely against the actual portfolio shapes we now
support (per `docs/PORTFOLIO_STARTER_V2.md` + the real-data
workspace under `data/portfolio/`).

## TL;DR

**Yes for ~90% of cases. Not enough for ~10%.**

What works today (the `useAriadne()` surface SDK):

| Asset | Works? | Symbol format |
|---|---|---|
| US stocks (NYSE / NASDAQ) | ✅ | `AAPL`, `TSLA`, `BRK-B` (hyphen not dot) |
| US ETFs | ✅ | `SPY`, `VOO`, `QQQ` |
| KR stocks (KOSPI / KOSDAQ) | ✅ | `005930.KS`, `000660.KS`, `035420.KS` |
| KR ETFs | ✅ | `069500.KS`, `360750.KS`, `091230.KS` |
| EU stocks / ETFs (Euronext / Xetra / LSE) | ✅ | `ASML.AS`, `SAP.DE`, `VUSA.AS`, `SXRZ.DE` |
| Crypto | ✅ | `BTC-USD`, `ETH-USD` |
| Commodity ETFs (paper gold / silver ETFs) | ✅ | `GLD`, `SLV`, `411060.KS` |
| FX rates | ✅ | via `ariadne.getFxRates(base, currencies)` |

What does **not** work today (and won't, by design):

| Asset | Why | Workaround |
|---|---|---|
| Paper gold/silver inside a broker (no ticker) | E.g., "Revolute Gold XAU" — the broker shows oz holdings + EUR market value but isn't a tradable Yahoo symbol. | Track as `quote_source: manual` in `assets/precious_metals.yaml`; user maintains value. Surface uses `GC=F` / `SI=F` (Yahoo futures) only as a *reference price*, not for portfolio P&L. |
| Robo-advisor funds (no ticker, opaque NAV) | E.g., "Revolute Robot-Advisor fund Risk 2/5" — single-vehicle fund with no public symbol. | Track as `quote_source: manual` in `assets/funds.yaml`; user maintains value from broker app. |
| Direct broker account balances | E.g., 카카오 세이프박스 잔액 / 농협 통장 잔액. | `cash/_index.yaml` is fully manual. No broker / bank API integration — by design (no OAuth-into-banking; local-first preserved). |
| Pre/post-market US quotes | Yahoo's free API gives delayed regular-session data only. | Live trading is out of scope; daily check is enough for a workspace tool. |
| Live KR FX vs USD/EUR within the same session | `getFxRates()` returns end-of-day rates, not tick-level. | Acceptable for analysis briefs; misleading only if you trade off the surface (you don't). |
| Per-position dividends history | Not in `getQuotes()` shape. | Use the workspace's analysis files. Dividend tracking would need a separate API layer. |
| Korean ETF NAV vs price spread | Yahoo gives traded price; KRX official NAV is elsewhere. | Acceptable — price is what you'd transact at. |

## What the v2 surface actually needs

Cross-reference against the actual portfolio under
`data/portfolio/positions/current.csv` (~40 positions across 5
brokerages):

- **34 of 40** positions are Yahoo-quotable. Today's SDK handles them
  out of the box. ✅
- **2 positions** are paper precious metals at Revolute → already
  captured in `assets/precious_metals.yaml` with `has_live_quote: false`
  and a `spot_reference_symbol` for display-only reference.
- **1 position** is a robo-advisor fund → captured in `assets/funds.yaml`
  with `has_live_quote: false`.
- **4 cash buckets** (broker deposits + bank balances) → captured in
  `cash/_index.yaml`, manual maintenance.

**Conclusion**: today's SDK is sufficient. The shape mismatches (paper
metals, robo-advisor funds, cash) are correctly classified as
"non-quotable, user-maintained" rather than as gaps in the API.

## What to add — prioritized

### Tier 1 (do now — small, generalize beyond portfolio)

1. **SDK type for `has_live_quote: false`**: today the surface calls
   `getQuotes(symbols)` and one bad symbol fails the whole batch. The
   surface needs to **filter** to `quote_source: yahoo` symbols before
   the call. (Fix in the v2 surface rewrite, not the SDK.)
2. **`getQuotes()` graceful per-symbol failure**: SDK should return
   `{ ok: { …found symbols… }, errors: { …unresolved… } }` so a single
   KR ticker mistake doesn't blank the entire dashboard. (~10 line
   change in `apps/server/src/services/quoteProxy.ts` if it exists; do
   in a follow-up batch.)
3. **`spot_reference_symbol` lookup**: the surface can show a reference
   "spot gold today" line even when the portfolio entry is manual. The
   SDK supports it already — surface code just needs to use it.

### Tier 2 (defer until concrete need)

4. **KRX official NAV for KR ETFs**: only matters if the user trades
   based on premium/discount. For workspace analysis, not needed.
5. **Dividend history fetch**: would require an additional API
   provider (Yahoo dividend history exists but the SDK doesn't expose
   it). Defer until the user runs an action template that needs it.
6. **EUR-quoted gold/silver ETFs**: Yahoo has `XGLD.L` etc.; the v2
   surface can use these as a *reference* price for the EUR paper
   gold/silver. Could let the action templates compute thesis-relative
   gain/loss without manual updates. Defer — modest win.

### Tier 3 (do not do)

7. **Direct broker API integration**: Korean Investment / SK / Revolute
   / Kakao Bank APIs all exist but require OAuth + user banking
   credentials. Out of scope per `docs/POSITIONING.md` §2.3 (no
   multi-tenant SaaS; local-first; we don't want banking creds in our
   surface). The user keeps maintaining `_index.yaml` files manually,
   and that's correct.
8. **Live tick / WebSocket quotes**: this is a workspace analysis
   tool, not a trading terminal. Real-time isn't needed for the
   monthly-macro / quarterly-sector cadence.
9. **OCR import from broker statements**: nice to have, but the
   action template `ingest_broker_statement` would belong in a
   separate per-broker plugin, not the core surface SDK.

## How the v2 surface handles the gaps

The v2 surface in `data/portfolio/.ariadne/surface.tsx` (and the
in-repo template `apps/server/src/surface/portfolioStarter.ts`):

- Reads `positions/current.csv` and **filters** to
  `quote_source === "yahoo"` before calling `ariadne.getQuotes()`.
- Reads `assets/precious_metals.yaml` and `assets/funds.yaml` for the
  manual-value assets and renders them as **separate cards** with a
  "manual" badge.
- Reads `cash/_index.yaml` and renders the cash buckets in their own
  section, summing `is_idle: true` rows into the "유휴 자금" action
  card.
- Surface badges each asset's `quote_source` so the user can see
  immediately which numbers are live vs manually maintained.

## Stock API decision

**Don't expand the SDK now.** Today's quote + FX shape is enough for
the v2 portfolio surface. The four genuine gaps (per-symbol error
handling, dividend history, KRX NAV, broker integration) each have
clear acceptance criteria and can be added when a specific use case
demands them.

The portfolio starter is the workspace shape that needs the most
data variety in Ariadne. If its current API surface is sufficient,
the API surface is sufficient for v0.1.

## References

- [`docs/PORTFOLIO_STARTER_V2.md`](PORTFOLIO_STARTER_V2.md) — the
  workspace data model
- [`apps/server/src/surface/runtime.tsx`](../apps/server/src/surface/runtime.tsx) — the
  SDK runtime (`useAriadne` + chart primitives)
- [`apps/server/src/surface/portfolioStarter.ts`](../apps/server/src/surface/portfolioStarter.ts) — the
  starter template (in-repo, anonymized)
