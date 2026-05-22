/**
 * Account context — a lightweight per-account "memory". After a substantive
 * conversation, an LLM pass extracts durable facts about the user (job, role,
 * domain, preferences, ongoing work) and folds them into a compact profile
 * that is injected into future chats. Best-effort and throttled — a hiccup
 * here never affects the chat itself.
 */

import { findAccountById, updateAccountContext } from "../auth/accounts.js";
import { dbListMessages } from "../db/repo.js";
import { getProvider } from "../providers/index.js";
import { getActiveSettings, isProviderConfigured } from "../config.js";
import { resolveOllamaModel } from "./ollamaModels.js";
import logger from "../logger.js";

/** Don't re-extract more often than this, per account. */
const THROTTLE_MS = 10 * 60 * 1000;
/** A chat needs at least this many messages to be worth extracting from. */
const MIN_MESSAGES = 4;
/** Cap on the stored profile length. */
const MAX_PROFILE_CHARS = 1500;

const EXTRACT_SYSTEM =
  "You maintain a concise profile of a user for an AI assistant. " +
  "You are given the user's CURRENT PROFILE and a RECENT CONVERSATION. " +
  "Return an updated profile that keeps the existing facts and folds in any new, " +
  "durable, useful facts about the user revealed in the conversation — their job, " +
  "role, domain, expertise, stable preferences, and ongoing projects or goals. " +
  "Omit one-off questions, transient details, secrets, passwords, and anything sensitive. " +
  "Keep it tight: short bullet-like lines, under 200 words. " +
  "If the conversation reveals nothing new, return the current profile unchanged. " +
  "Output ONLY the profile text — no preamble, no markdown headers.";

/**
 * Fold durable facts from a conversation into the account's saved profile.
 * Runs in the background; never throws. Throttled per account.
 */
export async function extractAccountContextInBackground(
  accountId: string,
  chatId: string,
): Promise<void> {
  try {
    const account = findAccountById(accountId);
    if (!account) return;

    // Throttle — at most one extraction per account per THROTTLE_MS.
    if (account.contextUpdatedAt) {
      const age = Date.now() - new Date(account.contextUpdatedAt).getTime();
      if (age >= 0 && age < THROTTLE_MS) return;
    }

    const messages = dbListMessages(chatId);
    if (messages.length < MIN_MESSAGES) return;

    const settings = getActiveSettings();
    if (!isProviderConfigured(settings.provider)) return;
    const model =
      settings.provider === "ollama"
        ? await resolveOllamaModel(settings.model)
        : settings.model;
    const provider = await getProvider({ provider: settings.provider, model });

    const recent = messages
      .slice(-16)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 600)}`)
      .join("\n");
    const prompt =
      `CURRENT PROFILE:\n${account.context.trim() || "(empty)"}\n\n` +
      `RECENT CONVERSATION:\n${recent}`;

    const { text } = await provider.complete({ system: EXTRACT_SYSTEM, prompt });
    const next = text.trim().slice(0, MAX_PROFILE_CHARS);
    // Always write — this bumps context_updated_at so the throttle resets even
    // when the conversation revealed nothing new.
    updateAccountContext(
      accountId,
      next.length > 0 ? next : account.context,
      new Date().toISOString(),
    );
  } catch (err) {
    logger.warn({ err, accountId, chatId }, "Account context extraction failed");
  }
}
