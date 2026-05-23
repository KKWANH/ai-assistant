/**
 * Skill routes — account-scoped reusable prompt snippets.
 *
 * Skills are the cheapest unit of reuse in the chat composer:
 * just a name + a prompt template. The chat UI surfaces them via a
 * "Skills" button and via slash-command autocomplete.
 *
 * All CRUD operations are scoped to the calling account — there is no
 * admin override, no sharing. A skill is a personal shortcut.
 */
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { CreateSkillSchema, UpdateSkillSchema } from "@ariadne/shared";
import type { Skill } from "@ariadne/shared";
import {
  dbInsertSkill,
  dbListSkills,
  dbGetSkill,
  dbUpdateSkill,
  dbDeleteSkill,
} from "../db/repo.js";

function now(): string {
  return new Date().toISOString();
}

export async function skillRoutes(app: FastifyInstance): Promise<void> {
  // List the calling account's skills, newest-updated first.
  app.get("/skills", async (req, reply) => {
    if (!req.account) return reply.status(401).send({ error: "Sign in required" });
    return reply.send(dbListSkills(req.account.id));
  });

  // Create a new skill for the calling account.
  app.post<{ Body: unknown }>("/skills", async (req, reply) => {
    if (!req.account) return reply.status(401).send({ error: "Sign in required" });
    const parsed = CreateSkillSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", detail: parsed.error.message });
    }
    const ts = now();
    const skill: Skill = {
      id: crypto.randomUUID(),
      accountId: req.account.id,
      name: parsed.data.name.trim(),
      prompt: parsed.data.prompt,
      createdAt: ts,
      updatedAt: ts,
    };
    dbInsertSkill(skill);
    return reply.status(201).send(skill);
  });

  // Partial update — name and/or prompt.
  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/skills/:id",
    async (req, reply) => {
      if (!req.account) return reply.status(401).send({ error: "Sign in required" });
      const existing = dbGetSkill(req.params.id);
      if (!existing) return reply.status(404).send({ error: "Skill not found" });
      if (existing.accountId !== req.account.id) {
        return reply.status(403).send({ error: "Forbidden" });
      }
      const parsed = UpdateSkillSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid request body", detail: parsed.error.message });
      }
      const updated = dbUpdateSkill(
        req.params.id,
        {
          name: parsed.data.name?.trim(),
          prompt: parsed.data.prompt,
        },
        now(),
      );
      if (!updated) return reply.status(404).send({ error: "Skill not found" });
      return reply.send(updated);
    },
  );

  app.delete<{ Params: { id: string } }>("/skills/:id", async (req, reply) => {
    if (!req.account) return reply.status(401).send({ error: "Sign in required" });
    const existing = dbGetSkill(req.params.id);
    if (!existing) return reply.status(404).send({ error: "Skill not found" });
    if (existing.accountId !== req.account.id) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    dbDeleteSkill(req.params.id);
    return reply.send({ ok: true });
  });
}
