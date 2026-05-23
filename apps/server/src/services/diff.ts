/**
 * Tiny inline diff — line-level LCS, good enough for files up to ~10k
 * lines (the only realistic case for human-reviewed edits).
 *
 * Two outputs from one walk:
 *   - `computeDiffOps()` returns an ordered list of edit ops that the
 *     side-by-side renderer in the UI uses as the source of truth.
 *   - `toUnifiedDiff()` formats the same ops as a standard unified-diff
 *     string suitable for storage in the staged manifest and for the
 *     run-history commit message.
 *
 * We deliberately don't use a third-party diff package — Myers is the
 * canonical algorithm but the LCS variant fits in ~70 lines, produces
 * correct (if slightly less compact) output, and avoids a new dep on a
 * dot-zero feature.
 */

export type DiffOp =
  /** Same line in both. */
  | { kind: "equal"; before: number; after: number; text: string }
  /** Present in `before`, gone from `after`. */
  | { kind: "delete"; before: number; text: string }
  /** Inserted into `after`. */
  | { kind: "insert"; after: number; text: string };

/**
 * Compute the LCS-driven edit script that turns `before` into `after`.
 * Line indices in the returned ops are 1-based to match unified-diff /
 * editor conventions; callers can ignore them if they only need a flat
 * render.
 */
export function computeDiffOps(before: string, after: string): DiffOp[] {
  const a = before.length === 0 ? [] : before.split("\n");
  const b = after.length === 0 ? [] : after.split("\n");
  const n = a.length;
  const m = b.length;

  // LCS table — dp[i][j] = length of LCS of a[..i], b[..j].
  // Float64Array is dense + GC-free; for our scale O(n*m) bytes is OK.
  const dp = new Uint32Array((n + 1) * (m + 1));
  const row = m + 1;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i * row + j] = (dp[(i - 1) * row + (j - 1)] ?? 0) + 1;
      } else {
        const up = dp[(i - 1) * row + j] ?? 0;
        const left = dp[i * row + (j - 1)] ?? 0;
        dp[i * row + j] = up > left ? up : left;
      }
    }
  }

  // Walk back through dp to reconstruct the ops in reverse, then flip.
  const ops: DiffOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ kind: "equal", before: i, after: j, text: a[i - 1] ?? "" });
      i--; j--;
    } else if (j > 0 && (i === 0 || (dp[i * row + (j - 1)] ?? 0) >= (dp[(i - 1) * row + j] ?? 0))) {
      ops.push({ kind: "insert", after: j, text: b[j - 1] ?? "" });
      j--;
    } else {
      ops.push({ kind: "delete", before: i, text: a[i - 1] ?? "" });
      i--;
    }
  }
  ops.reverse();
  return ops;
}

/**
 * Format ops as a (simplified, no hunk-windowing) unified diff. Good
 * for storage and for `git log` style review; not byte-identical to
 * `git diff` (skips the @@ hunk headers — every diff is one hunk).
 */
export function toUnifiedDiff(beforePath: string, afterPath: string, ops: DiffOp[]): string {
  const lines: string[] = [
    `--- ${beforePath}`,
    `+++ ${afterPath}`,
  ];
  for (const op of ops) {
    if (op.kind === "equal") lines.push(` ${op.text}`);
    else if (op.kind === "delete") lines.push(`-${op.text}`);
    else lines.push(`+${op.text}`);
  }
  return lines.join("\n");
}

/** Count just the +/− lines — used for the run summary blurb. */
export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.kind === "insert") added++;
    else if (op.kind === "delete") removed++;
  }
  return { added, removed };
}
