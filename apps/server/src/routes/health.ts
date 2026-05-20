import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/healthz", async (_req, _reply) => {
    return { ok: true, uptime: process.uptime() };
  });
}
