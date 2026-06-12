/**
 * Skeleton — a content-shaped loading placeholder. Replacing a centered spinner
 * with skeletons makes a load read as "filling in" rather than "blank → pop",
 * which is the bulk of the app-like feel. Uses the shared `animate-pulse-soft`
 * keyframe; the `skeleton` class opts it out of motion under reduced-motion
 * (see globals.css). Compose with width/height utilities via `className`.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton animate-pulse-soft rounded-md bg-foreground/10 ${className}`} />;
}
