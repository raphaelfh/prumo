import { useCallback, useRef, type RefObject } from 'react';

import {
  PENDING_REQUIRED_SELECTOR,
  firstFocusableControl,
  pickNextPending,
} from '@/lib/extraction/pendingFields';

/**
 * "Go to next unfilled" for the extraction form.
 *
 * Walks the rows `FieldInput` stamped `data-pending-required` in document order,
 * scrolls the next one into view and focuses its control. Reading the DOM rather
 * than re-deriving coordinates from the value map keeps the jump honest: it can
 * only ever land on a field that is actually rendered, so a collapsed section is
 * skipped instead of scrolling to nothing.
 */
export function useJumpToNextPendingField(containerRef: RefObject<HTMLElement | null>) {
  // Advancement anchor. `document.activeElement` alone is not enough — focus can
  // land somewhere unexpected (a Radix trigger closing, a click on the button
  // itself), which would leave the anchor behind and make repeated clicks return
  // the same row forever.
  const lastTarget = useRef<HTMLElement | null>(null);

  return useCallback(() => {
    const root = containerRef.current;
    if (!root) return;
    const rows = Array.from(root.querySelectorAll<HTMLElement>(PENDING_REQUIRED_SELECTOR));
    const anchor =
      lastTarget.current && root.contains(lastTarget.current)
        ? lastTarget.current
        : document.activeElement;
    const target = pickNextPending(rows, anchor);
    lastTarget.current = target;
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // preventScroll: the smooth scroll above owns the movement; letting focus
    // scroll too lands the row hard against the viewport edge.
    firstFocusableControl(target)?.focus({ preventScroll: true });
  }, [containerRef]);
}
