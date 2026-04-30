/**
 * Capture and restore the scroll position of one or more containers around an
 * async operation that may briefly remount their children.
 *
 * Usage:
 *   const preserve = usePreserveScroll([
 *     '[data-scroll-container="extraction-form"]',
 *     '[data-scroll-container="true"]', // PDF viewer
 *   ]);
 *   await preserve(async () => {
 *     await refreshInstances();
 *     await refreshValues();
 *   });
 *
 * Implementation notes:
 *   - We snapshot scrollTop *and* scrollLeft for every container that exists
 *     at the start of the operation.
 *   - After the await resolves, we restore via two requestAnimationFrame
 *     calls so the browser has time to commit the new layout before we set
 *     scroll positions back. Restoring inside one rAF was racy with React's
 *     commit phase; doing it on the next paint (rAF + rAF) lands after.
 *   - Containers missing on either snapshot or restore are silently skipped,
 *     so the helper is safe to share across pages.
 */
import { useCallback } from "react";

export type PreserveScroll = <T>(operation: () => Promise<T>) => Promise<T>;

function snapshot(selectors: string[]): Map<string, { top: number; left: number }> {
  const snap = new Map<string, { top: number; left: number }>();
  for (const selector of selectors) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      snap.set(selector, { top: el.scrollTop, left: el.scrollLeft });
    }
  }
  return snap;
}

function restore(snap: Map<string, { top: number; left: number }>): void {
  // Two rAFs: first lets React commit; second runs after the resulting paint.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      for (const [selector, pos] of snap.entries()) {
        const el = document.querySelector<HTMLElement>(selector);
        if (el) {
          el.scrollTop = pos.top;
          el.scrollLeft = pos.left;
        }
      }
    });
  });
}

export function usePreserveScroll(selectors: string[]): PreserveScroll {
  // selectors is intentionally treated as a stable identity by callers (we
  // pass a module-level constant array). Spreading into the deps lets eslint
  // reason about the dependency without a disable directive.
  return useCallback(
    async (operation) => {
      const snap = snapshot(selectors);
      try {
        return await operation();
      } finally {
        restore(snap);
      }
    },
    [...selectors]
  );
}
