import {renderHook, waitFor} from '@testing-library/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, expectTypeOf, it, vi} from 'vitest';

const fetchProjectArticles = vi.fn();
vi.mock('@/services/articlesService', () => ({
  fetchProjectArticles: (...args: unknown[]) => fetchProjectArticles(...args),
}));

import {useProjectArticlesQuery, useProjectWorklist} from '@/hooks/shared/useProjectArticlesQuery';

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

// The one worklist reader shared by both run screens and the QA tab.
describe('useProjectWorklist', () => {
  beforeEach(() => {
    fetchProjectArticles.mockReset();
  });

  // The title survives at RUNTIME whatever the declared type says, so the
  // behavioural cases below cannot see a type defect on their own —
  // `RunHeader.Worklist` needs `{ id, title }[]`, and `npm run typecheck` (not
  // vitest, which never typechecks) is the gate that runs this assertion.
  it('exposes a worklist item type that carries the title', () => {
    expectTypeOf<ReturnType<typeof useProjectWorklist>['worklist'][number]>().toEqualTypeOf<{
      id: string;
      title: string;
    }>();
  });

  it('carries the article title through, not just the id', async () => {
    fetchProjectArticles.mockResolvedValue({
      ok: true,
      data: [{id: 'a1', title: 'First'}, {id: 'a2', title: 'Second'}],
    });
    const {wrapper} = setup();
    const {result} = renderHook(() => useProjectWorklist('p1'), {wrapper});
    await waitFor(() => expect(result.current.worklist).toHaveLength(2));
    expect(result.current.worklist[0]).toEqual({id: 'a1', title: 'First'});
  });

  // `articles.title` is nullable in the schema, so the pager and the palette
  // would otherwise have a blank row to click on.
  it('names an untitled article instead of carrying a null title', async () => {
    fetchProjectArticles.mockResolvedValue({
      ok: true,
      data: [{id: 'a1', title: null}, {id: 'a2', title: 'Second'}],
    });
    const {wrapper} = setup();
    const {result} = renderHook(() => useProjectWorklist('p1'), {wrapper});
    await waitFor(() => expect(result.current.worklist).toHaveLength(2));
    expect(result.current.worklist[0]).toEqual({id: 'a1', title: 'Untitled article'});
  });

  it('resolves to an empty list on a failed read and exposes the error', async () => {
    const error = {message: 'boom'};
    fetchProjectArticles.mockResolvedValue({ok: false, error});
    const {wrapper} = setup();
    const {result} = renderHook(() => useProjectWorklist('p1'), {wrapper});
    await waitFor(() => expect(result.current.error).toBe(error));
    expect(result.current.worklist).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('is idle, not loading, without a project id', async () => {
    const {wrapper} = setup();
    const {result} = renderHook(() => useProjectWorklist(undefined), {wrapper});
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.worklist).toEqual([]);
    expect(fetchProjectArticles).not.toHaveBeenCalled();
  });
});
