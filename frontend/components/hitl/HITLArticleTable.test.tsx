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

const { progressById } = vi.hoisted(() => ({
  progressById: new Map<string, number>(),
}));

vi.mock('@/services/authService', () => ({
  getCurrentUserId: async () => ({ ok: true, data: 'user-1' }),
}));

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
  useActiveTemplateStructure: () => ({ entityTypes: [], isLoading: false, isError: false }),
}));

vi.mock('@/hooks/extraction/useArticleExtractionValues', () => ({
  useArticleExtractionValues: () => ({
    valuesByArticle: new Map([
      ['a-wip', { instances: [{ id: 'i1' }], values: 'a-wip' }],
      ['a-done', { instances: [{ id: 'i2' }], values: 'a-done' }],
    ]),
    isLoading: false,
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

function renderTable() {
  render(
    <MemoryRouter initialEntries={['/list']}>
      <Routes>
        <Route
          path="/list"
          element={
            <HITLArticleTable
              kind="quality_assessment"
              projectId="p1"
              templateId="t1"
              rowActionHref={(articleId, templateId) => `/qa/${articleId}/${templateId}`}
            />
          }
        />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const openControl = (title: string) =>
  screen.findByRole('button', { name: `Open assessment for ${title}` });

beforeEach(() => {
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
