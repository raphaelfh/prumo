import {renderHook, waitFor} from '@testing-library/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const fetchProjectArticles = vi.fn();
vi.mock('@/services/articlesService', () => ({
  fetchProjectArticles: (...args: unknown[]) => fetchProjectArticles(...args),
}));

import {useProjectArticlesQuery} from '@/hooks/shared/useProjectArticlesQuery';

// The app's default freshness window (frontend/App.tsx): a cached list inside it
// is fresh, so only refetchOnMount can make a remount fetch again.
const APP_STALE_TIME_MS = 5 * 60 * 1000;
const ARTICLES = [{id: 'a1', title: 'First'}];

function setup() {
  const client = new QueryClient({
    defaultOptions: {queries: {retry: false, staleTime: APP_STALE_TIME_MS}},
  });
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {wrapper};
}

describe('useProjectArticlesQuery', () => {
  beforeEach(() => {
    fetchProjectArticles.mockReset();
    fetchProjectArticles.mockResolvedValue({ok: true, data: ARTICLES});
  });

  it('refetches the article list when it remounts with fresh cached data', async () => {
    const {wrapper} = setup();
    const first = renderHook(() => useProjectArticlesQuery('p1'), {wrapper});
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    expect(fetchProjectArticles).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useProjectArticlesQuery('p1'), {wrapper});
    // Precondition: the remount is served from a FRESH cache entry, so the
    // app's staleTime alone would not fetch (no article writer invalidates it).
    expect(second.result.current.data).toEqual(ARTICLES);
    expect(second.result.current.isStale).toBe(false);
    await waitFor(() => expect(fetchProjectArticles).toHaveBeenCalledTimes(2));
  });

  it('throws the service error so the query reports it', async () => {
    const error = {message: 'permission denied'};
    fetchProjectArticles.mockResolvedValue({ok: false, error});
    const {wrapper} = setup();
    const {result} = renderHook(() => useProjectArticlesQuery('p1'), {wrapper});
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(error);
  });

  it('does not fetch while disabled', async () => {
    const {wrapper} = setup();
    const {result} = renderHook(() => useProjectArticlesQuery('p1', {enabled: false}), {wrapper});
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.isPending).toBe(true);
    expect(fetchProjectArticles).not.toHaveBeenCalled();
  });
});
