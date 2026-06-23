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
import {PrumoPdfViewer} from '@prumo/pdf-viewer';
import type {ViewerState} from '@prumo/pdf-viewer';
import {useArticleDocuments} from '@/hooks/extraction/useArticleDocuments';
import {DocumentSwitcher, ParseStatusControl} from './DocumentSwitcher';

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
  const {
    files,
    selectedFileId,
    setSelectedFileId,
    selectedFile,
    source,
    readerBlocks,
    readerLoading,
  } = useArticleDocuments(articleId);

  const handleSelect = (id: string) => {
    if (id === selectedFileId) {
      return;
    }
    // Switching documents must not carry the previous file's highlights,
    // search, or scroll position over (cross-document leak, MF-8).
    const actions = store?.getState().actions;
    actions?.clearCitations();
    actions?.clearSearch();
    actions?.goToPage(1);
    setSelectedFileId(id);
  };

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
        <div className="flex h-full min-h-0 flex-col">
          {files.length > 0 && (
            <div className="flex items-center gap-2 border-b px-2 py-1.5">
              <DocumentSwitcher
                files={files}
                selectedFileId={selectedFileId}
                onSelect={handleSelect}
              />
              {selectedFile && (
                <ParseStatusControl articleId={articleId} file={selectedFile} />
              )}
            </div>
          )}
          <div className="min-h-0 flex-1">
            <PrumoPdfViewer
              source={source}
              store={store}
              readerBlocks={readerBlocks}
              readerLoading={readerLoading}
              className="h-full"
            />
          </div>
        </div>
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
