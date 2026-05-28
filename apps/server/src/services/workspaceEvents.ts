/**
 * workspaceEvents — pub/sub for workspace-scoped Server-Sent Events.
 *
 * The web client opens a single SSE stream per active workspace and
 * receives push notifications when the snapshot might have changed
 * (scan complete, markdown cache warmed). The client uses these to
 * invalidate React Query caches without polling.
 *
 * Subscribers are tracked per workspaceId. Publishing a message walks
 * the subscriber set; dead connections (write-after-end errors) auto-
 * unsubscribe themselves.
 */

import logger from "../logger.js";

export type WorkspaceEventType =
  | "scan-complete"
  | "markdown-warmed"
  | "embedding-indexed";

export interface WorkspaceEvent {
  type: WorkspaceEventType;
  workspaceId: string;
  /** Free-form payload — caller decides. UI keys off `type` for now. */
  data?: Record<string, unknown>;
}

type Subscriber = (event: WorkspaceEvent) => void;

const subscribers = new Map<string, Set<Subscriber>>();

/** Register a subscriber for a workspace. Returns an unsubscribe fn. */
export function subscribeWorkspace(workspaceId: string, fn: Subscriber): () => void {
  let set = subscribers.get(workspaceId);
  if (!set) {
    set = new Set();
    subscribers.set(workspaceId, set);
  }
  set.add(fn);
  return () => {
    const cur = subscribers.get(workspaceId);
    if (!cur) return;
    cur.delete(fn);
    if (cur.size === 0) subscribers.delete(workspaceId);
  };
}

/** Fan out an event to every subscriber of the given workspace.
 *  Subscribers that throw are silently removed. */
export function publishWorkspaceEvent(event: WorkspaceEvent): void {
  const set = subscribers.get(event.workspaceId);
  if (!set || set.size === 0) return;
  for (const fn of Array.from(set)) {
    try {
      fn(event);
    } catch (err) {
      logger.debug({ err: String(err), event }, "ws-event subscriber threw — dropping");
      set.delete(fn);
    }
  }
}

/** Count active subscribers — surfaced as a debug header. */
export function subscriberCount(workspaceId: string): number {
  return subscribers.get(workspaceId)?.size ?? 0;
}
