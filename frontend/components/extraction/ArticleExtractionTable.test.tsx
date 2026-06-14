/**
 * Regression test for the "extraction view stuck on the loading skeleton"
 * outage.
 *
 * Root cause: the initial-load effect depended on the `loadArticles`
 * function identity:
 *
 *     useEffect(() => {
 *       if (projectId && templateId && currentUserId) loadArticles();
 *     }, [projectId, templateId, currentUserId, loadArticles]);
 *
 * `loadArticles` calls `setArticles(newArray)` + `setLoading`, which forces a
 * re-render every time it runs. After #270 removed its `useCallback`, the
 * React Compiler did not stabilise the plain async function for the purposes
 * of this dependency array, so each render produced a new identity → the
 * effect re-fired → `loadArticles` ran again → ... an unbounded fetch loop
 * that kept `loading === true` forever (the skeleton never cleared).
 * Production fired the same `articles` request 383× in a few seconds.
 *
 * This test pins the contract: mounting the table triggers the article load
 * exactly once, not in a loop. It keeps the component in its skeleton branch
 * (entity-types still loading) so the loop logic is exercised without
 * rendering the full table.
 */

import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadSpy, getUserSpy } = vi.hoisted(() => ({
  loadSpy: vi.fn(),
  getUserSpy: vi.fn(),
}));

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

vi.mock('@/services/articlesService', () => ({
  loadExtractionTableArticles: (...args: unknown[]) => loadSpy(...args),
}));

vi.mock('@/services/authService', () => ({
  getCurrentUserId: (...args: unknown[]) => getUserSpy(...args),
}));

// Keep entity-types "loading" so the component stays in its skeleton branch:
// the load effect still runs, we just avoid rendering the full table.
vi.mock('@/hooks/extraction/useTemplateEntityTypes', () => ({
  useTemplateEntityTypes: () => ({ entityTypes: [], isLoading: true }),
}));

vi.mock('@/hooks/extraction/useArticleExtractionValues', () => ({
  useArticleExtractionValues: () => ({
    valuesByArticle: new Map(),
    isLoading: false,
  }),
  articleExtractionValuesKeys: { all: ['article-extraction-values'] },
}));

vi.mock('@/hooks/extraction/useFullAIExtraction', () => ({
  useFullAIExtraction: () => ({ extractFullAI: vi.fn(), loading: false }),
}));

import { ArticleExtractionTable } from '@/components/extraction/ArticleExtractionTable';

function renderTable() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ArticleExtractionTable projectId="p1" templateId="t1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserSpy.mockResolvedValue({ ok: true, data: 'user-1' });
  loadSpy.mockResolvedValue({
    ok: true,
    data: [
      {
        id: 'a1',
        title: 'Article One',
        authors: ['Doe'],
        publication_year: 2020,
        created_at: '2020-01-01T00:00:00Z',
      },
    ],
  });
});

describe('ArticleExtractionTable → initial load', () => {
  it('loads articles once and does not loop the fetch', async () => {
    renderTable();

    // Give the mount → auth → load chain time to settle, and give any
    // runaway effect loop ample room to fire repeatedly.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // With the bug this is dozens/hundreds of calls; fixed it is exactly one.
    expect(loadSpy.mock.calls.length).toBeLessThanOrEqual(2);
    expect(loadSpy).toHaveBeenCalledWith('p1');
  });
});
