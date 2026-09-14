/**
 * Row interaction contract for the HITL worklist table.
 *
 * The whole row opens the article, but the row itself is not a control: a
 * stretched overlay button in the title cell is (WAI-ARIA forbids a
 * `role="button"` row that contains the Start/View/Continue action button).
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { t } from '@/lib/copy';

const { progressById, useAuthMock, structure, values, structureRefetch, valuesRefetch } = vi.hoisted(() => ({
  progressById: new Map<string, number>(), useAuthMock: vi.fn(), structureRefetch: vi.fn(), valuesRefetch: vi.fn(),
  structure: { isLoading: false, isError: false }, values: { isLoading: false, isError: false },
}));
const AUTH_USER = { user: { id: 'user-1' }, loading: false };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => useAuthMock() }));

vi.mock('@/services/articlesService', () => ({
  fetchProjectArticles: async () => ({
    ok: true,
    data: [
      { id: 'a-new', title: 'Fresh article', authors: [], publication_year: null, created_at: '2026-01-03T00:00:00Z' },
      { id: 'a-wip', title: 'Half done', authors: ['Doe'], publication_year: 2024, created_at: '2026-01-02T00:00:00Z' },
      { id: 'a-done', title: 'All done', authors: ['Roe'], publication_year: 2023, created_at: '2026-01-01T00:00:00Z' },
    ],
  }),
}));

vi.mock('@/hooks/extraction/useActiveTemplateStructure', () => ({
  useActiveTemplateStructure: () => ({ entityTypes: [], error: null, refetch: structureRefetch, ...structure }),
}));
vi.mock('@/hooks/extraction/useArticleExtractionValues', () => ({
  useArticleExtractionValues: () => ({
    valuesByArticle: new Map([
      ['a-wip', { instances: [{ id: 'i1' }], values: 'a-wip' }],
      ['a-done', { instances: [{ id: 'i2' }], values: 'a-done' }],
    ]),
    isUnavailable: false, refetch: valuesRefetch, ...values,
  }),
}));

// Progress is keyed by the article id smuggled through `values`, so each row
// lands in a known Start / Continue / View state.
vi.mock('@/lib/qa/scopedProgress', () => ({
  scopedRowProgress: (_s: unknown, _e: unknown, _i: unknown, values: string) =>
    progressById.get(values) ?? 0,
}));

import { HITLArticleTable } from '@/components/hitl/HITLArticleTable';

function LocationProbe() {
  return <div data-testid="probe-pathname">{useLocation().pathname}</div>;
}

function renderTable(toolbarActions?: ReactNode) {
  const ui = () => (
    <MemoryRouter initialEntries={['/list']}>
      <Routes>
        <Route path="/list" element={<HITLArticleTable kind="quality_assessment" projectId="p1" templateId="t1"
          rowActionHref={(articleId, templateId) => `/qa/${articleId}/${templateId}`} toolbarActions={toolbarActions} />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
  const view = render(ui());
  return { rerender: () => view.rerender(ui()) };
}

const openControl = (title: string) =>
  screen.findByRole('button', { name: `Open assessment for ${title}` });

beforeEach(() => {
  vi.clearAllMocks(); useAuthMock.mockReturnValue(AUTH_USER); Object.assign(structure, { isLoading: false, isError: false }); Object.assign(values, { isLoading: false, isError: false });
  progressById.clear();
  progressById.set('a-wip', 40);
  progressById.set('a-done', 100);
});

describe('HITLArticleTable rows', () => {
  it('opens the article when the row control is clicked', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(await openControl('Half done'));

    await waitFor(() =>
      expect(screen.getByTestId('probe-pathname')).toHaveTextContent('/qa/a-wip/t1'),
    );
  });

  it.each([['{Enter}'], [' ']])('opens the article from the keyboard (%s)', async (key) => {
    const user = userEvent.setup();
    renderTable();

    (await openControl('All done')).focus();
    await user.keyboard(key);

    await waitFor(() =>
      expect(screen.getByTestId('probe-pathname')).toHaveTextContent('/qa/a-done/t1'),
    );
  });

  it('does not nest the action button inside another control', async () => {
    renderTable();
    const control = await openControl('Half done');
    const row = screen.getByTestId('hitl-quality_assessment-row-a-wip');

    expect(row).not.toHaveAttribute('role', 'button');
    expect(row).not.toHaveAttribute('tabindex');
    expect(within(control).queryByRole('button')).toBeNull();
    expect(control.parentElement?.closest('button, [role="button"]')).toBeNull();
    expect(
      screen.getByTestId('hitl-quality_assessment-row-action-a-wip').parentElement?.closest('button, [role="button"]'),
    ).toBeNull();
  });

  it('labels the action Start, Continue or View by progress', async () => {
    renderTable();
    await openControl('Fresh article');

    const action = (id: string) =>
      screen.getByTestId(`hitl-quality_assessment-row-action-${id}`);
    expect(action('a-new')).toHaveAccessibleName('Start');
    expect(action('a-wip')).toHaveAccessibleName('Continue');
    expect(action('a-done')).toHaveAccessibleName('View');
  });

  it('shows an em dash for missing authors and year', async () => {
    renderTable();
    await openControl('Fresh article');

    const row = screen.getByTestId('hitl-quality_assessment-row-a-new');
    expect(within(row).getAllByText('—')).toHaveLength(2);
    expect(within(row).queryByText('N/A')).toBeNull();
  });
});

describe('HITLArticleTable progress states', () => {
  const LOADING = 'hitl-quality_assessment-table-loading';
  const retryName = t('patterns', 'errorTryAgain');
  // A11: the retry refetches ONLY the query that failed.
  it.each([
    ['renders the error state when progress fails', values, valuesRefetch, structureRefetch],
    ['renders the error state when the structure fails', structure, structureRefetch, valuesRefetch],
  ])('%s', async (_name, failing, failedRefetch, otherRefetch) => {
    failing.isError = true;
    renderTable();
    expect(await screen.findByText(t('extraction', 'errorLoadProgress'))).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: retryName }));
    expect(failedRefetch).toHaveBeenCalledTimes(1);
    expect(otherRefetch).not.toHaveBeenCalled();
  });
  it('keeps the toolbar actions rendered while progress loads', async () => {
    values.isLoading = true;
    renderTable(<button type="button">toolbar-action</button>);
    expect(await screen.findByRole('button', { name: 'toolbar-action' })).toBeInTheDocument();
    expect(screen.getByTestId(LOADING)).toBeInTheDocument();
  });
  it('shows the skeleton while the user lookup is resolving', async () => {
    useAuthMock.mockReturnValue({ user: null, loading: true });
    const view = renderTable();
    expect(screen.getByTestId(LOADING)).toBeInTheDocument();
    expect(screen.queryByText(t('extraction', 'progressUnavailable'))).toBeNull();
    useAuthMock.mockReturnValue(AUTH_USER); // precondition: rows arrive once auth resolves
    view.rerender();
    expect(await openControl('Half done')).toBeInTheDocument();
  });
  it('renders progress unavailable once the lookup resolves with no user', async () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    renderTable();
    expect(await screen.findByText(t('extraction', 'progressUnavailable'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: retryName })).toBeNull();
  });
});
