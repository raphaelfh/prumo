// Adapted from anaralabs/lector (MIT)
/**
 * The pages to mount: those in the scroller's viewport plus one on each side.
 * Overscan 1, never trusting `scrollend` alone, and a size correction above
 * the viewport keeps the reading position.
 */
import {useVirtualizer, type PartialKeys, type VirtualItem, type VirtualizerOptions} from '@tanstack/react-virtual';
import {useLayoutEffect, useMemo, useRef} from 'react';
import type {PageLayout} from './usePageLayout';

export function useVirtualPages({
  scroller,
  layout,
}: {
  scroller: HTMLElement | null;
  layout: PageLayout;
}): VirtualItem[] {
  // kept: babel-plugin-react-compiler hard-codes `@tanstack/react-virtual`'s
  // `useVirtualizer()` as a known-incompatible library (IncompatibleLibrary
  // category in its own source) — the diagnostic fires on the call itself,
  // unconditionally, regardless of how the options are built or the result
  // is used. With this repo's panicThreshold: 'all_errors' that diagnostic
  // panics the build, so this hook needs the documented escape hatch.
  'use no memo';
  const options = useMemo<
    PartialKeys<VirtualizerOptions<HTMLElement, Element>, 'observeElementRect' | 'observeElementOffset' | 'scrollToFn'>
  >(
    () => ({
      count: layout.numPages,
      getScrollElement: () => scroller,
      estimateSize: (index) => layout.sizeOf(index + 1).height,
      gap: layout.gap,
      paddingStart: layout.gap,
      paddingEnd: layout.gap,
      overscan: 1,
      // A missed `scrollend` (a known browser flake) would pin `isScrolling`;
      // the idle timer is the fallback that always fires.
      useScrollendEvent: false,
    }),
    [scroller, layout],
  );
  const virtualizer = useVirtualizer(options);

  // A new layout either rescales every page (zoom, view rotation, a new
  // document) or brings one page's real size. The first re-reads every size
  // and leaves the scroll position to whoever changed the zoom; the second
  // corrects that page in place, and the virtualizer shifts the scroll
  // position when the page sits above it, so the text being read stays put.
  const previous = useRef(layout);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = layout;
    if (before === layout) return;
    if (before.zoom !== layout.zoom || before.viewRotation !== layout.viewRotation || before.numPages !== layout.numPages) {
      virtualizer.measure();
      return;
    }
    for (let page = 1; page <= layout.numPages; page++) {
      const height = layout.sizeOf(page).height;
      if (height !== before.sizeOf(page).height) virtualizer.resizeItem(page - 1, height);
    }
  }, [layout, virtualizer]);

  return virtualizer.getVirtualItems();
}
