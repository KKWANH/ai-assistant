import type { FastifyInstance } from "fastify";
import { dbGetTotalUsage, dbGetLatencyStats } from "../db/repo.js";

export async function usageRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/usage
  app.get("/usage", async (_req, reply) => {
    const summary = dbGetTotalUsage();
    return reply.send(summary);
  });

  // GET /api/usage/latency — where the waiting goes, per model and per turn.
  app.get("/usage/latency", async (_req, reply) => {
    return reply.send(dbGetLatencyStats());
  });
}
