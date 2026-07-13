/**
 * Liquid-glass pointer specular. One passive, rAF-throttled `pointermove`
 * listener writes `--gx`/`--gy` (0–100%) onto whichever `.glass-control`
 * element is under the cursor, so the `::after` radial highlight tracks the
 * pointer (see the `.glass-control` rules in globals.css). Delegated —
 * controls added/removed later just work, no per-element wiring.
 *
 * Only `.glass-control` surfaces opt in (top bar, composer). Large panes like
 * the sidebar are `.glass` without `-control`, so they never get the tracking
 * highlight — a moving specular over a big list reads as too much.
 */
let rafId = 0;
let pending: { el: HTMLElement; x: number; y: number } | null = null;

function flush(): void {
  rafId = 0;
  if (!pending) return;
  const { el, x, y } = pending;
  el.style.setProperty("--gx", `${x}%`);
  el.style.setProperty("--gy", `${y}%`);
  pending = null;
}

let started = false;

export function initGlassPointer(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener(
    "pointermove",
    (e) => {
      const target = (e.target as HTMLElement | null)?.closest?.(".glass-control") as HTMLElement | null;
      if (!target) return;
      const r = target.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      pending = {
        el: target,
        x: ((e.clientX - r.left) / r.width) * 100,
        y: ((e.clientY - r.top) / r.height) * 100,
      };
      if (!rafId) rafId = requestAnimationFrame(flush);
    },
    { passive: true },
  );
}
