import type { FastifyInstance } from "fastify";
import { dbGetTotalUsage } from "../db/repo.js";

export async function usageRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/usage
  app.get("/usage", async (_req, reply) => {
    const summary = dbGetTotalUsage();
    return reply.send(summary);
  });
}
