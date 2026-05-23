/**
 * Action scheduler — fires recurring action runs.
 *
 * One ticker per server process; checks every 60 s for rows in
 * `action_schedules` where `enabled = 1` and `next_run_at <= now`. For
 * each, kicks off the same createActionRun() the manual "Run" button
 * uses, then rolls `next_run_at` forward by the schedule's cadence.
 *
 * Failures during a tick don't block other schedules: each schedule is
 * advanced even if its run threw, so a broken action doesn't sit at the
 * top of the queue forever stealing the tick slot. The most-recent
 * outcome lives on the resulting Run, not the schedule row.
 */

import type { ScheduleFrequency } from "@ariadne/shared";
import {
  dbListDueSchedules,
  dbUpdateSchedule,
} from "../db/repo.js";
import { createActionRun } from "../runs/actionEngine.js";
import logger from "../logger.js";

const TICK_INTERVAL_MS = 60_000;

let timer: NodeJS.Timeout | null = null;

/** Bump a schedule's anchor by one period. Computed against `from` so a
 *  manually-edited next_run_at can be honoured without a duplicate tick. */
export function computeNextRunAt(frequency: ScheduleFrequency, from: Date): string {
  const next = new Date(from.getTime());
  switch (frequency) {
    case "hourly":
      next.setHours(next.getHours() + 1, 0, 0, 0);
      break;
    case "daily":
      // Anchor to 09:00 local — feels like the "start of the workday" tick.
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
      break;
    case "weekly":
      // Same day-of-week as `from`, +7 days, 09:00 local.
      next.setDate(next.getDate() + 7);
      next.setHours(9, 0, 0, 0);
      break;
    case "monthly":
      // 1st of next month, 09:00 local.
      next.setMonth(next.getMonth() + 1, 1);
      next.setHours(9, 0, 0, 0);
      break;
  }
  return next.toISOString();
}

/** First fire time for a brand-new schedule. Same as the period boundary
 *  the cadence will land on going forward — so the very first run also
 *  happens at, say, 09:00 daily rather than at the moment of creation. */
export function computeFirstRunAt(frequency: ScheduleFrequency, now: Date): string {
  return computeNextRunAt(frequency, now);
}

async function tick(): Promise<void> {
  const now = new Date();
  const due = dbListDueSchedules(now.toISOString());
  if (due.length === 0) return;

  for (const sched of due) {
    try {
      await createActionRun({
        workspaceId: sched.workspaceId,
        actionId: sched.actionId,
        createdBy: sched.accountId,
      });
      logger.info(
        { scheduleId: sched.id, actionId: sched.actionId, frequency: sched.frequency },
        "scheduled action started",
      );
    } catch (err) {
      // Don't let one broken schedule wedge the queue — log + keep going.
      logger.warn(
        { scheduleId: sched.id, actionId: sched.actionId, err },
        "scheduled action failed to start",
      );
    }
    // Always advance, even on failure: the next tick should target the
    // schedule's next cadence slot, not retry this one immediately.
    dbUpdateSchedule(sched.id, {
      lastRunAt: now.toISOString(),
      nextRunAt: computeNextRunAt(sched.frequency, now),
    });
  }
}

/** Start the in-process scheduler. Safe to call multiple times — second
 *  and later calls are no-ops while a timer is already running. */
export function startScheduler(): void {
  if (timer) return;
  // Don't tick on the immediate boot — a daemon restart shouldn't fire
  // every overdue schedule at the same instant. The next minute boundary
  // is soon enough; if you want truly overdue jobs to catch up promptly,
  // call dbListDueSchedules() once manually after startup.
  timer = setInterval(() => {
    void tick().catch((err: unknown) =>
      logger.warn({ err }, "scheduler tick threw — continuing"),
    );
  }, TICK_INTERVAL_MS);
  // Unref the timer so the test runner / one-shot processes can exit cleanly.
  timer.unref?.();
  logger.info({ tickIntervalMs: TICK_INTERVAL_MS }, "action scheduler started");
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
