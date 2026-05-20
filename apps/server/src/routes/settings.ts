import type { FastifyInstance } from "fastify";
import { UpdateSettingsSchema } from "@ariadne/shared";
import { getActiveSettings, saveSettings } from "../config.js";

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/settings
  app.get("/settings", async (_req, reply) => {
    return reply.send(getActiveSettings());
  });

  // PUT /api/settings
  app.put("/settings", async (req, reply) => {
    const parsed = UpdateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", detail: parsed.error.message });
    }
    const updated = saveSettings(parsed.data.provider, parsed.data.model);
    return reply.send(updated);
  });
}
