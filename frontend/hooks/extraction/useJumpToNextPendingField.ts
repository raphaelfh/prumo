import { useCallback, useRef, type RefObject } from 'react';
import { flushSync } from 'react-dom';

import {
  PENDING_REQUIRED_SELECTOR,
  firstFocusableControl,
  pickNextPending,
} from '@/lib/extraction/pendingFields';

export interface PendingSections {
  /** Sections still holding an unanswered required field — the rail's own counts. */
  pendingIds: ReadonlySet<string>;
  /** Opens a section, so its rows mount. */
  open: (id: string) => void;
}

const SECTION_SELECTOR = '[data-section-id]';
const NO_SECTIONS: ReadonlySet<string> = new Set();

function landOn(row: HTMLElement): void {
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // preventScroll: the smooth scroll above owns the movement; letting focus
  // scroll too lands the row hard against the viewport edge.
  firstFocusableControl(row)?.focus({ preventScroll: true });
}

/**
 * The rendered pending rows, plus each pending section that renders none — a
 * closed one, whose rows Radix has unmounted — standing in for its rows. In
 * document order. An element repeating its enclosing section's id (the QA
 * accordion root) is that same section, not a second target.
 */
function jumpTargets(root: HTMLElement, pendingIds: ReadonlySet<string>): HTMLElement[] {
  const targets = Array.from(root.querySelectorAll<HTMLElement>(PENDING_REQUIRED_SELECTOR));
  for (const section of Array.from(root.querySelectorAll<HTMLElement>(SECTION_SELECTOR))) {
    const id = section.dataset.sectionId ?? '';
    if (!pendingIds.has(id) || section.querySelector(PENDING_REQUIRED_SELECTOR)) continue;
    if (section.parentElement?.closest<HTMLElement>(SECTION_SELECTOR)?.dataset.sectionId === id) continue;
    targets.push(section);
  }
  return targets.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

/**
 * "Go to next unfilled" for the run forms (extraction + QA).
 *
 * Walks the rows `FieldInput` stamped `data-pending-required` in document order,
 * scrolls the next one into view and focuses its control. Reading the DOM rather
 * than re-deriving coordinates from the value map keeps the jump honest: it can
 * only ever land on a field that is actually rendered. A closed section renders
 * no rows, so when `sections` says it still needs answers, the jump opens it and
 * lands on its first pending row.
 */
export function useJumpToNextPendingField(
  containerRef: RefObject<HTMLElement | null>,
  sections?: PendingSections,
) {
  // Advancement anchor. `document.activeElement` alone is not enough — focus can
  // land somewhere unexpected (a Radix trigger closing, a click on the button
  // itself), which would leave the anchor behind and make repeated clicks return
  // the same row forever.
  const lastTarget = useRef<HTMLElement | null>(null);

  return useCallback(() => {
    const root = containerRef.current;
    if (!root) return;
    const anchor =
      lastTarget.current && root.contains(lastTarget.current)
        ? lastTarget.current
        : document.activeElement;
    const target = pickNextPending(jumpTargets(root, sections?.pendingIds ?? NO_SECTIONS), anchor);
    lastTarget.current = target;
    if (!target) return;
    const sectionId = target.matches(PENDING_REQUIRED_SELECTOR) ? undefined : target.dataset.sectionId;
    if (sectionId === undefined) {
      landOn(target);
      return;
    }
    // Commit the open now, so the row to land on exists before we look for it.
    flushSync(() => sections?.open(sectionId));
    const row = target.querySelector<HTMLElement>(PENDING_REQUIRED_SELECTOR);
    // Opened with nothing to answer inside (its count and its rows disagree):
    // stay anchored on the section, so the next jump moves past it.
    if (!row) return;
    lastTarget.current = row;
    landOn(row);
  }, [containerRef, sections]);
}
