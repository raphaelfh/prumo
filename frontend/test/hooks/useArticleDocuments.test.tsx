/**
 * Tests for useArticleDocuments — the document model behind the switcher.
 *
 * Covers:
 *  - defaults the selection to MAIN (the API returns it first)
 *  - switching documents updates the selected file + source
 *  - polls the selected file's text blocks while it is still `pending`
 *  - readerLoading spans the files-fetch window (the blocks query is disabled
 *    until a file is selected, and a disabled query reports isLoading false)
 */
import {QueryClient, QueryClientProvider, onlineManager} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {ReactElement, ReactNode} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/articleFilesService', () => ({
  listArticleFiles: vi.fn(),
}));
vi.mock('@/hooks/extraction/useArticleTextBlocks', () => ({
  useArticleTextBlocks: vi.fn(),
}));
vi.mock('@prumo/pdf-viewer', () => ({
  articleFileSourceFromStorageKey: (storageKey: string) => ({
    kind: 'lazy',
    _storageKey: storageKey,
  }),
}));

import {listArticleFiles} from '@/services/articleFilesService';
import {useArticleTextBlocks} from '@/hooks/extraction/useArticleTextBlocks';
import {useArticleDocuments} from '@/hooks/extraction/useArticleDocuments';
import type {ArticleFileListItem} from '@/services/articleFilesService';

const listMock = listArticleFiles as unknown as ReturnType<typeof vi.fn>;
const blocksMock = useArticleTextBlocks as unknown as ReturnType<typeof vi.fn>;

const FILES: ArticleFileListItem[] = [
  {
    id: 'main-1',
    fileRole: 'MAIN',
    fileType: 'PDF',
    originalFilename: 'main.pdf',
    extractionStatus: 'parsed',
    bytes: 10,
    storageKey: 'k/main.pdf',
    createdAt: '2026-06-21T00:00:00Z',
  },
  {
    id: 'supp-1',
    fileRole: 'SUPPLEMENT',
    fileType: 'PDF',
    originalFilename: 'supp.pdf',
    extractionStatus: 'pending',
    bytes: 10,
    storageKey: 'k/supp.pdf',
    createdAt: '2026-06-21T00:01:00Z',
  },
];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
  const wrapper = ({children}: {children: ReactNode}): ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {wrapper};
}

beforeEach(() => {
  vi.clearAllMocks();
  blocksMock.mockReturnValue({data: [], isPending: false});
  listMock.mockResolvedValue(FILES);
});

describe('useArticleDocuments', () => {
  it('defaults the selection to the MAIN file', async () => {
    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useArticleDocuments('art-1'), {wrapper});

    await waitFor(() => expect(result.current.files).toHaveLength(2));
    expect(result.current.selectedFileId).toBe('main-1');
    expect(result.current.selectedFile?.fileRole).toBe('MAIN');
    expect(result.current.source).not.toBeNull();
  });

  it('switches the selected document and its source', async () => {
    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useArticleDocuments('art-1'), {wrapper});
    await waitFor(() => expect(result.current.files).toHaveLength(2));

    act(() => result.current.setSelectedFileId('supp-1'));

    expect(result.current.selectedFileId).toBe('supp-1');
    expect(result.current.selectedFile?.fileRole).toBe('SUPPLEMENT');
  });

  it('polls text blocks while the selected file is pending', async () => {
    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useArticleDocuments('art-1'), {wrapper});
    await waitFor(() => expect(result.current.files).toHaveLength(2));

    // MAIN is parsed → no polling.
    expect(blocksMock).toHaveBeenLastCalledWith('main-1', {refetchInterval: false});

    act(() => result.current.setSelectedFileId('supp-1'));

    // SUPPLEMENT is pending → poll until it parses.
    expect(blocksMock).toHaveBeenLastCalledWith('supp-1', {refetchInterval: 4000});
  });

  it('is disabled (no fetch) when articleId is null', async () => {
    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useArticleDocuments(null), {wrapper});
    await new Promise((r) => setTimeout(r, 0));
    expect(listMock).not.toHaveBeenCalled();
    // Disabled ≠ loading: no eternal spinner for a viewer without an article.
    expect(result.current.readerLoading).toBe(false);
  });

  describe('readerLoading across the files-fetch window', () => {
    afterEach(() => {
      onlineManager.setOnline(true);
    });

    it('is true while the files list is still resolving (reader must not flash empty)', async () => {
      // Files fetch in flight → no selection yet → blocks query disabled, whose
      // isLoading is false. readerLoading must still be true, or the reader
      // shows "requires the document to be indexed" for a transient load.
      let resolveFiles!: (files: ArticleFileListItem[]) => void;
      listMock.mockReturnValue(
        new Promise<ArticleFileListItem[]>((r) => {
          resolveFiles = r;
        }),
      );
      blocksMock.mockReturnValue({data: undefined, isPending: false});

      const {wrapper} = createWrapper();
      const {result, rerender} = renderHook(() => useArticleDocuments('art-1'), {wrapper});

      expect(result.current.selectedFileId).toBeNull();
      expect(result.current.readerBlocks).toEqual([]);
      expect(result.current.readerLoading).toBe(true);

      // Files land → a selection exists → the blocks fetch owns the flag.
      blocksMock.mockReturnValue({data: undefined, isPending: true});
      resolveFiles(FILES);
      await waitFor(() => expect(result.current.selectedFileId).toBe('main-1'));
      expect(result.current.readerLoading).toBe(true);

      // Blocks land → loading clears.
      blocksMock.mockReturnValue({data: [], isPending: false});
      rerender();
      expect(result.current.readerLoading).toBe(false);
    });

    it('settles false for an article whose files list is empty (no eternal spinner)', async () => {
      listMock.mockResolvedValue([]);
      const {wrapper} = createWrapper();
      const {result} = renderHook(() => useArticleDocuments('art-1'), {wrapper});

      await waitFor(() => expect(result.current.readerLoading).toBe(false));
      expect(result.current.selectedFileId).toBeNull();
    });

    it('treats a PAUSED files query (offline networkMode) as loading, not empty', async () => {
      // networkMode 'online' + no connection parks the query at status pending /
      // fetchStatus paused, where isLoading is FALSE — the trap that motivates
      // isPending here (same as useActiveTemplateStructure). The reader must
      // show loading, not "requires the document to be indexed".
      onlineManager.setOnline(false);
      listMock.mockResolvedValue(FILES); // never dispatched while offline

      const {wrapper} = createWrapper();
      const {result} = renderHook(() => useArticleDocuments('art-1'), {wrapper});
      await new Promise((r) => setTimeout(r, 0));

      expect(result.current.readerLoading).toBe(true); // isPending survives the pause
    });

    it('settles false when the files fetch errors (empty state, not a spinner)', async () => {
      listMock.mockRejectedValue(new Error('boom'));
      const {wrapper} = createWrapper();
      const {result} = renderHook(() => useArticleDocuments('art-1'), {wrapper});

      await waitFor(() => expect(result.current.readerLoading).toBe(false));
    });
  });
});
