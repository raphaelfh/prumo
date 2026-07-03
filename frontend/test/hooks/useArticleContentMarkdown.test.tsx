/**
 * Tests for useArticleContentMarkdown — the lazy stored-markdown fetch behind
 * the generation dialog's "view text sent" expand.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import type {ReactElement, ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/articlesService', () => ({
  getArticleContentMarkdown: vi.fn(),
}));

import {getArticleContentMarkdown} from '@/services/articlesService';
import {useArticleContentMarkdown} from '@/hooks/extraction/useArticleContentMarkdown';

const svc = getArticleContentMarkdown as unknown as ReturnType<typeof vi.fn>;

function createWrapper() {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}): ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {wrapper};
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useArticleContentMarkdown', () => {
  it('does not fetch while disabled', () => {
    const {wrapper} = createWrapper();
    renderHook(() => useArticleContentMarkdown('art-1', {enabled: false}), {wrapper});
    expect(svc).not.toHaveBeenCalled();
  });

  it('does not fetch when articleId is undefined even if enabled', () => {
    const {wrapper} = createWrapper();
    renderHook(() => useArticleContentMarkdown(undefined, {enabled: true}), {wrapper});
    expect(svc).not.toHaveBeenCalled();
  });

  it('fetches and returns the mapped data when enabled', async () => {
    svc.mockResolvedValueOnce({
      ok: true,
      data: {fileName: 'teste3.pdf', contentMarkdown: '# md'},
    });
    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useArticleContentMarkdown('art-1', {enabled: true}), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(svc).toHaveBeenCalledWith('art-1');
    expect(result.current.data).toEqual({fileName: 'teste3.pdf', contentMarkdown: '# md'});
  });

  it('surfaces an error when the service returns ok:false', async () => {
    svc.mockResolvedValueOnce({ok: false, error: new Error('boom')});
    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useArticleContentMarkdown('art-1', {enabled: true}), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
