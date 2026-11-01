/**
 * Row windowing for the screening record list (spec §4.6 size target: 5,000
 * records). Up to `WINDOW_THRESHOLD` rows every row mounts; above it only the
 * rows in the scroller's viewport plus an overscan, with spacer heights
 * standing in for the rest. A cursor move (a new cursor row, never a refetch
 * that only shifts its index) scrolls the cursor row into the window and, when
 * focus was on a row, focuses the cursor row once it has mounted, so a native
 * Enter opens the cursor row.
 */
import {
  measureElement as measureDomElement,
  observeElementRect,
  useVirtualizer,
  type Virtualizer,
} from '@tanstack/react-virtual';
import {useEffect, useRef} from 'react';

const WINDOW_THRESHOLD = 100;
const OVERSCAN = 10;
// A scroller with no layout (jsdom, or not displayed yet) reports a 0 × 0
// rect, which would mount nothing; it gets a fixed viewport instead.
const FALLBACK_RECT = {width: 1024, height: 600};

interface RecordWindowOptions {
  count: number;
  scroller: HTMLElement | null;
  /** Estimated row height in px; a row whose height varies attaches `measureElement`. */
  rowHeight: number;
  /** Height of the sticky header inside the scroller, so a scrolled-to row clears it. */
  headerHeight: number;
  cursorIndex: number;
  /** The cursor row's identity: scroll and focus follow when it changes, not when its index does. */
  cursorKey: string | null;
  /** The cursor row's focus target, or null while it is not mounted. */
  cursorElement: () => HTMLElement | null;
}

export interface RecordWindow {
  /** The row indexes to mount, or null when every row mounts. */
  indexes: number[] | null;
  /** Spacer heights above and below the mounted rows. */
  before: number;
  after: number;
  measureElement: (element: Element | null) => void;
}

const observeRect = (instance: Virtualizer<HTMLElement, Element>, cb: (rect: {width: number; height: number}) => void) =>
  observeElementRect(instance, (rect) => cb(rect.height === 0 ? FALLBACK_RECT : rect));

export function useRecordWindow({
  count,
  scroller,
  rowHeight,
  headerHeight,
  cursorIndex,
  cursorKey,
  cursorElement,
}: RecordWindowOptions): RecordWindow {
  // kept: babel-plugin-react-compiler hard-codes `useVirtualizer()` as a
  // known-incompatible library and, with panicThreshold 'all_errors', fails
  // the build on the call; the same escape hatch as useVirtualPages.
  'use no memo';
  const windowed = count > WINDOW_THRESHOLD;
  const virtualizer = useVirtualizer<HTMLElement, Element>({
    count,
    enabled: windowed,
    getScrollElement: () => scroller,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
    paddingStart: headerHeight,
    scrollPaddingStart: headerHeight,
    observeElementRect: observeRect,
    // An element with no layout measures 0; keep the estimate for it.
    measureElement: (element, entry, instance) => measureDomElement(element, entry, instance) || rowHeight,
  });

  // A new row height (table ↔ cards) re-reads every size.
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rowHeight]);

  // Set when the cursor moves while a row holds focus; cleared once focus lands.
  const focusPending = useRef(false);
  // The cursor row last followed (undefined before the first run, so a
  // deep-linked cursor scrolls in on mount).
  const followedKey = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    // A refetch that reorders rows moves the cursor's index, not the cursor:
    // focus stays where the user put it and the list does not scroll.
    if (cursorIndex >= 0 && followedKey.current === cursorKey) return;
    if (cursorIndex >= 0) followedKey.current = cursorKey;
    // A new cursor replaces any landing still pending for the previous one.
    focusPending.current = cursorIndex >= 0 && document.activeElement?.closest('[data-record-row]') != null;
    if (cursorIndex < 0) return;
    if (windowed) virtualizer.scrollToIndex(cursorIndex);
  }, [virtualizer, windowed, cursorIndex, cursorKey]);
  // Every commit: the scroll re-render is the one that mounts a far cursor row.
  useEffect(() => {
    if (!focusPending.current) return;
    const element = cursorElement();
    if (!element) return;
    focusPending.current = false;
    element.focus();
  });

  if (!windowed) return {indexes: null, before: 0, after: 0, measureElement: virtualizer.measureElement};
  const items = virtualizer.getVirtualItems();
  const first = items[0];
  const last = items[items.length - 1];
  return {
    indexes: items.map((item) => item.index),
    before: first ? first.start - headerHeight : 0,
    after: last ? virtualizer.getTotalSize() - last.end : 0,
    measureElement: virtualizer.measureElement,
  };
}
