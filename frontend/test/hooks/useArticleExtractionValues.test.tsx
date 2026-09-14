import {QueryClient, QueryClientProvider, onlineManager} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {getArticleProgress} = vi.hoisted(() => ({getArticleProgress: vi.fn()}));
vi.mock('@/services/articleProgressService', () => ({getArticleProgress}));

import {useArticleExtractionValues} from '@/hooks/extraction/useArticleExtractionValues';

function setup() {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {queryClient, wrapper};
}

const A1 = {article_id: 'a1', instances: [{id: 'i1', entity_type_id: 'et1'}], values: [{instance_id: 'i1', field_id: 'f1', value: 'x'}]};
const A2 = {article_id: 'a2', instances: [{id: 'i2', entity_type_id: 'et1'}], values: []};

beforeEach(() => vi.clearAllMocks());
afterEach(() => onlineManager.setOnline(true));

describe('useArticleExtractionValues', () => {
  it('maps the response to a per-article map', async () => {
    getArticleProgress.mockResolvedValue({articles: [A1, A2]});
    const {wrapper} = setup();
    const {result} = renderHook(() => useArticleExtractionValues('p1', 't1', 'u1'), {wrapper});
    await waitFor(() => expect(result.current.valuesByArticle.size).toBe(2));
    expect(result.current.valuesByArticle.get('a1')).toEqual({instances: A1.instances, values: A1.values});
    expect(result.current.valuesByArticle.get('a2')).toEqual({instances: A2.instances, values: []});
    expect(result.current).toMatchObject({isLoading: false, isError: false, isUnavailable: false});
    expect(getArticleProgress).toHaveBeenCalledWith('p1', 't1', 'extraction');
  });
  it('keys the cache by project, template, user and kind', async () => {
    getArticleProgress.mockResolvedValue({articles: []});
    const {queryClient, wrapper} = setup();
    const {result} = renderHook(
      () => useArticleExtractionValues('p1', 't1', 'u1', 'quality_assessment'), {wrapper});
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(queryClient.getQueryCache().getAll().map((q) => q.queryKey)).toEqual([
      ['article-extraction-values', 'p1', 't1', 'u1', 'quality_assessment'],
    ]);
    expect(getArticleProgress).toHaveBeenCalledWith('p1', 't1', 'quality_assessment');
  });
  it('reports isError, not endless loading, when the fetch fails', async () => {
    getArticleProgress.mockRejectedValue(new Error('boom'));
    const {wrapper} = setup();
    const {result} = renderHook(() => useArticleExtractionValues('p1', 't1', 'u1'), {wrapper});
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current).toMatchObject({isLoading: false, isUnavailable: false});
    expect(result.current.valuesByArticle.size).toBe(0);
  });
  it('is unavailable, not loading, when the query is disabled because userId is null', () => {
    const {wrapper} = setup();
    const {result} = renderHook(() => useArticleExtractionValues('p1', 't1', null), {wrapper});
    expect(result.current).toMatchObject({isUnavailable: true, isLoading: false, isError: false});
    expect(getArticleProgress).not.toHaveBeenCalled();
  });
  it('reports loading, not unavailable, while an enabled query is paused', async () => {
    onlineManager.setOnline(false);
    getArticleProgress.mockResolvedValue({articles: []});
    const {queryClient, wrapper} = setup();
    const {result} = renderHook(() => useArticleExtractionValues('p1', 't1', 'u1'), {wrapper});
    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll()[0]?.state.fetchStatus).toBe('paused'));
    expect(result.current).toMatchObject({isLoading: true, isUnavailable: false, isError: false});
    expect(getArticleProgress).not.toHaveBeenCalled();
  });
});
