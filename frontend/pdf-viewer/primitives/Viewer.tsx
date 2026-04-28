import {useEffect, useRef, type ReactNode} from 'react';
import {ViewerProvider, useViewerStore} from '../core/context';
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

  // Scroll to the current page when it changes programmatically (nav buttons, input).
  // A ref suppresses the inverse observer-update (see TODO below) during smooth scroll.
  const isProgrammaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // TODO: Add IntersectionObserver-driven currentPage update on scroll.
  // Use isProgrammaticScrollRef to suppress observer updates during smooth-scroll.
  // Deferred to keep this dispatch focused on the core render flow.

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
