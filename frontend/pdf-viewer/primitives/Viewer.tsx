import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import type {StoreApi} from 'zustand';
import {ViewerProvider, useViewerStore} from '../core/context';
import type {PDFSource} from '../core/source';
import type {ViewerState} from '../core/state';
import type {createViewerStore} from '../core/store';
import {useDocumentLoader} from '../hooks/useDocumentLoader';
import {usePageHandle} from '../hooks/usePageHandle';
import {usePageScrollSync} from '../hooks/usePageScrollSync';
import {useGestureZoom} from '../viewport/useGestureZoom';
import {layoutPageLocator, usePageLayout} from '../viewport/usePageLayout';
import {useVirtualPages} from '../viewport/useVirtualPages';

/** The scroll container `Viewer.Body` renders, for the `Viewer.Pages` inside it. */
const ScrollerContext = createContext<HTMLElement | null>(null);

interface RootProps {
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

function RootInner({source, children, className}: {source: PDFSource | null; children: ReactNode; className?: string}) {
  useDocumentLoader({source});
  return (
    <div className={className} data-pdf-viewer-root="">
      {children}
    </div>
  );
}

function Body({children, className}: {children: ReactNode; className?: string}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const attach = useCallback((element: HTMLDivElement | null) => {
    rootRef.current = element;
    setScroller(element);
  }, []);
  const layout = usePageLayout();
  const locator = useMemo(() => layoutPageLocator(layout), [layout]);

  // Navigation scrolls to the current page; scrolling publishes the page at
  // the top of the viewport. Both read the page layout, so an unmounted page
  // still has a position.
  usePageScrollSync({rootRef, scrollerSelector: '[data-pdf-viewer-body]', locator, pagesKey: layout.numPages});

  return (
    <ScrollerContext.Provider value={scroller}>
      {/* pan-x pan-y: one finger still scrolls; the browser's own pinch-zoom is off so the pinch reaches useGestureZoom. */}
      <div
        ref={attach}
        className={className}
        data-pdf-viewer-body=""
        style={{overflow: 'auto', position: 'relative', height: '100%', touchAction: 'pan-x pan-y'}}
      >
        {children}
      </div>
    </ScrollerContext.Provider>
  );
}

/**
 * Mounts only the pages near the viewport, each in a slot the page layout
 * positions. The column is as tall as the whole document, so the scrollbar and
 * page navigation work before any other page has rendered. A zoom gesture
 * resizes the sizer and scales the column inside it (`useGestureZoom`).
 */
function Pages({children}: {children: (page: {number: number}) => ReactNode}) {
  const scroller = useContext(ScrollerContext);
  const layout = usePageLayout();
  const isGesturing = useViewerStore((s) => s.isGesturing);
  const items = useVirtualPages({scroller, layout, isGesturing});
  const [sizer, setSizer] = useState<HTMLDivElement | null>(null);
  const [pages, setPages] = useState<HTMLDivElement | null>(null);
  useGestureZoom({scroller, sizer, pages, layout});

  if (layout.numPages === 0) return null;
  return (
    <div ref={setSizer} data-pdf-viewer-sizer="" style={{margin: '0 auto', width: layout.width, height: layout.totalHeight}}>
      <div
        ref={setPages}
        data-pdf-viewer-pages=""
        style={{position: 'relative', width: layout.width, height: layout.totalHeight, transformOrigin: '0 0'}}
      >
        {items.map((item) => {
          const page = item.index + 1;
          const {width, height} = layout.sizeOf(page);
          return (
            <div
              key={item.key}
              style={{position: 'absolute', top: layout.offsetOf(page), left: (layout.width - width) / 2, width, height}}
            >
              {children({number: page})}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Page({pageNumber, children}: {pageNumber: number; children?: ReactNode}) {
  const handle = usePageHandle(pageNumber);
  const setPageSize = useViewerStore((s) => s.actions.setPageSize);

  // The layout sizes a page from page 1 until its handle resolves; a landscape
  // page corrects it here.
  useEffect(() => {
    if (handle) setPageSize(pageNumber, handle.size);
  }, [handle, pageNumber, setPageSize]);

  return (
    // bg-white is intentional, not a missed token: a PDF page is a
    // physical sheet of white paper. It must stay white in both light
    // and dark themes so the page contents render with the contrast
    // and colour the document author intended.
    <div data-page-number={pageNumber} className="relative size-full shadow-md bg-white">
      {children}
    </div>
  );
}

export const Viewer = {Root, Body, Pages, Page};
