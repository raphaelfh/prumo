/**
 * PDF panel for extraction.
 *
 * Thin wrapper around the modular `@prumo/pdf-viewer` PrumoPdfViewer that
 * adapts an `articleId` (domain concept) into a `PDFLazySource` (viewer
 * concept) and renders inside a ResizablePanel.
 */

import {memo} from 'react';
import type {StoreApi} from 'zustand';
import {ResizableHandle, ResizablePanel} from '@/components/ui/resizable';
import {PrumoPdfViewer, articleFileSource} from '@prumo/pdf-viewer';
import type {ViewerState} from '@prumo/pdf-viewer';

export interface ExtractionPDFPanelProps {
  articleId: string;
  projectId: string;
  showPDF: boolean;
  /** Shared viewer store. When provided, the PDF viewer joins the caller's
   *  ViewerProvider instead of creating its own — required for the
   *  click-evidence → highlight flow where the form panel must reach the
   *  same store instance. */
  store?: StoreApi<ViewerState>;
}

function ExtractionPDFPanelComponent({
  articleId,
  showPDF,
  store,
}: ExtractionPDFPanelProps) {
  const source = articleId ? articleFileSource(articleId) : null;

  if (!showPDF) {
    return null;
  }

  // PDF lives on the RIGHT (order 2). The form panel is order 1, so the single
  // resize handle sits BETWEEN them — i.e. before this panel, not after it.
  return (
    <>
      <ResizableHandle withHandle />
      <ResizablePanel
        id="extraction-pdf"
        order={2}
        defaultSize={50}
        minSize={30}
        maxSize={70}
      >
        <PrumoPdfViewer source={source} store={store} className="h-full" />
      </ResizablePanel>
    </>
  );
}

// kept: custom comparator — compiler does not replicate arePropsEqual
export const ExtractionPDFPanel = memo(
  ExtractionPDFPanelComponent,
  (prev, next) =>
    prev.articleId === next.articleId &&
    prev.projectId === next.projectId &&
    prev.showPDF === next.showPDF &&
    prev.store === next.store,
);

ExtractionPDFPanel.displayName = 'ExtractionPDFPanel';
