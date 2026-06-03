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

  // POST /api/auth/guest — start a session as the shared, restricted guest
  // account (no credentials). Role "guest" is read + chat only and token-capped.
  app.post("/auth/guest", async (req, reply) => {
    const account = findAccountByUsername("guest");
    if (!account) return reply.status(503).send({ error: "Guest access is not available" });

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

  // POST /api/auth/reset — recovery path for a stuck session cookie.
  //
  // Symptom we're solving: a user has a cookie signed by a previous
  // server install (different `cookie_secret`) or a cookie pointing to
  // a deleted session row. Every /api/* request comes back 401, the
  // SPA keeps trying to refresh, the browser caches the stuck state.
  // The auth middleware doesn't clear the bad cookie itself (it just
  // 401s), so the cookie stays around forever from the browser's POV.
  //
  // This endpoint always clears `ariadne_session` (signed or not),
  // best-effort deletes the session row if the cookie WAS valid, and
  // returns 200 — safe to call repeatedly, no auth required.
  app.post("/auth/reset", async (req, reply) => {
    // Try to delete the session row if the cookie was valid; ignore
    // failures (invalid signature, no row, etc.) — the point is to
    // clear the BROWSER's cookie so the next request is clean.
    const rawCookie = req.cookies[COOKIE_NAME];
    if (rawCookie) {
      try {
        const token = req.unsignCookie(rawCookie);
        if (token.valid && token.value) {
          deleteSession(token.value);
        }
      } catch {
        // Cookie was malformed — nothing to delete server-side.
      }
    }
    void reply.clearCookie(COOKIE_NAME, { path: "/" });
    return reply.send({ ok: true, cleared: true });
  });

  // GET /api/auth/me
  app.get("/auth/me", async (req, reply) => {
    // The onRequest hook has already attached req.account and req.accessContext
    return reply.send({ account: req.account, accessContext: req.accessContext });
  });
}
