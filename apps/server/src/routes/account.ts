/**
 * Account self-management routes.
 *
 * PUT /api/account/locale — update the authenticated user's locale preference.
 * PUT /api/account/mode   — update the authenticated user's UI mode (standard|simple).
 */

import type { FastifyInstance } from "fastify";
import { UpdateLocaleSchema, UpdateModeSchema } from "@ariadne/shared";
import { updateAccountLocale, updateAccountMode } from "../auth/accounts.js";

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
}
