/**
 * Tests for useArticleDocuments — the document model behind the switcher.
 *
 * Covers:
 *  - defaults the selection to MAIN (the API returns it first)
 *  - switching documents updates the selected file + source
 *  - polls the selected file's text blocks while it is still `pending`
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {ReactElement, ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

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
  blocksMock.mockReturnValue({data: [], isLoading: false});
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
    renderHook(() => useArticleDocuments(null), {wrapper});
    await new Promise((r) => setTimeout(r, 0));
    expect(listMock).not.toHaveBeenCalled();
  });
});
