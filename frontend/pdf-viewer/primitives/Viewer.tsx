import {useEffect, useRef, type ReactNode} from 'react';
import {ViewerProvider, useViewerStore, useViewerStoreApi} from '../core/context';
import {useDocumentLoader} from '../hooks/useDocumentLoader';
import type {PDFSource} from '../core/source';
import type {StoreApi} from 'zustand';
import type {ViewerState} from '../core/state';
import type {createViewerStore} from '../core/store';

export interface RootProps {
  source: PDFSource | null;
  store?: StoreApi<ViewerState>;
  initial?: Parameters<typeof createViewerStore>[0];
  children: ReactNode;
  className?: string;
}

function Root({source, store, initial, children, className}: RootProps) {
  return (
    <ViewerProvider store={store} initial={initial}>
      <RootInner source={source} className={className}>
        {children}
      </RootInner>
    </ViewerProvider>
  );
}

function RootInner({
  source,
  children,
  className,
}: {
  source: PDFSource | null;
  children: ReactNode;
  className?: string;
}) {
  useDocumentLoader({source});
  return (
    <div className={className} data-pdf-viewer-root="">
      {children}
    </div>
  );
}

function Body({children, className}: {children: ReactNode; className?: string}) {
  const ref = useRef<HTMLDivElement>(null);
  const currentPage = useViewerStore((s) => s.currentPage);
  const numPages = useViewerStore((s) => s.numPages);
  const storeApi = useViewerStoreApi();

  // The two-way scroll-sync coordination:
  //   - When `currentPage` changes from outside (nav buttons, page input,
  //     `goToCitation`), this Body smoothly scrolls to that page.
  //   - When the user scrolls manually, an IntersectionObserver finds the
  //     page closest to the viewport top and writes it back to `currentPage`.
  // The ref below suppresses the observer feedback for ~500ms after a
  // programmatic scroll so the smooth-scroll animation does not race with
  // the observer firing for transient intermediate pages.
  const isProgrammaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Programmatic scroll: page → scroll position.
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const target = container.querySelector(`[data-page-number="${currentPage}"]`);
    if (target instanceof HTMLElement) {
      isProgrammaticScrollRef.current = true;
      if (programmaticScrollTimerRef.current !== null) {
        clearTimeout(programmaticScrollTimerRef.current);
      }
      programmaticScrollTimerRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
        programmaticScrollTimerRef.current = null;
      }, 500);

      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const top = targetRect.top - containerRect.top + container.scrollTop;
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({top, behavior: 'smooth'});
      } else {
        container.scrollTop = top;
      }
    }
  }, [currentPage]);

  // Inverse: scroll position → currentPage via IntersectionObserver.
  useEffect(() => {
    const container = ref.current;
    if (!container || numPages <= 0) return;
    if (typeof IntersectionObserver === 'undefined') return; // SSR / jsdom safety

    // Track which pages are currently intersecting and pick the one closest
    // to the viewport top on each batch.
    const visibleEntries = new Map<number, IntersectionObserverEntry>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageAttr = (entry.target as HTMLElement).dataset.pageNumber;
          const page = pageAttr ? parseInt(pageAttr, 10) : NaN;
          if (Number.isNaN(page)) continue;
          if (entry.isIntersecting) {
            visibleEntries.set(page, entry);
          } else {
            visibleEntries.delete(page);
          }
        }

        if (isProgrammaticScrollRef.current) return;
        if (visibleEntries.size === 0) return;

        // Pick the page whose top is closest to (but not below) the
        // container's top edge. This matches what the user feels is the
        // "current" page while scrolling.
        let bestPage = -1;
        let bestDistance = Infinity;
        for (const [page, entry] of visibleEntries) {
          const distance = Math.abs(entry.boundingClientRect.top);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestPage = page;
          }
        }

        if (bestPage > 0 && bestPage !== storeApi.getState().currentPage) {
          storeApi.getState().actions.goToPage(bestPage);
        }
      },
      {
        root: container,
        threshold: [0, 0.1, 0.5, 1],
        // Pages at the top of the viewport are "current"; pages below
        // contribute only when they cross the upper half.
        rootMargin: '0px 0px -50% 0px',
      },
    );

    const pageEls = container.querySelectorAll<HTMLElement>('[data-page-number]');
    pageEls.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // Re-attach when numPages changes (new page elements appear after load).
  }, [numPages, storeApi]);

  return (
    <div
      ref={ref}
      className={className}
      data-pdf-viewer-body=""
      style={{overflow: 'auto', position: 'relative', height: '100%'}}
    >
      {children}
    </div>
  );
}

function Pages({children}: {children: (page: {number: number}) => ReactNode}) {
  const numPages = useViewerStore((s) => s.numPages);
  if (numPages === 0) return null;
  return (
    <div data-pdf-viewer-pages="" className="flex flex-col items-center gap-4 py-4">
      {Array.from({length: numPages}, (_, i) => i + 1).map((n) => (
        <div key={n}>{children({number: n})}</div>
      ))}
    </div>
  );
}

function Page({
  pageNumber,
  children,
}: {
  pageNumber: number;
  children?: ReactNode;
}) {
  return (
    <div data-page-number={pageNumber} className="relative shadow-md bg-white">
      {children}
    </div>
  );
}

export const Viewer = {Root, Body, Pages, Page};
