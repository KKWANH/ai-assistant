import type { FastifyInstance } from "fastify";
import { BUILTIN_TEMPLATES, getTemplate } from "../runs/templates.js";

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/templates
  app.get("/templates", async (_req, reply) => {
    return reply.send(BUILTIN_TEMPLATES);
  });

  // GET /api/templates/:id
  app.get<{ Params: { id: string } }>("/templates/:id", async (req, reply) => {
    const template = getTemplate(req.params.id);
    if (!template) return reply.status(404).send({ error: "Template not found" });
    return reply.send(template);
  });
}
