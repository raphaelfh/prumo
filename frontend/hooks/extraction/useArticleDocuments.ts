/**
 * Document model for the PDF viewer + reader pane.
 *
 * Lists an article's files (MAIN + supplements) via `GET /articles/{id}/files`,
 * tracks the selected document (default MAIN), and resolves both the PDF
 * `source` and the reader-view `blocks` for that selection. While a file's
 * parse is still running (`extraction_status === 'pending'`), the files list
 * and the selected file's text blocks poll so the reader stops showing the
 * "requires the document to be indexed" empty state as soon as parsing lands.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { articleFileSourceFromStorageKey } from '@prumo/pdf-viewer';
import { articleKeys } from '@/lib/query-keys';
import {
  listArticleFiles,
  type ArticleFileListItem,
} from '@/services/articleFilesService';
import {
  useArticleTextBlocks,
  type ArticleTextBlock,
} from './useArticleTextBlocks';

const FILES_STALE_MS = 60_000;
const PENDING_POLL_MS = 4000;

type PDFLazySource = ReturnType<typeof articleFileSourceFromStorageKey>;

export interface UseArticleDocumentsResult {
  files: ArticleFileListItem[];
  filesLoading: boolean;
  /** The currently selected file id (MAIN by default), or null when empty. */
  selectedFileId: string | null;
  /** Select a document by id. */
  setSelectedFileId: (id: string) => void;
  selectedFile: ArticleFileListItem | null;
  /** PDF source for the selected file, or null when there is none. */
  source: PDFLazySource | null;
  /** Reader-view blocks for the selected file (empty until parsed). */
  readerBlocks: ArticleTextBlock[];
  readerLoading: boolean;
}

export function useArticleDocuments(
  articleId: string | null | undefined,
): UseArticleDocumentsResult {
  const filesQuery = useQuery({
    queryKey: articleKeys.files(articleId ?? ''),
    enabled: Boolean(articleId),
    staleTime: FILES_STALE_MS,
    queryFn: () => listArticleFiles(articleId as string),
    refetchInterval: (query) => {
      const data = query.state.data as ArticleFileListItem[] | undefined;
      return data?.some((f) => f.extractionStatus === 'pending')
        ? PENDING_POLL_MS
        : false;
    },
  });

  const files = useMemo(() => filesQuery.data ?? [], [filesQuery.data]);

  // Default selection = MAIN (the API returns it first). A user override wins
  // while the chosen file still exists in the list.
  const [override, setOverride] = useState<string | null>(null);
  const overrideValid = override != null && files.some((f) => f.id === override);
  const selectedFileId = overrideValid ? override : (files[0]?.id ?? null);
  const selectedFile = useMemo(
    () => files.find((f) => f.id === selectedFileId) ?? null,
    [files, selectedFileId],
  );

  const selectedPending = selectedFile?.extractionStatus === 'pending';
  const blocksQuery = useArticleTextBlocks(selectedFileId, {
    refetchInterval: selectedPending ? PENDING_POLL_MS : false,
  });

  const source = useMemo<PDFLazySource | null>(
    () =>
      selectedFile
        ? articleFileSourceFromStorageKey(selectedFile.storageKey)
        : null,
    [selectedFile],
  );

  return {
    files,
    filesLoading: filesQuery.isLoading,
    selectedFileId,
    setSelectedFileId: setOverride,
    selectedFile,
    source,
    readerBlocks: blocksQuery.data ?? [],
    readerLoading: blocksQuery.isLoading,
  };
}
