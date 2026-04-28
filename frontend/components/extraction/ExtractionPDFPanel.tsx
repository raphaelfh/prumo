/**
 * PDF panel for extraction.
 *
 * Thin wrapper around the modular `@prumo/pdf-viewer` PrumoPdfViewer that
 * adapts an `articleId` (domain concept) into a `PDFLazySource` (viewer
 * concept) and renders inside a ResizablePanel.
 */

import {memo, useMemo} from 'react';
import {ResizableHandle, ResizablePanel} from '@/components/ui/resizable';
import {PrumoPdfViewer, articleFileSource} from '@prumo/pdf-viewer';

export interface ExtractionPDFPanelProps {
  articleId: string;
  projectId: string;
  showPDF: boolean;
}

function ExtractionPDFPanelComponent({
  articleId,
  showPDF,
}: ExtractionPDFPanelProps) {
  // Re-create the lazy source only when articleId changes — stable reference
  // keeps the viewer's `useEffect([source])` from refiring on parent renders.
  const source = useMemo(
    () => (articleId ? articleFileSource(articleId) : null),
    [articleId],
  );

  if (!showPDF) {
    return null;
  }

  return (
    <>
      <ResizablePanel defaultSize={50} minSize={30} maxSize={70}>
        <PrumoPdfViewer source={source} className="h-full" />
      </ResizablePanel>
      <ResizableHandle withHandle />
    </>
  );
}

export const ExtractionPDFPanel = memo(
  ExtractionPDFPanelComponent,
  (prev, next) =>
    prev.articleId === next.articleId &&
    prev.projectId === next.projectId &&
    prev.showPDF === next.showPDF,
);

ExtractionPDFPanel.displayName = 'ExtractionPDFPanel';
