/**
 * Row windowing (spec §4.6 size target): above the windowing threshold the
 * list mounts a window of rows, tells assistive tech the total through
 * aria-rowcount / aria-rowindex, and the keyboard cursor scrolls the window so
 * focus-follow still lands on the cursor row. The selection helpers act on the
 * visible set, not on the mounted rows. jsdom has no layout: the scroller's
 * `scrollTo` is stubbed to move `scrollTop` and fire `scroll`, over a fixed
 * `scrollHeight`.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {MemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));

import {ScreeningWorkspace} from '@/components/screening/ScreeningWorkspace';
import {HeaderActionsProvider} from '@/contexts/HeaderActionsContext';
import type {ScreeningConfigRead, ScreeningRecordRow} from '@/services/screeningService';
import {server} from '@/test/mocks/server';

const COUNT = 300;

const ROWS: ScreeningRecordRow[] = Array.from({length: COUNT}, (_, index) => ({
  article_id: `art${index}`,
  assignment_id: `as${index}`,
  phase: 'title_abstract',
  doi: null,
  first_author: 'Smith J',
  has_pdf: false,
  ingestion_source: 'pubmed',
  journal_title: 'Lancet',
  my_decision: null,
  my_exclusion_reason: null,
  outcome: null,
  outcome_exclusion_reason: null,
  outcome_kind: null,
  ta_outcome: null,
  ta_outcome_kind: null,
  ta_reviewer_count: null,
  pmid: null,
  publication_year: 2021,
  queue_rank: index + 1,
  status: 'to_screen',
  title: `Record ${index}`,
}));

const CONFIG: ScreeningConfigRead = {
  can_arbitrate: true,
  can_manage: true,
  can_review: true,
  enrolled: COUNT,
  exclusion_reasons: [],
  not_enrolled: 0,
  reviewer_capable: 2,
  reviewer_count: 2,
  reviewer_count_locked: true,
  full_text_reviewer_count: null,
  full_text_count_locked: false,
  full_text_ready: 0,
  full_text_enrolled: 0,
};

const originalScrollTo = HTMLElement.prototype.scrollTo;
/** The records the next read serves; a test reassigns it before a refetch. */
let served: ScreeningRecordRow[] = ROWS;

beforeEach(() => {
  served = ROWS;
  server.use(
    http.get('*/api/v1/projects/:projectId/screening/records', () =>
      HttpResponse.json({
        ok: true,
        data: {exclusion_reasons: [], inclusion_criteria: [], phase: 'title_abstract', removed_duplicate_ids: [], reviewer_count: 2, rows: served},
      }),
    ),
    http.get('*/api/v1/screening/assignments/:assignmentId', ({params}) => {
      const r = ROWS.find((candidate) => candidate.assignment_id === params.assignmentId);
      return HttpResponse.json({
        ok: true,
        data: {
          id: params.assignmentId,
          project_id: 'p1',
          status: 'awaiting_me',
          exclusion_reasons: [],
          article: {id: r?.article_id, title: r?.title, abstract: 'An abstract.', authors: [], doi: null, journal_title: null, pmid: null, publication_year: 2021},
          my_decision: null,
          outcome: null,
          peer_decisions: [],
        },
      });
    }),
  );
  // A scroll range, or the virtualizer clamps every scroll write to 0.
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {configurable: true, get: () => 100_000});
  HTMLElement.prototype.scrollTo = function scrollTo(this: HTMLElement, options?: ScrollToOptions | number) {
    const top = typeof options === 'object' ? (options.top ?? 0) : 0;
    Object.defineProperty(this, 'scrollTop', {configurable: true, value: top});
    // A browser fires `scroll` after the write, never inside it.
    setTimeout(() => this.dispatchEvent(new Event('scroll')), 0);
  } as typeof HTMLElement.prototype.scrollTo;
});

afterEach(() => {
  HTMLElement.prototype.scrollTo = originalScrollTo;
  delete (HTMLElement.prototype as {scrollHeight?: number}).scrollHeight;
});

function renderWorkspace() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  const view = render(
    <QueryClientProvider client={client}>
      <HeaderActionsProvider>
        <MemoryRouter initialEntries={['/projects/p1?tab=screening']}>
          <ScreeningWorkspace projectId="p1" config={CONFIG} phase="title_abstract" />
        </MemoryRouter>
      </HeaderActionsProvider>
    </QueryClientProvider>,
  );
  return {...view, client};
}

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('ScreeningRecordList — windowed rows', () => {
  it('mounts a window and announces the total row count', async () => {
    renderWorkspace();
    await screen.findByRole('button', {name: 'Record 0'});
    const table = screen.getByRole('table');
    expect(table).toHaveAttribute('aria-rowcount', String(COUNT + 1));
    const rows = bodyRows();
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.length).toBeLessThan(COUNT);
    expect(rows[0]).toHaveAttribute('aria-rowindex', '2');
    expect(screen.queryByRole('button', {name: `Record ${COUNT - 1}`})).toBeNull();
  });

  it('j past the mounted window scrolls it, focus follows, and Enter opens the cursor row', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const first = await screen.findByRole('button', {name: 'Record 0'});
    // Precondition: the target is outside the first window.
    expect(screen.queryByRole('button', {name: 'Record 60'})).toBeNull();
    first.focus();
    // 61 synchronous presses: userEvent's per-key async round trips exceed the
    // timeout under a loaded full-suite run.
    for (let step = 0; step <= 60; step++) fireEvent.keyDown(document.activeElement ?? document.body, {key: 'j'});
    const target = await screen.findByRole('button', {name: 'Record 60'});
    await waitFor(() => expect(document.activeElement).toBe(target));
    const cursor = document.querySelector('[data-cursor="true"]');
    expect(cursor).toHaveAttribute('data-record-row', 'art60');
    expect(cursor).toHaveAttribute('aria-rowindex', '62');

    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', {name: 'Record 60'})).toBeInTheDocument();
  });

  it('a cursor move to an unmounted row scrolls it in and focus lands on it, so Enter opens it', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('button', {name: 'Record 0'});
    // Scroll far down and focus a row there with no cursor yet (a Tab into the list).
    const scroller = screen.getByRole('table').parentElement?.parentElement as HTMLElement;
    scroller.scrollTo({top: 200 * 36});
    const far = await screen.findByRole('button', {name: 'Record 200'});
    expect(screen.queryByRole('button', {name: 'Record 0'})).toBeNull();
    far.focus();

    // No cursor: j puts it on the first visible row, which is not mounted.
    await user.keyboard('j');
    const first = await screen.findByRole('button', {name: 'Record 0'});
    await waitFor(() => expect(document.activeElement).toBe(first));
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', {name: 'Record 0'})).toBeInTheDocument();
  });

  it('the header checkbox checks every visible row, mounted or not', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('button', {name: 'Record 0'});
    await user.click(screen.getByRole('checkbox', {name: 'Select all records'}));
    expect(screen.getByText(`${COUNT} selected`)).toBeInTheDocument();
  });

  it('shift-click checks a range across rows that are not mounted', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('button', {name: 'Record 0'});
    await user.click(screen.getByRole('checkbox', {name: 'Select Record 0'}));
    const scroller = screen.getByRole('table').parentElement?.parentElement as HTMLElement;
    scroller.scrollTo({top: 200 * 36});
    await screen.findByRole('button', {name: 'Record 200'});
    // Precondition: the start of the range is no longer mounted.
    expect(screen.queryByRole('button', {name: 'Record 0'})).toBeNull();

    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('checkbox', {name: 'Select Record 200'}));
    await user.keyboard('{/Shift}');

    expect(screen.getByText('201 selected')).toBeInTheDocument();
  });

  it('a refetch that shifts the cursor row leaves focus where it is', async () => {
    const user = userEvent.setup();
    const {client} = renderWorkspace();
    const first = await screen.findByRole('button', {name: 'Record 0'});
    first.focus();
    await user.keyboard('j');
    expect(document.querySelector('[data-cursor="true"]')).toHaveAttribute('data-record-row', 'art0');
    const box = screen.getByRole('checkbox', {name: 'Select Record 3'});
    box.focus();

    // Record 0 moves to the fifth place in queue order: the cursor row's index changes.
    served = ROWS.map((r) => (r.article_id === 'art0' ? {...r, queue_rank: 5} : r.queue_rank <= 5 ? {...r, queue_rank: r.queue_rank - 1} : r));
    await client.invalidateQueries();
    await waitFor(() => expect(bodyRows()[4]).toHaveAttribute('data-record-row', 'art0'));

    expect(document.activeElement).toBe(box);
  });
});
