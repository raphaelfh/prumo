/**
 * Two-way sync between the store's `currentPage` and a scroll container of
 * pages — `<Viewer.Body>`'s canvas pages and the markdown reader's page
 * sections. Where the pages are comes from a `PageLocator`: the canvas asks its
 * page layout (pages may not be mounted), the reader asks the DOM.
 *
 *   - Navigation (a `currentPage` change the scroll position did not cause:
 *     nav buttons, the page input, search, citations) scrolls the container to
 *     that page.
 *   - Scrolling publishes the page nearest the container's top edge to
 *     `currentPage`, and never scrolls in return: the viewport is already
 *     there, and scrolling to the page top would pull a reader back mid-page or
 *     re-target a navigation that is still travelling.
 *
 * A programmatic scroll holds the publishing until it settles, however long it
 * runs. A smooth scroll across several pages passes every page in between;
 * publishing those would overwrite the page the user asked for, and a fixed
 * suppression window cannot prevent it — a long jump outlasts any window short
 * enough not to swallow the user's own scrolling.
 */
import {useEffect, useRef, useState, type RefObject} from 'react';
import type {StoreApi} from 'zustand';

import {useViewerStore, useViewerStoreApi} from '../core/context';
import type {ViewerState} from '../core/state';

/**
 * Where `scrollend` is unsupported (Safari before 26.2), a programmatic scroll
 * counts as settled once `scroll` events have paused this long.
 */
const SCROLL_IDLE_MS = 150;

/** Where a surface's pages are. `root` is the element the surface renders; `scroller` the scroll container around it. */
export interface PageLocator {
  /** The `scrollTop` that puts `page`'s top on the scroller's top edge, or null when the page has no position. */
  offsetOf(page: number, root: HTMLElement, scroller: HTMLElement): number | null;
  /** The page nearest the scroller's top edge, or null when no page is showing. */
  pageAt(root: HTMLElement, scroller: HTMLElement): number | null;
  /** Call `listener` whenever `pageAt` may have changed; returns the detach. */
  onScroll(root: HTMLElement, scroller: HTMLElement, listener: () => void): () => void;
}

/**
 * A `PageLocator` over page elements carrying `pageAttribute`, for a surface
 * that mounts every page (the markdown reader). An IntersectionObserver
 * tracks the pages crossing the scroller's upper half.
 */
export function createDomPageLocator(pageAttribute: string): PageLocator {
  // Pages intersecting the scroller's upper half, with their latest entry.
  const visible = new Map<number, IntersectionObserverEntry>();
  return {
    offsetOf(page, root, scroller) {
      const element = root.querySelector<HTMLElement>(`[${pageAttribute}="${page}"]`);
      if (!element) return null;
      return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    },

    pageAt() {
      // Entry rects are in viewport coordinates, so measure from the root's top
      // (`rootBounds`, always set for an element root) — measured from the
      // viewport's, the pick would move with where the container sits on screen.
      let bestPage: number | null = null;
      let bestDistance = Infinity;
      for (const [page, entry] of visible) {
        const distance = Math.abs(entry.boundingClientRect.top - entry.rootBounds!.top);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestPage = page;
        }
      }
      return bestPage;
    },

    onScroll(root, scroller, listener) {
      if (typeof IntersectionObserver === 'undefined') return () => {}; // SSR / jsdom safety
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const page = parseInt(entry.target.getAttribute(pageAttribute) ?? '', 10);
            if (Number.isNaN(page)) continue;
            if (entry.isIntersecting) visible.set(page, entry);
            else visible.delete(page);
          }
          listener();
        },
        // Pages at the top of the viewport are "current"; pages below
        // contribute only when they cross the upper half.
        {root: scroller, threshold: [0, 0.1, 0.5, 1], rootMargin: '0px 0px -50% 0px'},
      );
      root.querySelectorAll<HTMLElement>(`[${pageAttribute}]`).forEach((element) => observer.observe(element));
      return () => {
        observer.disconnect();
        visible.clear();
      };
    },
  };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Calls `onSettled` once the scroll now under way on `scroller` has come to rest; returns the detach. */
function onScrollSettled(scroller: HTMLElement, onSettled: () => void): () => void {
  // Without `scrollend` support the handler property is absent, not null.
  if (scroller.onscrollend !== undefined) {
    scroller.addEventListener('scrollend', onSettled);
    return () => scroller.removeEventListener('scrollend', onSettled);
  }
  let timer = setTimeout(onSettled, SCROLL_IDLE_MS);
  const restart = () => {
    clearTimeout(timer);
    timer = setTimeout(onSettled, SCROLL_IDLE_MS);
  };
  scroller.addEventListener('scroll', restart);
  return () => {
    clearTimeout(timer);
    scroller.removeEventListener('scroll', restart);
  };
}

function createPageScrollSync(storeApi: StoreApi<ViewerState>) {
  // The page last published from the scroll position. Its `currentPage`
  // change is consumed by the navigation effect instead of scrolling.
  let publishedPage: number | null = null;
  // Detaches the listeners of a programmatic scroll that has not settled.
  let unsettled: (() => void) | null = null;
  // The page under the scroll position now; replaced by the hook on every commit.
  let locate: () => number | null = () => null;

  function publishLocatedPage() {
    const page = locate();
    const {currentPage, actions} = storeApi.getState();
    if (page !== null && page !== currentPage) {
      publishedPage = page;
      actions.goToPage(page);
    }
  }

  return {
    setLocate(next: () => number | null) {
      locate = next;
    },

    /**
     * The scroll position may have moved: publish its page, unless a
     * programmatic scroll is travelling or a zoom gesture is previewing (its
     * scroll positions are at the preview's scale).
     */
    onScroll() {
      if (!unsettled && !storeApi.getState().isGesturing) publishLocatedPage();
    },

    /** True when `page` is the page last published from the scroll position; consumes it. */
    takePublishedPage(page: number): boolean {
      const published = page === publishedPage;
      publishedPage = null;
      return published;
    },

    /** Scroll `scroller` to `top`, holding the publishing until the scroll settles. */
    scrollTo(scroller: HTMLElement, top: number) {
      const target = Math.max(0, Math.min(top, scroller.scrollHeight - scroller.clientHeight));
      // A scroll that goes nowhere fires no `scrollend`, so it must not hold.
      if (!unsettled && Math.abs(scroller.scrollTop - target) < 1) return;
      unsettled?.();
      const detach = onScrollSettled(scroller, () => {
        detach();
        unsettled = null;
        // Stopping short of the target means the user took over mid-scroll:
        // the pages they scrolled to were held back, so publish where they are.
        if (Math.abs(scroller.scrollTop - target) >= 1) publishLocatedPage();
      });
      unsettled = detach;
      scroller.scrollTo({top: target, behavior: prefersReducedMotion() ? 'auto' : 'smooth'});
    },

    dispose() {
      unsettled?.();
      unsettled = null;
    },
  };
}

/**
 * Wire the page ⇄ scroll sync onto a page container. Returns the scroll the
 * surface must use for any other programmatic scroll (e.g. revealing a search
 * match), so the sync holds while that scroll travels too.
 */
export function usePageScrollSync({
  rootRef,
  scrollerSelector,
  locator,
  pagesKey,
}: {
  /** An element inside the scroll container, or the container itself. */
  rootRef: RefObject<HTMLElement | null>;
  /** Selects the scroll container from the root via `closest()`. */
  scrollerSelector: string;
  /** Where the pages are. A new locator takes effect on the next scroll or navigation. */
  locator: PageLocator;
  /** Changes whenever the page elements are replaced, so the locator re-subscribes. */
  pagesKey: unknown;
}): (scroller: HTMLElement, top: number) => void {
  const storeApi = useViewerStoreApi();
  const currentPage = useViewerStore((s) => s.currentPage);
  const isGesturing = useViewerStore((s) => s.isGesturing);
  // A ViewerProvider's store never changes, so one sync serves the mount.
  const [sync] = useState(() => createPageScrollSync(storeApi));
  const pageBeforeGestureRef = useRef(currentPage);
  const gesturedRef = useRef(false);
  const deferredGesturePageRef = useRef<number | null>(null);

  // The latest locator, for the effects below that must not re-run when it
  // changes: a new layout (a zoom, a page size arriving) must not scroll back
  // to the current page's top.
  const locatorRef = useRef(locator);
  useEffect(() => {
    locatorRef.current = locator;
    sync.setLocate(() => {
      const root = rootRef.current;
      const scroller = root?.closest<HTMLElement>(scrollerSelector);
      return root && scroller ? locator.pageAt(root, scroller) : null;
    });
  }, [locator, rootRef, scrollerSelector, sync]);

  // Navigation: currentPage → scroll position.
  useEffect(() => {
    const root = rootRef.current;
    const scroller = root?.closest<HTMLElement>(scrollerSelector);
    if (!root || !scroller) return;
    if (isGesturing) {
      if (!gesturedRef.current) {
        pageBeforeGestureRef.current = currentPage;
        gesturedRef.current = true;
      } else if (currentPage !== pageBeforeGestureRef.current) {
        deferredGesturePageRef.current = currentPage;
      }
      return;
    }
    if (gesturedRef.current) {
      gesturedRef.current = false;
      if (deferredGesturePageRef.current === null) return;
      deferredGesturePageRef.current = null;
    }
    if (sync.takePublishedPage(currentPage)) return;
    const top = locatorRef.current.offsetOf(currentPage, root, scroller);
    if (top !== null) sync.scrollTo(scroller, top);
  }, [currentPage, isGesturing, rootRef, scrollerSelector, sync]);

  // Scrolling: scroll position → currentPage.
  useEffect(() => {
    const root = rootRef.current;
    const scroller = root?.closest<HTMLElement>(scrollerSelector);
    if (!root || !scroller) return;
    return locatorRef.current.onScroll(root, scroller, () => sync.onScroll());
  }, [pagesKey, rootRef, scrollerSelector, sync]);

  useEffect(() => () => sync.dispose(), [sync]);

  // A gesture's scroll events were not published; publish where it left the
  // viewport once it commits (the locator above already has the new layout).
  const wasGesturing = useRef(false);
  useEffect(() => {
    if (wasGesturing.current && !isGesturing) sync.onScroll();
    wasGesturing.current = isGesturing;
  }, [isGesturing, sync]);

  return sync.scrollTo;
}
