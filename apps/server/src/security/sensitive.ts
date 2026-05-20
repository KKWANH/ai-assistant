import picomatch from "picomatch";
import { SENSITIVE_PATTERNS } from "@ariadne/shared";

/**
 * Check a relative file path against the built-in sensitive patterns.
 * Returns the matched pattern (as a reason string) or null if safe.
 *
 * Matchers are compiled once at module load rather than once per file scan.
 */
const COMPILED_MATCHERS: Array<{ pattern: string; test: (s: string) => boolean }> =
  SENSITIVE_PATTERNS.map((pattern) => ({
    pattern,
    test: picomatch(pattern, { dot: true, nocase: true }),
  }));

export function checkSensitive(relPath: string): string | null {
  for (const { pattern, test } of COMPILED_MATCHERS) {
    if (test(relPath)) {
      return `Matches sensitive pattern: ${pattern}`;
    }
  }
  return null;
}
