import {useRef, type CSSProperties, type ReactNode} from 'react';
import {ViewerProvider, useViewerStore} from '../core/context';
import {useDocumentLoader} from '../hooks/useDocumentLoader';
import {usePageHandle} from '../hooks/usePageHandle';
import {usePageScrollSync} from '../hooks/usePageScrollSync';
import type {PDFSource} from '../core/source';
import type {StoreApi} from 'zustand';
import type {ViewerState} from '../core/state';
import type {createViewerStore} from '../core/store';

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
  const numPages = useViewerStore((s) => s.numPages);

  // Navigation scrolls to the current page; scrolling publishes the page at
  // the top of the viewport. The observer re-attaches when numPages changes
  // (new page elements appear after load).
  usePageScrollSync({
    rootRef: ref,
    scrollerSelector: '[data-pdf-viewer-body]',
    pageAttribute: 'data-page-number',
    pagesKey: numPages,
  });

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
  const handle = usePageHandle(pageNumber);
  const scale = useViewerStore((s) => s.scale);
  const rotation = useViewerStore((s) => s.rotation);

  // Off-screen pages skip style, layout and paint. Without this, anything that
  // resizes the viewer — dragging the Articles or run split — laid out EVERY
  // page's text layer (hundreds of absolutely positioned spans each) again on
  // every frame. A skipped page takes its size from `contain-intrinsic-size`,
  // so that is the size CanvasLayer renders at — its viewport at `scale`,
  // turned for a quarter rotation — exact, not a guess, or scroll-to-page and
  // the page-sync observer (`usePageScrollSync`) would drift. `auto` keeps the
  // real rendered size once the page has been on screen; a visible page still
  // sizes to its content, so nothing is ever clipped.
  let style: CSSProperties | undefined;
  if (handle) {
    const quarterTurn = rotation % 180 !== 0;
    const width = (quarterTurn ? handle.size.height : handle.size.width) * scale;
    const height = (quarterTurn ? handle.size.width : handle.size.height) * scale;
    style = {contentVisibility: 'auto', containIntrinsicSize: `auto ${width}px auto ${height}px`};
  }

  return (
    // bg-white is intentional, not a missed token: a PDF page is a
    // physical sheet of white paper. It must stay white in both light
    // and dark themes so the page contents render with the contrast
    // and colour the document author intended.
    <div data-page-number={pageNumber} className="relative shadow-md bg-white" style={style}>
      {children}
    </div>
  );
}

export const Viewer = {Root, Body, Pages, Page};
