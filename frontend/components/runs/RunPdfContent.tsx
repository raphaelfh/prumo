/**
 * Shared PDF/markdown content for the run session screens (Extraction + QA).
 *
 * Thin wrapper around the modular `@prumo/pdf-viewer` PrumoPdfViewer that adapts
 * an `articleId` (domain concept) into a `PDFLazySource` (viewer concept).
 * Renders CONTENT only — the surrounding ResizablePanel + handle are owned by
 * `RunSplitShell`, which mounts this node only when the panel is open.
 */

import {memo} from 'react';
import type {StoreApi} from 'zustand';
import {PrumoPdfViewer} from '@prumo/pdf-viewer';
import type {ViewerState} from '@prumo/pdf-viewer';
import {useArticleDocuments} from '@/hooks/extraction/useArticleDocuments';
import {DocumentSwitcher, ParseStatusControl} from '@/components/extraction/DocumentSwitcher';

export interface RunPdfContentProps {
  articleId: string;
  projectId: string;
  /** Shared viewer store. When provided, the PDF viewer joins the caller's
   *  ViewerProvider instead of creating its own — required for the
   *  click-evidence → highlight flow where the form panel must reach the
   *  same store instance. */
  store?: StoreApi<ViewerState>;
}

function RunPdfContentComponent({articleId, store}: RunPdfContentProps) {
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

  // One bar: the switcher and the re-parse control live INSIDE the viewer
  // toolbar (centre / beside the mode toggle), not in a second strip above it.
  return (
    <PrumoPdfViewer
      source={source}
      store={store}
      readerBlocks={readerBlocks}
      readerLoading={readerLoading}
      className="h-full"
      toolbarLeading={
        selectedFile && <ParseStatusControl articleId={articleId} file={selectedFile} />
      }
      toolbarCenter={
        <DocumentSwitcher files={files} selectedFileId={selectedFileId} onSelect={handleSelect} />
      }
    />
  );
}

// kept: custom comparator — compiler does not replicate arePropsEqual
export const RunPdfContent = memo(
  RunPdfContentComponent,
  (prev, next) =>
    prev.articleId === next.articleId &&
    prev.projectId === next.projectId &&
    prev.store === next.store,
);

RunPdfContent.displayName = 'RunPdfContent';
