/**
 * Alert inbox routes — the notification bell.
 *
 *   GET    /api/alerts            → { alerts: Alert[], unreadCount }
 *   POST   /api/alerts/:id/read   → mark one read
 *   POST   /api/alerts/read-all   → mark all read
 *   DELETE /api/alerts/:id        → dismiss one
 *
 * All routes are scoped to the calling account (the repo fns filter by
 * account_id), so a user only ever sees / mutates their own alerts.
 */
import type { FastifyInstance } from "fastify";
import {
  dbListAlerts,
  dbCountUnreadAlerts,
  dbMarkAlertRead,
  dbMarkAllAlertsRead,
  dbDeleteAlert,
} from "../db/repo.js";

function nowIso(): string {
  return new Date().toISOString();
}

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  app.get("/alerts", async (req, reply) => {
    if (!req.account) return reply.status(401).send({ error: "Sign in required" });
    return reply.send({
      alerts: dbListAlerts(req.account.id, 50),
      unreadCount: dbCountUnreadAlerts(req.account.id),
    });
  });

  app.post<{ Params: { id: string } }>("/alerts/:id/read", async (req, reply) => {
    if (!req.account) return reply.status(401).send({ error: "Sign in required" });
    dbMarkAlertRead(req.params.id, req.account.id, nowIso());
    return reply.send({ ok: true, unreadCount: dbCountUnreadAlerts(req.account.id) });
  });

  app.post("/alerts/read-all", async (req, reply) => {
    if (!req.account) return reply.status(401).send({ error: "Sign in required" });
    dbMarkAllAlertsRead(req.account.id, nowIso());
    return reply.send({ ok: true, unreadCount: 0 });
  });

  app.delete<{ Params: { id: string } }>("/alerts/:id", async (req, reply) => {
    if (!req.account) return reply.status(401).send({ error: "Sign in required" });
    dbDeleteAlert(req.params.id, req.account.id);
    return reply.send({ ok: true, unreadCount: dbCountUnreadAlerts(req.account.id) });
  });
}
