/**
 * Tests for useArticleCitations hook.
 *
 * Covers:
 *  - Queries with the correct key (articleKeys.citations)
 *  - Returns items when service succeeds
 *  - Disabled when articleId is falsy
 *  - Surfaces error via useQuery error state when service returns ok:false
 */

import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import type {ReactElement, ReactNode} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/citationsService', () => ({
  fetchArticleCitations: vi.fn(),
}));

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

import {fetchArticleCitations} from '@/services/citationsService';
import {useArticleCitations} from '@/hooks/articles/useArticleCitations';
import {articleKeys} from '@/lib/query-keys';
import type {ArticleCitationItem} from '@/services/citationsService';

const fetchMock = fetchArticleCitations as unknown as ReturnType<typeof vi.fn>;

function createWrapper(): {
  wrapper: (props: {children: ReactNode}) => ReactElement;
  queryClient: QueryClient;
} {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {retry: false},
    },
  });
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {wrapper, queryClient};
}

function makeItem(id: string): ArticleCitationItem {
  return {
    id,
    verified: false,
    anchorKind: 'text',
    anchor: null,
    metadata: {pageNumber: 1, textContent: 'Some text', source: 'ai'},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useArticleCitations', () => {
  it('returns items when service resolves ok:true', async () => {
    const items = [makeItem('c-1'), makeItem('c-2')];
    fetchMock.mockResolvedValueOnce({ok: true, data: items});

    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useArticleCitations('art-abc'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(items);
    expect(fetchMock).toHaveBeenCalledWith('art-abc');
  });

  it('uses the correct query key (articleKeys.citations)', async () => {
    fetchMock.mockResolvedValueOnce({ok: true, data: []});

    const {wrapper, queryClient} = createWrapper();
    const {result} = renderHook(() => useArticleCitations('art-xyz'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = queryClient.getQueryData(articleKeys.citations('art-xyz'));
    expect(cached).toEqual([]);
  });

  it('is disabled when articleId is null', async () => {
    const {wrapper} = createWrapper();
    const {result} = renderHook(
      () => useArticleCitations(null),
      {wrapper},
    );

    // Give async ticks a chance
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when articleId is empty string', async () => {
    const {wrapper} = createWrapper();
    const {result} = renderHook(
      () => useArticleCitations(''),
      {wrapper},
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('surfaces error when service returns ok:false', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      error: new Error('API failure'),
    });

    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useArticleCitations('art-err'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe('API failure');
  });
});
