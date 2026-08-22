/**
 * Tests for useArticleTextBlocks' narrow return contract.
 *
 * The exported isPending is gated by the hook's own enablement — a DISABLED
 * query is status-pending forever, and callers (useArticleDocuments) fold this
 * flag straight into readerLoading, so an ungated flag would spin the reader
 * eternally for articles with no selected file.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import type {ReactElement, ReactNode} from 'react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/api/client', () => ({
  apiClient: vi.fn(),
}));

import {apiClient} from '@/integrations/api/client';
import {useArticleTextBlocks} from '@/hooks/extraction/useArticleTextBlocks';

const apiMock = apiClient as unknown as ReturnType<typeof vi.fn>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
  const wrapper = ({children}: {children: ReactNode}): ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {wrapper};
}

describe('useArticleTextBlocks', () => {
  it('reports isPending false while disabled (no file id) — never an eternal spinner', async () => {
    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useArticleTextBlocks(null), {wrapper});

    await new Promise((r) => setTimeout(r, 0));
    expect(apiMock).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(false);
  });

  it('reports isPending true while the enabled fetch is unresolved, then data', async () => {
    let resolveBlocks!: (blocks: unknown[]) => void;
    apiMock.mockReturnValue(
      new Promise((r) => {
        resolveBlocks = r;
      }),
    );

    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useArticleTextBlocks('file-1'), {wrapper});

    expect(result.current.isPending).toBe(true);

    resolveBlocks([]);
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.data).toEqual([]);
  });
});
