/**
 * Where every page of the canvas view sits, computed from page sizes alone —
 * no DOM — so a page that is not mounted still has a position. Pages the
 * viewer has not opened yet are estimated from page 1. Gaps scale with zoom,
 * like the pages, so zooming scales the whole column uniformly.
 */
import {useMemo} from 'react';
import {useViewerStore} from '../core/context';
import type {PageRotation} from '../core/engine';
import type {PageLocator} from '../hooks/usePageScrollSync';
import {displayedSize} from '../core/rotation';
import type {PageSize} from '../core/state';

/** Space above, between and below pages at zoom 1, in CSS px. */
export const PAGE_GAP = 16;

export interface PageLayout {
  readonly numPages: number;
  readonly zoom: number;
  readonly viewRotation: PageRotation;
  /** `PAGE_GAP` at this zoom. */
  readonly gap: number;
  /** On-screen size of `page` (1-based): its known size, or page 1's as the estimate. */
  sizeOf(page: number): PageSize;
  /** Distance from the top of the content to the top of `page`. */
  offsetOf(page: number): number;
  /** Among the pages showing in the viewport's upper half, the one whose top is nearest `scrollTop`. */
  pageAt(scrollTop: number, viewportHeight: number): number;
  readonly totalHeight: number;
  /** Widest page plus its side gaps, at zoom 1 — what fit width divides by. */
  readonly naturalWidth: number;
  /** `naturalWidth` at this zoom. */
  readonly width: number;
}

export function createPageLayout({
  numPages,
  pageSizes,
  viewRotation,
  zoom,
}: {
  numPages: number;
  pageSizes: Readonly<Record<number, PageSize>>;
  viewRotation: PageRotation;
  zoom: number;
}): PageLayout {
  const estimate = pageSizes[1] ?? {width: 0, height: 0};
  const gap = PAGE_GAP * zoom;
  const sizes: PageSize[] = [];
  const offsets: number[] = [];
  let y = gap;
  let widest = 0;
  for (let page = 1; page <= numPages; page++) {
    const size = displayedSize(pageSizes[page] ?? estimate, viewRotation, zoom);
    sizes.push(size);
    offsets.push(y);
    y += size.height + gap;
    widest = Math.max(widest, size.width);
  }
  const naturalWidth = widest / zoom + 2 * PAGE_GAP;

  return {
    numPages,
    zoom,
    viewRotation,
    gap,
    sizeOf: (page) => sizes[page - 1],
    offsetOf: (page) => offsets[page - 1],
    totalHeight: numPages > 0 ? y : 0,
    naturalWidth,
    width: naturalWidth * zoom,
    pageAt(scrollTop, viewportHeight) {
      // The first page whose bottom edge is below scrollTop…
      let lo = 0;
      let hi = numPages - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid] + sizes[mid].height <= scrollTop) lo = mid + 1;
        else hi = mid;
      }
      // …then every page whose top is still inside the upper half.
      const halfway = scrollTop + viewportHeight / 2;
      let best = lo + 1;
      let bestDistance = Infinity;
      for (let i = lo; i < numPages && offsets[i] < halfway; i++) {
        const distance = Math.abs(offsets[i] - scrollTop);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i + 1;
        }
      }
      return best;
    },
  };
}

/** The layout of the current document at the store's zoom and view rotation. */
export function usePageLayout(): PageLayout {
  const numPages = useViewerStore((s) => s.numPages);
  const pageSizes = useViewerStore((s) => s.pageSizes);
  const viewRotation = useViewerStore((s) => s.viewRotation);
  const zoom = useViewerStore((s) => s.zoom);
  return useMemo(
    () => createPageLayout({numPages, pageSizes, viewRotation, zoom}),
    [numPages, pageSizes, viewRotation, zoom],
  );
}

/** A `PageLocator` that answers from the layout — no DOM query, so it works for pages that are not mounted. */
export function layoutPageLocator(layout: PageLayout): PageLocator {
  return {
    offsetOf: (page) => (page >= 1 && page <= layout.numPages ? layout.offsetOf(page) : null),
    pageAt: (_root, scroller) => (layout.numPages > 0 ? layout.pageAt(scroller.scrollTop, scroller.clientHeight) : null),
    onScroll(_root, scroller, listener) {
      scroller.addEventListener('scroll', listener, {passive: true});
      return () => scroller.removeEventListener('scroll', listener);
    },
  };
}
