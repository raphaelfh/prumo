/**
 * Two-way sync between the store's `currentPage` and a scroll container that
 * holds one element per page — `<Viewer.Body>`'s canvas pages and the markdown
 * reader's page sections.
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
import {useEffect, useState, type RefObject} from 'react';
import type {StoreApi} from 'zustand';

import {useViewerStore, useViewerStoreApi} from '../core/context';
import type {ViewerState} from '../core/state';

/**
 * Where `scrollend` is unsupported (Safari before 26.2), a programmatic scroll
 * counts as settled once `scroll` events have paused this long.
 */
const SCROLL_IDLE_MS = 150;

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

function createPageScrollSync(storeApi: StoreApi<ViewerState>, pageAttribute: string) {
  // Pages intersecting the container's upper half, with their latest entry.
  const visible = new Map<number, IntersectionObserverEntry>();
  // The page last published from the scroll position. Its `currentPage`
  // change is consumed by the navigation effect instead of scrolling.
  let publishedPage: number | null = null;
  // Detaches the listeners of a programmatic scroll that has not settled.
  let unsettled: (() => void) | null = null;

  function publishVisiblePage() {
    // Pick the page whose top is nearest the top edge — of the viewport, as
    // entry rects are viewport coordinates. This approximates what the user
    // feels is the "current" page while scrolling.
    let bestPage = -1;
    let bestDistance = Infinity;
    for (const [page, entry] of visible) {
      const distance = Math.abs(entry.boundingClientRect.top);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPage = page;
      }
    }
    const {currentPage, actions} = storeApi.getState();
    if (bestPage > 0 && bestPage !== currentPage) {
      publishedPage = bestPage;
      actions.goToPage(bestPage);
    }
  }

  return {
    observe(entries: IntersectionObserverEntry[]) {
      for (const entry of entries) {
        const page = parseInt(entry.target.getAttribute(pageAttribute) ?? '', 10);
        if (Number.isNaN(page)) continue;
        if (entry.isIntersecting) visible.set(page, entry);
        else visible.delete(page);
      }
      if (!unsettled) publishVisiblePage();
    },

    forgetVisiblePages() {
      visible.clear();
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
        if (Math.abs(scroller.scrollTop - target) >= 1) publishVisiblePage();
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
  pageAttribute,
  pagesKey,
}: {
  /** An element inside the scroll container, or the container itself. */
  rootRef: RefObject<HTMLElement | null>;
  /** Selects the scroll container from the root via `closest()`. */
  scrollerSelector: string;
  /** The attribute holding each page element's 1-based page number. */
  pageAttribute: string;
  /** Changes whenever the page elements are replaced, so the observer re-attaches. */
  pagesKey: unknown;
}): (scroller: HTMLElement, top: number) => void {
  const storeApi = useViewerStoreApi();
  const currentPage = useViewerStore((s) => s.currentPage);
  // A ViewerProvider's store never changes, so one sync serves the mount.
  const [sync] = useState(() => createPageScrollSync(storeApi, pageAttribute));

  // Navigation: currentPage → scroll position.
  useEffect(() => {
    const root = rootRef.current;
    const scroller = root?.closest<HTMLElement>(scrollerSelector);
    if (!root || !scroller) return;
    if (sync.takePublishedPage(currentPage)) return;
    const page = root.querySelector<HTMLElement>(`[${pageAttribute}="${currentPage}"]`);
    if (!page) return;
    const top = page.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    sync.scrollTo(scroller, top);
  }, [currentPage, rootRef, scrollerSelector, pageAttribute, sync]);

  // Scrolling: scroll position → currentPage.
  useEffect(() => {
    const root = rootRef.current;
    const scroller = root?.closest<HTMLElement>(scrollerSelector);
    if (!root || !scroller) return;
    if (typeof IntersectionObserver === 'undefined') return; // SSR / jsdom safety

    const observer = new IntersectionObserver((entries) => sync.observe(entries), {
      root: scroller,
      threshold: [0, 0.1, 0.5, 1],
      // Pages at the top of the viewport are "current"; pages below
      // contribute only when they cross the upper half.
      rootMargin: '0px 0px -50% 0px',
    });
    root.querySelectorAll<HTMLElement>(`[${pageAttribute}]`).forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      sync.forgetVisiblePages();
    };
  }, [pagesKey, rootRef, scrollerSelector, pageAttribute, sync]);

  useEffect(() => () => sync.dispose(), [sync]);

  return sync.scrollTo;
}
