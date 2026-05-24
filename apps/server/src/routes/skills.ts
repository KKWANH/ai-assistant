/**
 * Skill routes — reusable prompt snippets, account-scoped + built-in.
 *
 * Skills now support `{variable}` placeholders that the picker fills in
 * before insert, and ship with a curated built-in set (translate,
 * summarise, rewrite, review-code, explain-code, debug). Built-ins are
 * returned from GET /skills alongside the account's own skills,
 * marked with `builtin: true` so the UI hides edit/delete affordances.
 *
 * CRUD still account-scoped — built-ins can be reordered or hidden
 * by the UI but not edited via the API (404 from /:id paths since
 * they aren't in the skills table).
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
import { listBuiltinSkills } from "../services/builtinSkills.js";

function now(): string {
  return new Date().toISOString();
}

export async function skillRoutes(app: FastifyInstance): Promise<void> {
  // List the calling account's skills (newest-updated first) plus the
  // built-in skills appended at the end so the user's own picks are
  // most reachable in the picker.
  app.get("/skills", async (req, reply) => {
    if (!req.account) return reply.status(401).send({ error: "Sign in required" });
    const userSkills = dbListSkills(req.account.id);
    const builtins = listBuiltinSkills();
    return reply.send([...userSkills, ...builtins]);
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
      description: parsed.data.description,
      variables: parsed.data.variables,
      createdAt: ts,
      updatedAt: ts,
    };
    dbInsertSkill(skill);
    return reply.status(201).send(skill);
  });

  // Partial update — name / prompt / description / variables.
  // Built-in ids (`builtin:*`) are rejected outright — they live in code,
  // not in the DB.
  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/skills/:id",
    async (req, reply) => {
      if (!req.account) return reply.status(401).send({ error: "Sign in required" });
      if (req.params.id.startsWith("builtin:")) {
        return reply.status(403).send({ error: "Built-in skills can't be edited" });
      }
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
          description: parsed.data.description,
          variables: parsed.data.variables,
        },
        now(),
      );
      if (!updated) return reply.status(404).send({ error: "Skill not found" });
      return reply.send(updated);
    },
  );

  app.delete<{ Params: { id: string } }>("/skills/:id", async (req, reply) => {
    if (!req.account) return reply.status(401).send({ error: "Sign in required" });
    if (req.params.id.startsWith("builtin:")) {
      return reply.status(403).send({ error: "Built-in skills can't be deleted" });
    }
    const existing = dbGetSkill(req.params.id);
    if (!existing) return reply.status(404).send({ error: "Skill not found" });
    if (existing.accountId !== req.account.id) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    dbDeleteSkill(req.params.id);
    return reply.send({ ok: true });
  });
}
