/**
 * ScreeningRecordList — the title/abstract record list: status views, search,
 * filters, sort, progress strip, columns by role, bulk enroll and export, the
 * kept-row rule, empty states and the narrow card layout. Real English copy.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {useState} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {toast} from 'sonner';

import {ScreeningRecordList} from '@/components/screening/ScreeningRecordList';
import {RECORD_CSV_COLUMNS, type StatusView} from '@/lib/screening/records';
import type {components} from '@/types/api/schema';
import {server} from '@/test/mocks/server';

type Row = components['schemas']['ScreeningRecordRow'];
type RecordsRead = components['schemas']['ScreeningRecordsRead'];
type ConfigRead = components['schemas']['ScreeningConfigRead'];

const ENROLL_URL = '*/api/v1/projects/:projectId/screening/enroll';

function row(rank: number, overrides: Partial<Row>): Row {
  return {
    article_id: `a${rank}`,
    assignment_id: `as${rank}`,
    doi: null,
    first_author: null,
    has_pdf: false,
    ingestion_source: null,
    journal_title: null,
    my_decision: null,
    my_exclusion_reason: null,
    outcome: null,
    outcome_exclusion_reason: null,
    outcome_kind: null,
    pmid: null,
    publication_year: null,
    queue_rank: rank,
    status: 'to_screen',
    title: `Title ${rank}`,
    ...overrides,
  };
}

const R1 = row(1, {
  title: 'Sepsis bundles in adults', first_author: 'Rivers', journal_title: 'NEJM', publication_year: 2001,
  pmid: '11111', doi: '10.1/sep', ingestion_source: 'pubmed',
});
const R2 = row(2, {
  title: 'Asthma in children', first_author: 'Smith', journal_title: 'Lancet', publication_year: 2015,
  ingestion_source: 'ris',
});
const R3 = row(3, {
  title: 'Beta blockers after MI', first_author: 'Jones', journal_title: 'JAMA', publication_year: 2010,
  status: 'waiting', my_decision: 'include', ingestion_source: 'pubmed',
});
const R4 = row(4, {
  title: 'Delirium prevention', first_author: 'Inouye', journal_title: 'BMJ', publication_year: 1999,
  status: 'in_review', my_decision: 'exclude', my_exclusion_reason: 'Wrong population', ingestion_source: 'pubmed',
});
const R5 = row(5, {
  title: 'Early goal-directed therapy', first_author: 'Rivers', journal_title: 'NEJM', publication_year: 2008,
  status: 'included', my_decision: 'include', outcome: 'include', outcome_kind: 'consensus',
  ingestion_source: 'pubmed',
});
const R6 = row(6, {
  title: 'Cohort of nurses', first_author: 'Adams', journal_title: 'BMJ', publication_year: null,
  status: 'excluded', my_decision: 'exclude', my_exclusion_reason: 'Wrong outcome', outcome: 'exclude',
  outcome_exclusion_reason: 'Wrong design', outcome_kind: 'arbitrated', ingestion_source: 'pubmed',
});
const R7 = row(7, {
  title: 'Zinc for colds', first_author: 'Brown', journal_title: 'Cochrane', publication_year: 2020,
  status: 'maybe', my_decision: 'maybe', ingestion_source: 'ris',
});
const R8 = row(8, {
  title: 'Gut microbiome', publication_year: 2022, status: 'not_enrolled', assignment_id: null,
  ingestion_source: 'manual',
});
const R9 = row(9, {
  title: 'Hand hygiene', first_author: 'Semmelweis', publication_year: 2018, status: 'not_enrolled',
  assignment_id: null,
});
const ROWS = [R1, R2, R3, R4, R5, R6, R7, R8, R9];
const QUEUE_TITLES = ROWS.map((r) => r.title);

function records(rows: Row[] = ROWS): RecordsRead {
  return {
    exclusion_reasons: ['Wrong population', 'Wrong design', 'Wrong outcome'],
    inclusion_criteria: [],
    phase: 'title_abstract',
    reviewer_count: 2,
    rows,
  };
}

function config(overrides: Partial<ConfigRead> = {}): ConfigRead {
  return {
    can_arbitrate: false,
    can_manage: false,
    can_review: true,
    enrolled: 7,
    exclusion_reasons: [],
    not_enrolled: 2,
    reviewer_capable: 2,
    reviewer_count: 2,
    reviewer_count_locked: true,
    ...overrides,
  };
}

const MANAGER = config({can_manage: true, can_review: true, can_arbitrate: true});
const REVIEWER = config();
const VIEWER = config({can_review: false});

const NO_KEPT: ReadonlySet<string> = new Set();
const noop = () => {};

interface HostProps {
  read?: RecordsRead;
  cfg?: ConfigRead;
  initialStatus?: StatusView;
  activeArticleId?: string | null;
  keepArticleIds?: ReadonlySet<string>;
  onOpenRow?: (row: Row) => void;
  onFiltersChange?: () => void;
  onVisibleRowsChange?: (rows: Row[]) => void;
  initialChecked?: ReadonlySet<string>;
}

function Host({
  read = records(),
  cfg = REVIEWER,
  initialStatus = 'all',
  activeArticleId = null,
  keepArticleIds = NO_KEPT,
  onOpenRow = noop,
  onFiltersChange = noop,
  onVisibleRowsChange,
  initialChecked = NO_KEPT,
}: HostProps) {
  const [status, setStatus] = useState<StatusView>(initialStatus);
  const [checked, setChecked] = useState<ReadonlySet<string>>(initialChecked);
  return (
    <ScreeningRecordList
      projectId="p1"
      read={read}
      config={cfg}
      status={status}
      onStatusChange={setStatus}
      activeArticleId={activeArticleId}
      cursorArticleId={null}
      onOpenRow={onOpenRow}
      checkedIds={checked}
      onCheckedChange={setChecked}
      onToggleRow={(r) => {
        const next = new Set(checked);
        if (next.has(r.article_id)) next.delete(r.article_id);
        else next.add(r.article_id);
        setChecked(next);
      }}
      toolbarActions={null}
      onVisibleRowsChange={onVisibleRowsChange}
      keepArticleIds={keepArticleIds}
      onFiltersChange={onFiltersChange}
    />
  );
}

function renderList(props: HostProps = {}) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  return render(
    <QueryClientProvider client={client}>
      <Host {...props} />
    </QueryClientProvider>,
  );
}

/** Titles of the listed table rows, in display order. */
function listedTitles(): string[] {
  const table = screen.getByRole('table');
  const [, ...body] = within(table).getAllByRole('row');
  return body.map((r) => within(r).getByRole('button').textContent ?? '');
}

const titlesOf = (...rows: Row[]) => rows.map((r) => r.title);

async function openFilters(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', {name: 'Filter'}));
}

async function pickOption(user: ReturnType<typeof userEvent.setup>, fieldLabel: string, ...options: string[]) {
  await user.click(screen.getByLabelText(fieldLabel));
  for (const option of options) await user.click(screen.getByRole('checkbox', {name: option}));
}

async function check(user: ReturnType<typeof userEvent.setup>, ...rows: Row[]) {
  for (const r of rows) await user.click(screen.getByRole('checkbox', {name: `Select ${r.title}`}));
}

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('ScreeningRecordList', () => {
  it('shows each status view with its count and hides Conflict and Not enrolled at 0', async () => {
    const first = renderList();
    const names = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(names).toEqual([
      'All 9', 'To screen 2', 'Waiting for others 1', 'In review 1', 'Included 1', 'Excluded 1', 'Maybe 1',
      'Not enrolled 2',
    ]);
    expect(screen.queryByRole('tab', {name: /Reviewers disagree/})).toBeNull();
    expect(screen.getByRole('tab', {name: 'All 9'})).toHaveAttribute('aria-selected', 'true');
    first.unmount();

    renderList({read: records([R1, R2, R3, R4, R5, R6])});
    expect(screen.queryByRole('tab', {name: /Not enrolled/})).toBeNull();
    const maybe = screen.getByRole('tab', {name: 'Maybe 0'});
    expect(maybe.className).toContain('text-muted-foreground/60');

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', {name: 'To screen 2'}));
    expect(screen.getByRole('tab', {name: 'To screen 2'})).toHaveAttribute('aria-selected', 'true');
    expect(listedTitles()).toEqual(titlesOf(R1, R2));
  });

  it('keeps the active Conflict view visible at 0', () => {
    renderList({read: records([R1, R2, R3]), initialStatus: 'conflict'});
    const tab = screen.getByRole('tab', {name: 'Reviewers disagree 0'});
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No records in this view')).toBeInTheDocument();
  });

  it('lists "No records in this view" for a view with 0', () => {
    renderList({read: records([R1, R2, R3]), initialStatus: 'maybe'});
    expect(screen.getByText('No records in this view')).toBeInTheDocument();
    expect(screen.queryByText('No records match')).toBeNull();
  });

  it('searches title, author, journal, PMID and DOI', async () => {
    const user = userEvent.setup();
    renderList();
    const search = screen.getByPlaceholderText('Search records…');
    for (const [needle, expected] of [
      ['asthma', titlesOf(R2)],
      ['inouye', titlesOf(R4)],
      ['lancet', titlesOf(R2)],
      ['11111', titlesOf(R1)],
      ['10.1/sep', titlesOf(R1)],
    ] as const) {
      await user.clear(search);
      await user.type(search, needle);
      expect(listedTitles()).toEqual(expected);
    }
  });

  it('filters by title', async () => {
    const user = userEvent.setup();
    renderList();
    await openFilters(user);
    await user.type(screen.getByLabelText('Title'), 'zinc');
    expect(listedTitles()).toEqual(titlesOf(R7));
  });

  it('filters by authors', async () => {
    const user = userEvent.setup();
    renderList();
    await openFilters(user);
    await user.type(screen.getByLabelText('Authors'), 'rivers');
    expect(listedTitles()).toEqual(titlesOf(R1, R5));
  });

  it('filters by journal', async () => {
    const user = userEvent.setup();
    renderList();
    await openFilters(user);
    await user.type(screen.getByLabelText('Journal'), 'bmj');
    expect(listedTitles()).toEqual(titlesOf(R4, R6));
  });

  it('filters by year range', async () => {
    const user = userEvent.setup();
    renderList();
    await openFilters(user);
    const [from, to] = within(screen.getByRole('dialog')).getAllByRole('combobox');
    await user.click(from);
    await user.click(screen.getByRole('option', {name: '2010'}));
    await user.click(to);
    await user.click(screen.getByRole('option', {name: '2018'}));
    expect(listedTitles()).toEqual(titlesOf(R2, R3, R9));
  });

  it('filters by my decision incl. not decided', async () => {
    const user = userEvent.setup();
    renderList();
    await openFilters(user);
    await pickOption(user, 'My decision', 'Not decided', 'Maybe');
    expect(listedTitles()).toEqual(titlesOf(R1, R2, R7, R8, R9));
  });

  it('filters by exclusion reason on mine or the outcome', async () => {
    const user = userEvent.setup();
    renderList();
    await openFilters(user);
    await pickOption(user, 'Exclusion reason', 'Wrong design');
    expect(listedTitles()).toEqual(titlesOf(R6));
    await user.click(screen.getByRole('checkbox', {name: 'Wrong population'}));
    expect(listedTitles()).toEqual(titlesOf(R4, R6));
  });

  it('filters by source', async () => {
    const user = userEvent.setup();
    renderList();
    await openFilters(user);
    await pickOption(user, 'Source', 'RIS', 'Manual');
    expect(listedTitles()).toEqual(titlesOf(R2, R7, R8));
  });

  it('sorts by queue order by default, then title, year and status', async () => {
    const user = userEvent.setup();
    renderList();
    expect(listedTitles()).toEqual(QUEUE_TITLES);

    const sortBy = async (label: string) => {
      await user.click(screen.getByRole('button', {name: 'Sort and display'}));
      await user.click(within(screen.getByRole('dialog')).getByRole('combobox'));
      await user.click(screen.getByRole('option', {name: label}));
      await user.keyboard('{Escape}');
    };
    await sortBy('Title');
    expect(listedTitles()).toEqual(titlesOf(R2, R3, R6, R4, R5, R8, R9, R1, R7));
    await sortBy('Year');
    expect(listedTitles()).toEqual(titlesOf(R4, R1, R5, R3, R2, R9, R7, R8, R6));
    await sortBy('Status');
    expect(listedTitles()).toEqual(titlesOf(R1, R2, R4, R3, R7, R5, R6, R8, R9));
  });

  it('hides the Mine column and the My decision filter for non-reviewers', async () => {
    const user = userEvent.setup();
    const reviewer = renderList({cfg: REVIEWER});
    expect(screen.getByRole('columnheader', {name: 'Mine'})).toBeInTheDocument();
    await openFilters(user);
    expect(screen.getByLabelText('My decision')).toBeInTheDocument();
    reviewer.unmount();

    renderList({cfg: config({can_manage: true, can_review: false})});
    expect(screen.queryByRole('columnheader', {name: 'Mine'})).toBeNull();
    await openFilters(user);
    expect(screen.queryByLabelText('My decision')).toBeNull();
    expect(screen.getByLabelText('Source')).toBeInTheDocument();
  });

  it('cmd+A in the To screen view checks only the visible rows', async () => {
    const user = userEvent.setup();
    renderList({initialStatus: 'to_screen'});
    expect(listedTitles()).toEqual(titlesOf(R1, R2));
    await user.keyboard('{Meta>}a{/Meta}');
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('cmd+A under a search checks only the visible rows of the status view', async () => {
    const user = userEvent.setup();
    renderList({initialStatus: 'to_screen'});
    await user.type(screen.getByPlaceholderText(/search/i), R1.title);
    expect(listedTitles()).toEqual(titlesOf(R1));
    await user.click(document.body);
    await user.keyboard('{Meta>}a{/Meta}');
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('"N selected" ignores a checked id no longer in the rows', () => {
    renderList({initialChecked: new Set([R1.article_id, 'gone-article'])});
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('a viewer gets no write controls', async () => {
    const user = userEvent.setup();
    renderList({cfg: VIEWER});
    await check(user, R1, R8);
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Export selected'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Enroll selected'})).toBeNull();
    expect(screen.queryByRole('columnheader', {name: 'Mine'})).toBeNull();
    await openFilters(user);
    expect(screen.queryByLabelText('My decision')).toBeNull();
  });

  it('keeps a kept article in the To screen view and calls onFiltersChange on a search edit', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    renderList({initialStatus: 'to_screen', keepArticleIds: new Set([R5.article_id]), onFiltersChange});
    expect(listedTitles()).toEqual(titlesOf(R1, R2, R5));
    const kept = screen.getByRole('button', {name: R5.title}).closest('tr')!;
    expect(within(kept).getByText('Included')).toBeInTheDocument();
    expect(screen.getByRole('tab', {name: 'To screen 2'})).toBeInTheDocument();

    expect(onFiltersChange).not.toHaveBeenCalled();
    await user.type(screen.getByPlaceholderText('Search records…'), 'e');
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
  });

  it('shows "X of N decided · you: M left" and no full-text segment', () => {
    const reviewer = renderList();
    expect(screen.getByText('3 of 7 decided · you: 2 left')).toBeInTheDocument();
    expect(screen.queryByText(/full.text/i)).toBeNull();
    reviewer.unmount();

    renderList({cfg: VIEWER});
    expect(screen.getByText('3 of 7 decided')).toBeInTheDocument();
  });

  it('marks an arbitrated outcome on its status chip', () => {
    renderList();
    const arbitrated = screen.getByRole('button', {name: R6.title}).closest('tr')!;
    expect(within(arbitrated).getByText('Arbitrated')).toBeInTheDocument();
    const consensus = screen.getByRole('button', {name: R5.title}).closest('tr')!;
    expect(within(consensus).queryByText('Arbitrated')).toBeNull();
  });

  it('tints the active row and opens a row on click', async () => {
    const user = userEvent.setup();
    const onOpenRow = vi.fn();
    renderList({activeArticleId: R2.article_id, onOpenRow});
    const active = screen.getByRole('button', {name: R2.title}).closest('tr')!;
    expect(active).toHaveAttribute('data-state', 'selected');
    expect(active.className).toContain('bg-muted/60');
    const other = screen.getByRole('button', {name: R3.title}).closest('tr')!;
    expect(other).not.toHaveAttribute('data-state', 'selected');

    await user.click(screen.getByRole('button', {name: R3.title}));
    expect(onOpenRow).toHaveBeenCalledTimes(1);
    expect(onOpenRow).toHaveBeenCalledWith(R3);

    await user.click(screen.getByRole('checkbox', {name: `Select ${R4.title}`}));
    expect(onOpenRow).toHaveBeenCalledTimes(1);
  });

  it('reports the visible rows in display order', async () => {
    const user = userEvent.setup();
    const onVisibleRowsChange = vi.fn();
    renderList({onVisibleRowsChange});
    expect(onVisibleRowsChange).toHaveBeenLastCalledWith(ROWS);
    await user.type(screen.getByPlaceholderText('Search records…'), 'rivers');
    expect(onVisibleRowsChange).toHaveBeenLastCalledWith([R1, R5]);
  });

  it('Enroll selected posts only the checked not-enrolled ids (manager only)', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(
      http.post(ENROLL_URL, async ({request}) => {
        bodies.push(await request.json());
        return HttpResponse.json({ok: true, data: {enrolled: 2, already_enrolled: 0}});
      }),
    );
    const manager = renderList({cfg: MANAGER});
    await check(user, R1, R8, R9);
    await user.click(screen.getByRole('button', {name: 'Enroll selected'}));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('2 articles enrolled'));
    expect(bodies).toEqual([{article_ids: [R8.article_id, R9.article_id]}]);
    expect(screen.queryByText(/selected$/)).toBeNull();
    manager.unmount();

    renderList({cfg: MANAGER});
    await check(user, R1);
    expect(screen.getByRole('button', {name: 'Enroll selected'})).toBeDisabled();
  });

  it('hides Enroll selected from a reviewer', async () => {
    const user = userEvent.setup();
    renderList({cfg: REVIEWER});
    await check(user, R8, R9);
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Enroll selected'})).toBeNull();
  });

  describe('Export selected', () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:records');
    const revokeObjectURL = vi.fn();
    const originals = {create: URL.createObjectURL, revoke: URL.revokeObjectURL};
    beforeEach(() => {
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
      createObjectURL.mockClear();
      revokeObjectURL.mockClear();
    });
    afterEach(() => {
      URL.createObjectURL = originals.create;
      URL.revokeObjectURL = originals.revoke;
    });

    it('downloads CSV with the row fields and no abstract', async () => {
      const user = userEvent.setup();
      const clicks: string[] = [];
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push(this.download);
      });
      renderList();
      await check(user, R2, R6);
      await user.click(screen.getByRole('button', {name: 'Export selected'}));

      expect(clicks).toEqual(['screening-records.csv']);
      const blob = createObjectURL.mock.calls[0][0];
      const lines = (await blob.text()).split('\r\n');
      expect(lines[0]).toBe(RECORD_CSV_COLUMNS.join(','));
      expect(lines[0]).not.toContain('abstract');
      expect(lines).toHaveLength(3);
      expect(lines[1].startsWith(`${R2.article_id},`)).toBe(true);
      expect(lines[2].startsWith(`${R6.article_id},`)).toBe(true);
      click.mockRestore();
    });

    it('revokes the object URL only after the click has returned', async () => {
      const user = userEvent.setup();
      let revokedBeforeNextTask: number | null = null;
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
        queueMicrotask(() => {
          revokedBeforeNextTask = revokeObjectURL.mock.calls.length;
        });
      });
      renderList();
      await check(user, R2);
      await user.click(screen.getByRole('button', {name: 'Export selected'}));

      await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:records'));
      expect(revokedBeforeNextTask).toBe(0);
      click.mockRestore();
    });
  });

  it('shows "No records match" and clears filters', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    renderList({onFiltersChange});
    await user.type(screen.getByPlaceholderText('Search records…'), 'zzz');
    expect(screen.getByText('No records match')).toBeInTheDocument();
    onFiltersChange.mockClear();

    await user.click(screen.getByRole('button', {name: 'Clear filters'}));
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText('Search records…')).toHaveValue('');
    expect(listedTitles()).toEqual(QUEUE_TITLES);
  });

  describe('below sm', () => {
    const original = window.matchMedia;
    beforeEach(() => {
      window.matchMedia = ((query: string) => ({
        matches: query === '(max-width: 639px)',
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as typeof window.matchMedia;
    });
    afterEach(() => {
      window.matchMedia = original;
    });

    it('renders cards below sm', async () => {
      const user = userEvent.setup();
      const onOpenRow = vi.fn();
      renderList({onOpenRow});
      expect(screen.queryByRole('table')).toBeNull();
      for (const r of ROWS) expect(screen.getByRole('button', {name: r.title})).toBeInTheDocument();
      await user.click(screen.getByRole('button', {name: R7.title}));
      expect(onOpenRow).toHaveBeenCalledWith(R7);
      expect(screen.getByRole('checkbox', {name: `Select ${R7.title}`})).toBeInTheDocument();
    });
  });
});
