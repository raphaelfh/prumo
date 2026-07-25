/**
 * Refresh a server-computed read after autosave persists a write.
 *
 * `useAutoSaveProposals` deliberately bypasses TanStack: invalidating
 * `runs.detail(runId)` on every debounced tick would cost a full
 * `GET /runs/{id}/view` per keystroke burst on every screen. That trade-off is
 * right for values the form already renders optimistically from local state —
 * but WRONG for anything the server derives from those values.
 *
 * The QA overall-judgment banner is exactly that: `derived_judgments` is
 * computed backend-side from the persisted domain judgments, so without a
 * refresh it contradicts the domain judgments visible on the same screen for
 * the entire editing session (a reviewer fills all 16 judgments and still
 * reads four em dashes).
 *
 * This syncs once per *settled* save rather than per keystroke — autosave is
 * already debounced, so `lastSavedAt` only advances when a flush succeeds —
 * and stays inert unless `enabled`, so templates with no computed overalls
 * never pay for a round-trip they cannot use.
 */

import { useEffect, useRef } from "react";

interface UseRefetchOnSaveProps {
  /** Only sync when the screen actually renders server-derived data. */
  enabled: boolean;
  /** Advances on each successful autosave flush; null until the first save. */
  lastSavedAt: Date | null;
  refetch: () => void | Promise<unknown>;
}

export function useRefetchOnSave({
  enabled,
  lastSavedAt,
  refetch,
}: UseRefetchOnSaveProps): void {
  // Compared by timestamp, not object identity: the refetch re-renders the
  // page with a new `lastSavedAt` object for the SAME save, which would
  // otherwise loop. Seeded to 0 so the first real save always syncs.
  const syncedAtRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const savedAt = lastSavedAt?.getTime() ?? 0;
    if (savedAt === 0 || savedAt === syncedAtRef.current) return;
    // Record before awaiting so a slow refetch cannot double-fire.
    syncedAtRef.current = savedAt;
    void refetch();
  }, [enabled, lastSavedAt, refetch]);
}
