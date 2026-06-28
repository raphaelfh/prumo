/**
 * PDF content for the extraction screen.
 *
 * Thin wrapper around the modular `@prumo/pdf-viewer` PrumoPdfViewer that
 * adapts an `articleId` (domain concept) into a `PDFLazySource` (viewer
 * concept). Renders CONTENT only — the surrounding ResizablePanel + handle are
 * owned by `RunSplitShell`, which mounts this node only when the panel is open.
 */

import {memo} from 'react';
import type {StoreApi} from 'zustand';
import {PrumoPdfViewer} from '@prumo/pdf-viewer';
import type {ViewerState} from '@prumo/pdf-viewer';
import {useArticleDocuments} from '@/hooks/extraction/useArticleDocuments';
import {DocumentSwitcher, ParseStatusControl} from './DocumentSwitcher';

export interface ExtractionPdfContentProps {
  articleId: string;
  projectId: string;
  /** Shared viewer store. When provided, the PDF viewer joins the caller's
   *  ViewerProvider instead of creating its own — required for the
   *  click-evidence → highlight flow where the form panel must reach the
   *  same store instance. */
  store?: StoreApi<ViewerState>;
}

function ExtractionPdfContentComponent({
  articleId,
  store,
}: ExtractionPdfContentProps) {
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
    actions?.clearReaderLocate();
    actions?.clearSearch();
    actions?.goToPage(1);
    setSelectedFileId(id);
  };

  return (
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
  );
}

// kept: custom comparator — compiler does not replicate arePropsEqual
export const ExtractionPdfContent = memo(
  ExtractionPdfContentComponent,
  (prev, next) =>
    prev.articleId === next.articleId &&
    prev.projectId === next.projectId &&
    prev.store === next.store,
);

ExtractionPdfContent.displayName = 'ExtractionPdfContent';
