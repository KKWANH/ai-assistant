import { useEffect, useState } from "react";

/**
 * Keep an element mounted through its exit animation. `mounted` lags `open` by
 * `durationMs` on the way down, and `leaving` is true during that window so the
 * caller can swap in an exit class. The same render-lag the Dialog uses, made
 * reusable for popovers / the command palette.
 *
 *   const { mounted, leaving } = useExitTransition(open);
 *   return mounted ? <div className={leaving ? "exit" : "enter"}>…</div> : null;
 */
export function useExitTransition(open: boolean, durationMs = 140): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
    } else if (mounted) {
      setLeaving(true);
      const id = window.setTimeout(() => setMounted(false), durationMs);
      return () => window.clearTimeout(id);
    }
  }, [open, mounted, durationMs]);
  return { mounted, leaving };
}
