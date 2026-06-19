/**
 * In-memory registry of abort handles for in-flight runs (template + action
 * pipelines). Runs are fire-and-forget background jobs, so — unlike chat
 * generations — there is no per-run socket whose disconnect could cancel them.
 * This registry is what makes a run stoppable at all: POST /runs/:id/stop aborts
 * the signal threaded through the pipeline (LLM calls + spawned children), and
 * between-step checks let the loop bail promptly.
 *
 * Keyed by runId; a run has at most one controller for its lifetime.
 */
const controllers = new Map<string, AbortController>();

/** Register a run and return the AbortSignal to thread through its pipeline. */
export function beginRun(runId: string): AbortSignal {
  const controller = new AbortController();
  controllers.set(runId, controller);
  return controller.signal;
}

/** Abort the in-flight run. Returns true if one was running. */
export function abortRun(runId: string): boolean {
  const controller = controllers.get(runId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/** Whether a run is currently registered (in-flight). */
export function isRunActive(runId: string): boolean {
  return controllers.has(runId);
}

/** Remove a run's controller — call in the pipeline's finally. */
export function endRun(runId: string): void {
  controllers.delete(runId);
}
