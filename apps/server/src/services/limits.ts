/**
 * Per-account token limits.
 *
 * A limit is a daily/weekly token cap stored in `account_limits`; usage is
 * summed from `usage_events` over a ROLLING window (last 24h / last 7 days).
 * Accounts with no `account_limits` row are unlimited (most accounts) — the
 * limit exists for the test account and the shared guest.
 *
 * Enforcement is "you can't START a new request once you're already over":
 * the in-flight request's own tokens aren't counted yet (they haven't
 * happened), which is the standard, predictable behaviour for a soft cap.
 */
import { dbGetAccountLimits, dbGetAccountTokenUsage } from "../db/repo.js";
import type { AccountLimits } from "@ariadne/shared";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Current limits + windowed usage for an account (null limit = unlimited). */
export function accountLimitStatus(accountId: string): AccountLimits {
  const limits = dbGetAccountLimits(accountId);
  const now = Date.now();
  return {
    dailyTokenLimit: limits?.dailyTokenLimit ?? null,
    weeklyTokenLimit: limits?.weeklyTokenLimit ?? null,
    dailyTokensUsed: dbGetAccountTokenUsage(accountId, new Date(now - DAY_MS).toISOString()),
    weeklyTokensUsed: dbGetAccountTokenUsage(accountId, new Date(now - WEEK_MS).toISOString()),
  };
}

/** "daily" / "weekly" if the account is AT or OVER a token cap, else null. */
export function accountOverLimit(accountId: string): "daily" | "weekly" | null {
  const s = accountLimitStatus(accountId);
  if (s.dailyTokenLimit != null && s.dailyTokensUsed >= s.dailyTokenLimit) return "daily";
  if (s.weeklyTokenLimit != null && s.weeklyTokensUsed >= s.weeklyTokenLimit) return "weekly";
  return null;
}
