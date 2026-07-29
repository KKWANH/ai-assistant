/**
 * TurnTimer — where a chat turn's wall-clock time actually went.
 *
 * A turn is not one call: it triages, builds context, reranks, streams an
 * answer, then may verify. When someone says "it took four minutes", the only
 * useful next question is *which part*, and specifically whether it was the
 * model (provider latency) or us (retrieval, file scanning, embedding). Without
 * per-phase numbers that question is unanswerable, so every turn records them.
 *
 * Collection design — deliberately cheap, because instrumentation that costs
 * real time changes the thing it measures:
 *   - ONE record per turn, not per token. Deltas arrive hundreds of times a
 *     turn; storing them would dwarf the data they describe.
 *   - Phases are a free-form {name: ms} map, so adding or renaming a phase
 *     needs no migration and old rows stay readable.
 *   - `performance.now()` (monotonic) — immune to NTP steps and DST, which
 *     Date.now() is not.
 *   - Overlapping phases are fine: this measures wall time per phase, and the
 *     pipeline runs triage/context concurrently on purpose. Phases therefore
 *     need NOT sum to total; `total` is the only authority on elapsed time.
 */


import type { TurnTimings } from "@ariadne/shared";
export type { TurnTimings };

export class TurnTimer {
  private readonly t0 = performance.now();
  private readonly phases: Record<string, number> = {};
  private readonly open = new Map<string, number>();
  private ttft: number | undefined;
  private provider = 0;

  /** Begin a named phase. Re-opening a name accumulates rather than resets. */
  start(name: string): void {
    this.open.set(name, performance.now());
  }

  /** End a named phase; silently ignores an unopened name. */
  end(name: string): void {
    const started = this.open.get(name);
    if (started === undefined) return;
    this.open.delete(name);
    this.phases[name] = (this.phases[name] ?? 0) + (performance.now() - started);
  }

  /** Time an awaited step — the form to prefer, since it can't leak an open phase. */
  async phase<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.start(name);
    try {
      return await fn();
    } finally {
      this.end(name);
    }
  }

  /** Record the first streamed token. Only the first call counts. */
  markFirstToken(): void {
    this.ttft ??= performance.now() - this.t0;
  }

  /** Add a provider call's duration — lets us split model time from our time. */
  addProviderMs(ms: number): void {
    this.provider += ms;
  }

  /** Elapsed so far. */
  get elapsedMs(): number {
    return performance.now() - this.t0;
  }

  /** Snapshot for persistence. Rounded — sub-millisecond precision is noise. */
  toJSON(): TurnTimings {
    for (const name of [...this.open.keys()]) this.end(name); // close stragglers
    const phases: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.phases)) phases[k] = Math.round(v);
    return {
      totalMs: Math.round(this.elapsedMs),
      ...(this.ttft !== undefined ? { ttftMs: Math.round(this.ttft) } : {}),
      phases,
      ...(this.provider > 0 ? { providerMs: Math.round(this.provider) } : {}),
    };
  }
}
