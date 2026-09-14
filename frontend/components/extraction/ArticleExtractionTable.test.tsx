/**
 * Regression test for the "extraction view stuck on the loading skeleton"
 * outage.
 *
 * Root cause: the initial-load effect listed the `loadArticles` function
 * identity in its dependency array. `loadArticles` calls
 * `setArticles(newArray)` + `setLoading`, which forces a re-render every time
 * it runs. After #270 removed its `useCallback`, the React Compiler did not
 * stabilise the plain async function for the purposes of that array, so each
 * render produced a new identity → the effect re-fired → `loadArticles` ran
 * again → ... an unbounded fetch loop that kept `loading === true` forever
 * (the skeleton never cleared). Production fired the same `articles` request
 * 383× in a few seconds.
 *
 * Today the effect keys on `[projectId, templateId, userId]` only, where
 * `userId` is the resolved caller from `useCallerArticleProgress` (driven here
 * by the mocked `useAuth`). This test pins the contract: mounting the table
 * triggers the article load once, not in a loop. It keeps the component in
 * its skeleton branch (structure still loading) so the load effect runs
 * without rendering the full table.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadSpy, useAuthMock, structure, values, structureRefetch, valuesRefetch } = vi.hoisted(() => ({
  loadSpy: vi.fn(), useAuthMock: vi.fn(), structureRefetch: vi.fn(), valuesRefetch: vi.fn(),
  structure: { isLoading: true, isError: false }, values: { isLoading: false, isError: false },
}));
const AUTH_USER = { user: { id: 'user-1' }, loading: false };

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

vi.mock('@/services/articlesService', () => ({
  loadExtractionTableArticles: (...args: unknown[]) => loadSpy(...args),
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => useAuthMock() }));

// Keep entity-types "loading" so the component stays in its skeleton branch:
// the load effect still runs, we just avoid rendering the full table. The
// mock also keeps the import chain away from the supabase client, which
// crashes in CI where no VITE_SUPABASE_URL env exists.
vi.mock('@/hooks/extraction/useActiveTemplateStructure', () => ({
  useActiveTemplateStructure: () => ({ entityTypes: [], error: null, refetch: structureRefetch, ...structure }),
}));
vi.mock('@/hooks/extraction/useArticleExtractionValues', () => ({
  useArticleExtractionValues: () => ({ valuesByArticle: new Map(), isUnavailable: false, refetch: valuesRefetch, ...values }),
}));

vi.mock('@/hooks/extraction/useFullAIExtraction', () => ({
  useFullAIExtraction: () => ({ extractFullAI: vi.fn(), loading: false }),
}));

import { ArticleExtractionTable } from '@/components/extraction/ArticleExtractionTable';

function renderTable(toolbarActions?: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = () => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><ArticleExtractionTable projectId="p1" templateId="t1" toolbarActions={toolbarActions} /></MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(ui());
  return { rerender: () => view.rerender(ui()) };
}

beforeEach(() => {
  vi.clearAllMocks();
  structure.isLoading = true;
  useAuthMock.mockReturnValue(AUTH_USER); structure.isError = false; Object.assign(values, { isLoading: false, isError: false });
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

describe('ArticleExtractionTable → rows', () => {
  it('opens a row through a stretched button, never a role="button" row around other controls', async () => {
    structure.isLoading = false;
    renderTable();

    // `t` is mocked to echo the key, so the control's name is the key itself.
    const control = await screen.findByRole('button', { name: 'tableOpenRowAria' });
    const row = screen.getByTestId('extraction-row-a1');

    expect(row).not.toHaveAttribute('role', 'button');
    expect(row).not.toHaveAttribute('tabindex');
    expect(control.parentElement?.closest('button, [role="button"]')).toBeNull();
    for (const nested of within(row).getAllByRole('checkbox')) {
      expect(nested.parentElement?.closest('button, [role="button"]')).toBeNull();
    }
    expect(within(row).getByRole('button', { name: 'tableStart' })).toBeInTheDocument();
  });
});

describe('ArticleExtractionTable → progress states', () => {
  beforeEach(() => { structure.isLoading = false; });
  // A11: the retry refetches ONLY the query that failed.
  it.each([
    ['renders the error state when progress fails', values, valuesRefetch, structureRefetch],
    ['renders the error state when the structure fails', structure, structureRefetch, valuesRefetch],
  ])('%s', async (_name, failing, failedRefetch, otherRefetch) => {
    failing.isError = true;
    renderTable();
    expect(await screen.findByText('errorLoadProgress')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'errorTryAgain' }));
    expect(failedRefetch).toHaveBeenCalledTimes(1);
    expect(otherRefetch).not.toHaveBeenCalled();
  });
  it('keeps the toolbar actions rendered while progress loads', async () => {
    values.isLoading = true;
    renderTable(<button type="button">toolbar-action</button>);
    expect(await screen.findByRole('button', { name: 'toolbar-action' })).toBeInTheDocument();
    expect(screen.getByTestId('extraction-table-loading')).toBeInTheDocument();
  });
  it('shows the skeleton while the user lookup is resolving', async () => {
    useAuthMock.mockReturnValue({ user: null, loading: true });
    const view = renderTable();
    expect(screen.getByTestId('extraction-table-loading')).toBeInTheDocument();
    expect(screen.queryByText('progressUnavailable')).toBeNull();
    expect(loadSpy).not.toHaveBeenCalled();
    // Precondition: the same mount loads once auth resolves, so the skeleton was auth's.
    useAuthMock.mockReturnValue(AUTH_USER);
    view.rerender();
    await waitFor(() => expect(loadSpy).toHaveBeenCalledWith('p1'));
  });
  it('renders progress unavailable once the lookup resolves with no user', async () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    renderTable();
    expect(await screen.findByText('progressUnavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'errorTryAgain' })).toBeNull();
    expect(loadSpy).not.toHaveBeenCalled();
  });
});
