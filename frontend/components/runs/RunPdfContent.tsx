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
import {useArticleDetail} from '@/hooks/extraction/useArticleDetail';
import {
  DocumentSwitcher,
  ParseStatusMenuItem,
  ParseStatusOverlay,
  useParseStatus,
} from '@/components/extraction/DocumentSwitcher';
import {doiUrl} from '@/lib/doi';
import {t} from '@/lib/copy';

export interface RunPdfContentProps {
  articleId: string;
  projectId: string;
  /** Shared viewer store. When provided, the PDF viewer joins the caller's
   *  ViewerProvider instead of creating its own — required for the
   *  click-evidence → highlight flow where the form panel must reach the
   *  same store instance. */
  store?: StoreApi<ViewerState>;
  /** True while the PDF is maximized over the form pane. */
  expanded?: boolean;
  /** Maximize / restore. Omit where there is no split to expand (e.g. the article side panel). */
  onToggleExpand?: () => void;
}

function RunPdfContentComponent({articleId, store, expanded, onToggleExpand}: RunPdfContentProps) {
  const {
    files,
    selectedFileId,
    setSelectedFileId,
    selectedFile,
    source,
    readerBlocks,
    readerLoading,
  } = useArticleDocuments(articleId);

  const {data: article} = useArticleDetail(articleId);
  const doi = typeof article?.doi === 'string' ? article.doi : null;
  const href = doiUrl(doi);
  const externalLink = href ? {label: t('pdf', 'viewerOpenArticlePage'), href} : undefined;

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

  const parse = useParseStatus(articleId, selectedFile ?? null);

  // One bar: the switcher sits in the viewer toolbar's centre and re-parse in
  // its ☰ menu, not in a second strip above it. The confirm dialog and the
  // status live region render OUTSIDE the viewer, so closing the menu cannot
  // unmount them mid-confirm or silence the announcement.
  return (
    <>
    <PrumoPdfViewer
      source={source}
      store={store}
      readerBlocks={readerBlocks}
      readerLoading={readerLoading}
      externalLink={externalLink}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
      className="h-full"
      toolbarMenuItems={parse.isAvailable ? <ParseStatusMenuItem control={parse} /> : undefined}
      toolbarCenter={
        <DocumentSwitcher files={files} selectedFileId={selectedFileId} onSelect={handleSelect} />
      }
    />
    <ParseStatusOverlay control={parse} />
    </>
  );
}

// kept: custom comparator — compiler does not replicate arePropsEqual
export const RunPdfContent = memo(
  RunPdfContentComponent,
  (prev, next) =>
    prev.articleId === next.articleId &&
    prev.projectId === next.projectId &&
    prev.store === next.store &&
    // Without these the memo would freeze the expand button: the toolbar would
    // keep rendering the stale `expanded`, so the icon and aria-pressed would
    // not follow the layout it controls.
    prev.expanded === next.expanded &&
    prev.onToggleExpand === next.onToggleExpand,
);

RunPdfContent.displayName = 'RunPdfContent';
