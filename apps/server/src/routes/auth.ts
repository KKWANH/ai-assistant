import type { FastifyInstance } from "fastify";
import { LoginSchema } from "@ariadne/shared";
import { findAccountByUsername } from "../auth/accounts.js";
import { verifyPassword } from "../auth/passwords.js";
import { createSession, deleteSession } from "../auth/sessions.js";
import { accessContext } from "../auth/context.js";

const COOKIE_NAME = "ariadne_session";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/auth/login
  app.post("/auth/login", async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", detail: parsed.error.message });
    }
    const { username, password } = parsed.data;

    const account = findAccountByUsername(username);
    if (!account || !verifyPassword(password, account.passwordHash, account.salt)) {
      return reply.status(401).send({ error: "Invalid username or password" });
    }

    const token = createSession(account.id);
    const ctx = accessContext(req);

    void reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: MAX_AGE_SECONDS,
      signed: true,
    });

    const { passwordHash: _ph, salt: _s, ...safeAccount } = account;
    return reply.send({ account: safeAccount, accessContext: ctx });
  });

  // POST /api/auth/logout
  app.post("/auth/logout", async (req, reply) => {
    const token = req.unsignCookie(req.cookies[COOKIE_NAME] ?? "");
    if (token.valid && token.value) {
      deleteSession(token.value);
    }
    void reply.clearCookie(COOKIE_NAME, { path: "/" });
    return reply.send({ ok: true });
  });

  // GET /api/auth/me
  app.get("/auth/me", async (req, reply) => {
    // The onRequest hook has already attached req.account and req.accessContext
    return reply.send({ account: req.account, accessContext: req.accessContext });
  });
}
