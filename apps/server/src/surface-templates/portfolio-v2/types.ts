/**
 * Shared types for the Portfolio v2 surface.
 *
 * Each interface mirrors one CSV column-set or YAML schema block as
 * documented in docs/PORTFOLIO_STARTER_V2.md.
 */

export type Currency = "KRW" | "USD" | "EUR" | "MIXED" | string;

export interface Account {
  id: string;
  label: string;
  type: "brokerage" | "cash" | string;
  sub_type?: string;
  currency: Currency;
  tax_advantaged?: boolean;
  annual_cap_currency?: string;
  annual_cap_amount?: number;
  annual_cap_used?: number;
  preferred_asset_classes?: string[];
  status?: "open" | "closing" | string;
  closing_date?: string;
  closing_action_required?: boolean;
  transfer_cost_per_position?: number;
  transfer_cost_per_position_currency?: string;
  is_idle?: boolean;
  is_emergency_fund_candidate?: boolean;
  notes?: string;
}

export interface RawPosition {
  account_id: string;
  symbol: string;
  name: string;
  asset_class: string;
  sector: string;
  currency: string;
  shares: number;
  buy_price: number;
  current_price: number;
  book_value: number;
  market_value: number;
  return_pct: number;
  target_price?: number;
  stop_loss?: number;
  thesis_id?: string;
  horizon_months?: number;
  confidence?: string;
  last_reviewed?: string;
  quote_symbol?: string;
  quote_source?: "yahoo" | "manual" | "none" | string;
  has_live_quote?: boolean;
  notes?: string;
}

export interface CashBucket {
  id: string;
  label: string;
  type: string;
  within_account_id?: string;
  currency: string;
  amount: number;
  apr?: number;
  is_idle?: boolean;
  is_emergency_fund?: boolean;
  target_amount?: number;
  notes?: string;
}

export interface ManualAsset {
  id: string;
  name: string;
  account_id?: string;
  asset_class: string;
  sector: string;
  currency: string;
  market_value: number;
  return_pct?: number;
  quote_source: string;
  has_live_quote?: boolean;
  spot_reference_symbol?: string;
  metal?: string;
  unit?: string;
  quantity?: number;
  risk_level?: string;
  fund_provider?: string;
  notes?: string;
}

/** Per-symbol quote failure surfaced to the user as an 'unquotable' badge. */
export interface QuoteFailure {
  inputSymbol: string;
  resolvedSymbol: string;
  reason: string;
}

/** Aggregates derived from raw data — computed in index.tsx, consumed by sections. */
export interface Derived {
  totalNetWorthBase: number;
  totalInvestedBase: number;
  totalCashBase: number;
  totalIdleBase: number;
  byAssetClass: Array<{ label: string; value: number }>;
  byCurrency: Array<{ label: string; value: number }>;
  bySector: Array<{ label: string; value: number }>;
  byRegion: Array<{ label: string; value: number }>;
  accountRollup: Map<string, { value: number; positions: number; cash: number }>;
  closingAccounts: Account[];
  taxAccounts: Account[];
  staleTheses: RawPosition[];
  missingTheses: RawPosition[];
}
