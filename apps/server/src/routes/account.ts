/**
 * Account self-management routes.
 *
 * PUT /api/account/locale  — update the authenticated user's locale preference.
 * PUT /api/account/mode    — update the authenticated user's UI mode (standard|simple).
 * PUT /api/account/context — update the authenticated user's saved profile.
 */

import type { FastifyInstance } from "fastify";
import { UpdateLocaleSchema, UpdateModeSchema, UpdateContextSchema } from "@ariadne/shared";
import { updateAccountLocale, updateAccountMode, updateAccountContext } from "../auth/accounts.js";
import { accountLimitStatus } from "../services/limits.js";

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  // PUT /api/account/locale
  app.put("/account/locale", async (req, reply) => {
    const parsed = UpdateLocaleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", detail: parsed.error.message });
    }

    const updated = updateAccountLocale(req.account.id, parsed.data.locale);
    if (!updated) {
      return reply.status(404).send({ error: "Account not found" });
    }

    return reply.send(updated);
  });

  // PUT /api/account/mode
  app.put("/account/mode", async (req, reply) => {
    const parsed = UpdateModeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", detail: parsed.error.message });
    }

    const updated = updateAccountMode(req.account.id, parsed.data.mode);
    if (!updated) {
      return reply.status(404).send({ error: "Account not found" });
    }

    return reply.send(updated);
  });

  // PUT /api/account/context
  app.put("/account/context", async (req, reply) => {
    const parsed = UpdateContextSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", detail: parsed.error.message });
    }

    const updated = updateAccountContext(
      req.account.id,
      parsed.data.context,
      new Date().toISOString()
    );
    if (!updated) {
      return reply.status(404).send({ error: "Account not found" });
    }

    return reply.send(updated);
  });

  // GET /api/account/limits — this account's token limits + windowed usage.
  app.get("/account/limits", async (req, reply) => {
    if (!req.account) return reply.status(401).send({ error: "Sign in required" });
    return reply.send(accountLimitStatus(req.account.id));
  });
}
