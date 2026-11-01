/**
 * TitleAbstractWorkspace — the title/abstract list + docked panel (spec §4,
 * §4.1, §4.2, §4.4, §4.6): every list-level state with the toolbar, the
 * role-based default view, decided rows staying in the current view, the URL
 * selection (`?article=`, a legacy `?assignment=`, a miss), "Start screening"
 * and the shell's Escape chain.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {MemoryRouter, useLocation} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));
vi.mock('sonner', () => ({toast: Object.assign(vi.fn(), {success: vi.fn(), error: vi.fn()})}));

import {toast} from 'sonner';

import {TitleAbstractWorkspace} from '@/components/screening/TitleAbstractWorkspace';
import {HeaderActionsProvider} from '@/contexts/HeaderActionsContext';
import {screeningKeys} from '@/lib/query-keys/screening';
import type {
  ScreeningAssignmentRead,
  ScreeningConfigRead,
  ScreeningRecordRow,
  ScreeningRecordsRead,
} from '@/services/screeningService';
import {server} from '@/test/mocks/server';

const RECORDS_URL = '*/api/v1/projects/:projectId/screening/records';
const ASSIGNMENT_URL = '*/api/v1/screening/assignments/:assignmentId';
const DECIDE_URL = '*/api/v1/screening/assignments/:assignmentId/decisions';
const ARBITRATE_URL = '*/api/v1/screening/assignments/:assignmentId/arbitration';
const ENROLL_URL = '*/api/v1/projects/:projectId/screening/enroll';

const ok = (data: unknown) => HttpResponse.json({ok: true, data});
const fail = (status: number, code: string) =>
  HttpResponse.json({ok: false, error: {code, message: code}}, {status});

function row(overrides: Partial<ScreeningRecordRow> = {}): ScreeningRecordRow {
  return {
    article_id: 'art1',
    assignment_id: 'a1',
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
    pmid: null,
    publication_year: 2021,
    queue_rank: 1,
    status: 'to_screen',
    title: 'Alpha trial',
    ...overrides,
  };
}

const ALPHA = row();
const BETA = row({article_id: 'art2', assignment_id: 'a2', queue_rank: 2, title: 'Beta cohort'});
const GAMMA = row({
  article_id: 'art3',
  assignment_id: 'a3',
  queue_rank: 3,
  title: 'Gamma review',
  status: 'included',
  my_decision: 'include',
  outcome: 'include',
});
const notEnrolled = (r: ScreeningRecordRow): ScreeningRecordRow => ({
  ...r,
  assignment_id: null,
  status: 'not_enrolled',
  my_decision: null,
  outcome: null,
});

const REVIEWER = {can_manage: false, can_review: true, can_arbitrate: false};
const MANAGER = {can_manage: true, can_review: true, can_arbitrate: true};
const CONSENSUS = {can_manage: false, can_review: true, can_arbitrate: true};
const VIEWER = {can_manage: false, can_review: false, can_arbitrate: false};

function config(overrides: Partial<ScreeningConfigRead> = {}): ScreeningConfigRead {
  return {
    ...REVIEWER,
    enrolled: 3,
    exclusion_reasons: [],
    not_enrolled: 0,
    reviewer_capable: 2,
    reviewer_count: 2,
    reviewer_count_locked: true,
    ...overrides,
  };
}

function records(rows: ScreeningRecordRow[]): ScreeningRecordsRead {
  return {exclusion_reasons: [], inclusion_criteria: [], phase: 'title_abstract', reviewer_count: 2, rows};
}

/** A mutable records read: assign `current.rows` before a refetch. */
function serveRecords(initial: ScreeningRecordRow[]) {
  const current = {rows: initial};
  server.use(http.get(RECORDS_URL, () => ok(records(current.rows))));
  return current;
}

function assignmentFor(r: ScreeningRecordRow): ScreeningAssignmentRead {
  return {
    id: r.assignment_id ?? 'none',
    project_id: 'p1',
    status: 'awaiting_me',
    exclusion_reasons: [],
    article: {
      id: r.article_id,
      title: r.title,
      abstract: 'An abstract.',
      authors: ['Smith J'],
      doi: null,
      journal_title: 'Lancet',
      pmid: null,
      publication_year: 2021,
    },
    my_decision: null,
    outcome: null,
    peer_decisions: [],
  };
}

function serveAssignments(rows: ScreeningRecordRow[], read: (r: ScreeningRecordRow) => ScreeningAssignmentRead = assignmentFor) {
  const calls = {count: 0, ids: [] as string[]};
  server.use(
    http.get(ASSIGNMENT_URL, ({params}) => {
      calls.count += 1;
      calls.ids.push(params.assignmentId as string);
      const r = rows.find((candidate) => candidate.assignment_id === params.assignmentId);
      return r ? ok(read(r)) : fail(404, 'NOT_FOUND');
    }),
  );
  return calls;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

const search = () => new URLSearchParams(screen.getByTestId('location').textContent ?? '');

function renderWorkspace({
  cfg = config(),
  path = '/projects/p1?tab=screening',
  cached,
}: {cfg?: ScreeningConfigRead; path?: string; cached?: ScreeningRecordRow[]} = {}) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  if (cached) client.setQueryData(screeningKeys.records('p1', 'title_abstract'), records(cached));
  const view = render(
    <QueryClientProvider client={client}>
      <HeaderActionsProvider>
        <MemoryRouter initialEntries={[path]}>
          <TitleAbstractWorkspace projectId="p1" config={cfg} />
          <LocationProbe />
        </MemoryRouter>
      </HeaderActionsProvider>
    </QueryClientProvider>,
  );
  return {...view, client};
}

const liveRegion = () => screen.getByTestId('next-record-announcement');
const titleButton = (title: string) => screen.queryByRole('button', {name: title});
const panel = () => document.querySelector('[data-testid="screening-shell-panel"]');

beforeEach(() => {
  vi.mocked(toast).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('TitleAbstractWorkspace — list-level states', () => {
  it('shows skeleton rows while the records load', async () => {
    server.use(http.get(RECORDS_URL, () => new Promise(() => {})));
    renderWorkspace();
    const busy = await screen.findByRole('region', {name: 'Loading screening…'});
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy.querySelectorAll('[data-slot="skeleton-row"]')).toHaveLength(6);
  });

  it('shows an error with retry', async () => {
    let attempts = 0;
    server.use(
      http.get(RECORDS_URL, () => {
        attempts += 1;
        return attempts === 1 ? fail(500, 'INTERNAL') : ok(records([ALPHA]));
      }),
    );
    const user = userEvent.setup();
    renderWorkspace();
    expect(await screen.findByText('Could not load screening')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Try again'}));
    expect(await screen.findByRole('button', {name: 'Alpha trial'})).toBeInTheDocument();
  });

  it('shows "No articles yet" with the import button for a project with no articles', async () => {
    serveRecords([]);
    renderWorkspace({cfg: config({enrolled: 0})});
    expect(await screen.findByText('No articles yet')).toBeInTheDocument();
    expect(screen.getByText('Import articles to start screening.')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Import from PubMed'})).toBeInTheDocument();
  });

  it('shows Not enrolled rows and "Enroll all articles" for a manager when nothing is enrolled', async () => {
    serveRecords([notEnrolled(ALPHA), notEnrolled(BETA)]);
    renderWorkspace({cfg: config({...MANAGER, enrolled: 0, not_enrolled: 2})});
    expect(await screen.findByRole('button', {name: 'Alpha trial'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Beta cohort'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Enroll all articles'})).toBeInTheDocument();
  });

  it('tells a member that a manager enrolls articles', async () => {
    serveRecords([notEnrolled(ALPHA)]);
    renderWorkspace({cfg: config({enrolled: 0, not_enrolled: 1})});
    expect(await screen.findByRole('button', {name: 'Alpha trial'})).toBeInTheDocument();
    expect(screen.getByText('A manager enrolls articles')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Enroll all articles'})).toBeNull();
  });

  const STATES: {name: string; serve: () => void; counts: Partial<ScreeningConfigRead>}[] = [
    {name: 'loading', serve: () => server.use(http.get(RECORDS_URL, () => new Promise(() => {}))), counts: {}},
    {name: 'error', serve: () => server.use(http.get(RECORDS_URL, () => fail(500, 'INTERNAL'))), counts: {}},
    {name: 'no articles', serve: () => serveRecords([]), counts: {enrolled: 0}},
    {name: 'nothing enrolled', serve: () => serveRecords([notEnrolled(ALPHA)]), counts: {enrolled: 0, not_enrolled: 1}},
    {name: 'running', serve: () => serveRecords([ALPHA, BETA]), counts: {}},
  ];
  const MEMBERS = [
    {role: 'reviewer', flags: REVIEWER},
    {role: 'manager', flags: MANAGER},
  ];

  it.each(STATES.flatMap((state) => MEMBERS.map((member) => ({...state, ...member}))))(
    'renders Import from PubMed for every non-viewer member in every state ($role, $name)',
    async ({serve, counts, flags}) => {
      serve();
      renderWorkspace({cfg: config({...flags, ...counts})});
      expect(await screen.findByRole('button', {name: 'Import from PubMed'})).toBeInTheDocument();
    },
  );

  it.each([
    {name: 'nothing enrolled', rows: [notEnrolled(ALPHA)], counts: {enrolled: 0, not_enrolled: 1}},
    {name: 'running', rows: [ALPHA, BETA], counts: {enrolled: 7, not_enrolled: 2}},
  ])('a viewer sees no toolbar writes ($name)', async ({rows, counts}) => {
    serveRecords(rows);
    renderWorkspace({cfg: config({...VIEWER, ...counts})});
    expect(await screen.findByRole('button', {name: 'Alpha trial'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Import from PubMed'})).toBeNull();
    expect(screen.queryByRole('button', {name: 'Enroll all articles'})).toBeNull();
    expect(screen.queryByRole('button', {name: /^Enroll \d+ new$/})).toBeNull();
    expect(screen.queryByRole('button', {name: 'Start screening'})).toBeNull();
  });
});

describe('TitleAbstractWorkspace — Enroll N new', () => {
  it('shows "Enroll N new" only to a manager with enrolled and new articles', async () => {
    serveRecords([ALPHA, notEnrolled(BETA)]);
    let body: unknown = 'unset';
    server.use(
      http.post(ENROLL_URL, async ({request}) => {
        body = await request.json();
        return ok({enrolled: 2, already_enrolled: 0});
      }),
    );
    const user = userEvent.setup();
    renderWorkspace({cfg: config({...MANAGER, enrolled: 7, not_enrolled: 2})});
    await screen.findByRole('button', {name: 'Alpha trial'});
    await user.click(screen.getByRole('button', {name: 'Enroll 2 new'}));
    await waitFor(() => expect(body).toEqual({}));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('2 articles enrolled'));
  });

  it.each([
    {name: 'a reviewer', cfg: {...REVIEWER, enrolled: 7, not_enrolled: 2}},
    {name: 'a manager with nothing new', cfg: {...MANAGER, enrolled: 7, not_enrolled: 0}},
    {name: 'a manager with nothing enrolled', cfg: {...MANAGER, enrolled: 0, not_enrolled: 2}},
  ])('hides "Enroll N new" for $name', async ({cfg}) => {
    serveRecords([ALPHA, notEnrolled(BETA)]);
    renderWorkspace({cfg: config(cfg)});
    await screen.findByRole('button', {name: 'Alpha trial'});
    expect(screen.queryByRole('button', {name: /^Enroll \d+ new$/})).toBeNull();
    if (cfg.enrolled === 0) expect(screen.getByRole('button', {name: 'Enroll all articles'})).toBeInTheDocument();
  });
});

describe('TitleAbstractWorkspace — status views', () => {
  const CONFLICT = row({article_id: 'art4', assignment_id: 'a4', queue_rank: 4, title: 'Delta', status: 'conflict'});

  it.each([
    {role: 'manager', flags: MANAGER, rows: [ALPHA, CONFLICT], selected: /^All/},
    {role: 'reviewer', flags: REVIEWER, rows: [ALPHA, CONFLICT], selected: /^To screen/},
    {role: 'consensus with a conflict', flags: CONSENSUS, rows: [ALPHA, CONFLICT], selected: /^Reviewers disagree/},
    {role: 'consensus without a conflict', flags: CONSENSUS, rows: [ALPHA, GAMMA], selected: /^To screen/},
    {role: 'viewer', flags: VIEWER, rows: [ALPHA, CONFLICT], selected: /^All/},
  ])('defaults the status view by role ($role)', async ({flags, rows, selected}) => {
    serveRecords(rows);
    renderWorkspace({cfg: config(flags)});
    expect(await screen.findByRole('tab', {name: selected})).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps a decided row in the To screen view until the view or a filter changes', async () => {
    const current = serveRecords([ALPHA, BETA, GAMMA]);
    serveAssignments([ALPHA, BETA]);
    server.use(
      http.post(DECIDE_URL, () => {
        current.rows = [{...ALPHA, status: 'included', my_decision: 'include', outcome: 'include'}, BETA, GAMMA];
        return ok({...assignmentFor(ALPHA), status: 'decided'});
      }),
    );
    const user = userEvent.setup();
    const {unmount} = renderWorkspace();

    expect(await screen.findByRole('tab', {name: /^To screen/})).toHaveAttribute('aria-selected', 'true');
    expect(titleButton('Gamma review')).toBeNull();
    await user.click(screen.getByRole('button', {name: 'Alpha trial'}));
    await user.click(await screen.findByRole('button', {name: /Include/}));

    await waitFor(() =>
      expect(within(titleButton('Alpha trial')!.closest('tr')!).getByText('Included')).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('tab', {name: /^All/}));
    await user.click(screen.getByRole('tab', {name: /^To screen/}));
    expect(titleButton('Alpha trial')).toBeNull();
    expect(titleButton('Beta cohort')).not.toBeNull();
    unmount();

    // A fresh mount with the same data: nothing decided this session.
    renderWorkspace();
    expect(await screen.findByRole('button', {name: 'Beta cohort'})).toBeInTheDocument();
    expect(titleButton('Alpha trial')).toBeNull();
  });

  it('drops a decided row from the To screen view after a search edit', async () => {
    const current = serveRecords([ALPHA, BETA]);
    serveAssignments([ALPHA, BETA]);
    server.use(
      http.post(DECIDE_URL, () => {
        current.rows = [{...ALPHA, status: 'excluded', my_decision: 'exclude', outcome: 'exclude'}, BETA];
        return ok({...assignmentFor(ALPHA), status: 'decided'});
      }),
    );
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(await screen.findByRole('button', {name: 'Alpha trial'}));
    await user.click(await screen.findByRole('button', {name: /^Exclude(?! with)/}));
    await waitFor(() =>
      expect(within(titleButton('Alpha trial')!.closest('tr')!).getByText('Excluded')).toBeInTheDocument(),
    );

    // jsdom has no layout, so react-resizable-panels treats every pointerdown
    // as a hit on the split handle and takes focus: type without the click.
    const searchBox = screen.getByPlaceholderText('Search records…');
    searchBox.focus();
    await user.keyboard('Alpha');
    expect(searchBox).toHaveValue('Alpha');
    expect(titleButton('Alpha trial')).toBeNull();
  });
});

describe('TitleAbstractWorkspace — selection', () => {
  it('opens a row in the panel and writes ?article=', async () => {
    serveRecords([ALPHA, BETA]);
    serveAssignments([ALPHA, BETA]);
    const user = userEvent.setup();
    renderWorkspace();
    expect(panel()).toBeNull();
    await user.click(await screen.findByRole('button', {name: 'Beta cohort'}));
    expect(search().get('article')).toBe('art2');
    expect(await screen.findByRole('heading', {name: 'Beta cohort'})).toBeInTheDocument();
    expect(panel()).not.toBeNull();
  });

  it('Start screening selects the first To screen in queue order and maximizes', async () => {
    serveRecords([{...BETA, queue_rank: 2}, GAMMA, {...ALPHA, queue_rank: 1}]);
    serveAssignments([ALPHA, BETA]);
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(await screen.findByRole('button', {name: 'Start screening'}));
    expect(search().get('article')).toBe('art1');
    expect(document.querySelector('[data-maximized="true"]')).not.toBeNull();
    expect(await screen.findByRole('heading', {name: 'Alpha trial'})).toBeInTheDocument();
  });

  it('hides Start screening when nothing is left for me', async () => {
    serveRecords([GAMMA]);
    renderWorkspace();
    await screen.findByRole('tab', {name: /^To screen/});
    expect(screen.queryByRole('button', {name: 'Start screening'})).toBeNull();
  });

  it('strips ?assignment= and opens nothing', async () => {
    serveRecords([ALPHA]);
    const calls = serveAssignments([ALPHA]);
    renderWorkspace({path: '/projects/p1?tab=screening&assignment=a1'});
    await screen.findByRole('button', {name: 'Alpha trial'});
    await waitFor(() => expect(search().has('assignment')).toBe(false));
    expect(search().get('tab')).toBe('screening');
    expect(panel()).toBeNull();
    expect(calls.count).toBe(0);
  });

  it('clears a selection that is not a row and toasts', async () => {
    serveRecords([ALPHA]);
    const calls = serveAssignments([ALPHA]);
    renderWorkspace({path: '/projects/p1?tab=screening&article=missing'});
    await screen.findByRole('button', {name: 'Alpha trial'});
    await waitFor(() => expect(search().has('article')).toBe(false));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('This article is not in this phase');
    expect(calls.count).toBe(0);
  });

  it('strips ?assignment= and clears a missing ?article= in the same first render', async () => {
    serveRecords([ALPHA]);
    serveAssignments([ALPHA]);
    renderWorkspace({path: '/projects/p1?tab=screening&assignment=a1&article=missing', cached: [ALPHA]});
    // Cached rows: both edits are due on the first commit.
    expect(screen.getByRole('button', {name: 'Alpha trial'})).toBeInTheDocument();
    await waitFor(() => expect(search().has('article')).toBe(false));
    expect(search().has('assignment')).toBe(false);
    expect(search().get('tab')).toBe('screening');
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('clears a selection that drops out after a refetch', async () => {
    const current = serveRecords([ALPHA, BETA]);
    serveAssignments([ALPHA, BETA]);
    const {client} = renderWorkspace({path: '/projects/p1?tab=screening&article=art1'});
    expect(await screen.findByRole('heading', {name: 'Alpha trial'})).toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();

    current.rows = [BETA];
    await client.invalidateQueries({queryKey: screeningKeys.records('p1', 'title_abstract')});
    await waitFor(() => expect(search().has('article')).toBe(false));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('This article is not in this phase');
    expect(screen.getByRole('button', {name: 'Beta cohort'})).toBeInTheDocument();
  });

  it('toasts once when the selected record’s assignment read is gone, across re-renders', async () => {
    const current = serveRecords([ALPHA, BETA]);
    serveAssignments([BETA]);
    const user = userEvent.setup();
    const {client} = renderWorkspace({path: '/projects/p1?tab=screening&article=art1'});
    await waitFor(() => expect(search().has('article')).toBe(false));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('This article is not in this phase');

    current.rows = [{...ALPHA, queue_rank: 5}, BETA];
    await client.invalidateQueries({queryKey: screeningKeys.records('p1', 'title_abstract')});
    await user.click(screen.getByRole('tab', {name: /^All/}));
    await screen.findByRole('button', {name: 'Beta cohort'});
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('Escape restores, then closes, then clears the selection, then the checked rows', async () => {
    serveRecords([ALPHA, BETA]);
    serveAssignments([ALPHA, BETA]);
    const user = userEvent.setup();
    renderWorkspace({path: '/projects/p1?tab=screening&article=art1'});
    await screen.findByRole('heading', {name: 'Alpha trial'});
    const betaBox = screen.getByRole('checkbox', {name: 'Select Beta cohort'});
    await user.click(betaBox);
    expect(betaBox).toBeChecked();

    fireEvent.keyDown(window, {key: '|', code: 'Backslash', ctrlKey: true, metaKey: true, shiftKey: true});
    expect(document.querySelector('[data-maximized="true"]')).not.toBeNull();

    const escape = () => fireEvent.keyDown(document.body, {key: 'Escape'});
    escape();
    expect(document.querySelector('[data-maximized]')).toBeNull();
    expect(panel()).not.toBeNull();

    escape();
    expect(panel()).toBeNull();
    expect(search().get('article')).toBe('art1');

    escape();
    await waitFor(() => expect(search().has('article')).toBe(false));
    expect(betaBox).toBeChecked();

    escape();
    await waitFor(() => expect(screen.getByRole('checkbox', {name: 'Select Beta cohort'})).not.toBeChecked());
  });
});

describe('TitleAbstractWorkspace — keyboard', () => {
  const press = (key: string, target: Element = document.body) => fireEvent.keyDown(target, {key});
  const cursorTitle = () => document.querySelector('[data-cursor="true"]')?.querySelector('button:not([role="checkbox"])')?.textContent ?? null;
  const box = (title: string) => screen.getByRole('checkbox', {name: `Select ${title}`});

  // Manager → the All view: Alpha, Beta, Gamma in queue order.
  const renderAll = (path?: string) => {
    serveRecords([ALPHA, BETA, GAMMA]);
    serveAssignments([ALPHA, BETA, GAMMA]);
    return renderWorkspace({cfg: config(MANAGER), path});
  };

  it('j and k move the cursor; the panel follows when open', async () => {
    renderAll();
    await screen.findByRole('button', {name: 'Alpha trial'});
    expect(cursorTitle()).toBeNull();

    press('j');
    expect(cursorTitle()).toBe('Alpha trial');
    press('j');
    expect(cursorTitle()).toBe('Beta cohort');
    press('k');
    expect(cursorTitle()).toBe('Alpha trial');
    // Closed panel: the cursor moves alone, nothing is selected.
    expect(search().has('article')).toBe(false);
    expect(panel()).toBeNull();

    press('Enter');
    expect(await screen.findByRole('heading', {name: 'Alpha trial'})).toBeInTheDocument();
    press('j');
    await waitFor(() => expect(search().get('article')).toBe('art2'));
    expect(await screen.findByRole('heading', {name: 'Beta cohort'})).toBeInTheDocument();
    expect(cursorTitle()).toBe('Beta cohort');
  });

  it('arrow keys move the cursor too', async () => {
    renderAll();
    await screen.findByRole('button', {name: 'Alpha trial'});
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown');
    expect(cursorTitle()).toBe('Gamma review');
    // The last row holds the cursor.
    press('ArrowDown');
    expect(cursorTitle()).toBe('Gamma review');
    press('ArrowUp');
    expect(cursorTitle()).toBe('Beta cohort');
  });

  it('Enter opens the cursor row', async () => {
    renderAll();
    await screen.findByRole('button', {name: 'Alpha trial'});
    press('j');
    press('j');
    press('Enter');
    expect(search().get('article')).toBe('art2');
    expect(await screen.findByRole('heading', {name: 'Beta cohort'})).toBeInTheDocument();
    expect(panel()).not.toBeNull();
  });

  it('keys are inert in a text field', async () => {
    renderAll();
    await screen.findByRole('button', {name: 'Alpha trial'});
    const searchBox = screen.getByPlaceholderText('Search records…');
    searchBox.focus();
    press('j', searchBox);
    press('x', searchBox);
    expect(cursorTitle()).toBeNull();
    // Precondition: the same key outside the field moves the cursor.
    press('j');
    expect(cursorTitle()).toBe('Alpha trial');
  });

  it('keys are inert under a dialog', async () => {
    const user = userEvent.setup();
    renderAll('/projects/p1?tab=screening&article=art1');
    await screen.findByRole('heading', {name: 'Alpha trial'});
    let decides = 0;
    server.use(
      http.post(DECIDE_URL, () => {
        decides += 1;
        return ok(assignmentFor(ALPHA));
      }),
    );
    await user.click(screen.getByRole('button', {name: 'Import from PubMed'}));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    press('j');
    press('1');
    press('x');
    expect(search().get('article')).toBe('art1');
    expect(cursorTitle()).toBe('Alpha trial');
    expect(decides).toBe(0);
  });

  it('x toggles the cursor row', async () => {
    renderAll();
    await screen.findByRole('button', {name: 'Alpha trial'});
    press('j');
    press('j');
    press('x');
    expect(box('Beta cohort')).toBeChecked();
    expect(box('Alpha trial')).not.toBeChecked();
    press('x');
    expect(box('Beta cohort')).not.toBeChecked();
  });

  it('shift-click selects a range', async () => {
    const user = userEvent.setup();
    renderAll();
    await screen.findByRole('button', {name: 'Alpha trial'});
    await user.click(box('Alpha trial'));
    await user.keyboard('{Shift>}');
    await user.click(box('Gamma review'));
    await user.keyboard('{/Shift}');
    expect(box('Alpha trial')).toBeChecked();
    expect(box('Beta cohort')).toBeChecked();
    expect(box('Gamma review')).toBeChecked();
  });

  it('Esc order: popover, maximize, panel, selection, checked rows — one step per press', async () => {
    const user = userEvent.setup();
    renderAll('/projects/p1?tab=screening&article=art1');
    await screen.findByRole('heading', {name: 'Alpha trial'});
    await user.click(box('Beta cohort'));
    fireEvent.keyDown(window, {key: '|', code: 'Backslash', ctrlKey: true, metaKey: true, shiftKey: true});
    expect(document.querySelector('[data-maximized="true"]')).not.toBeNull();
    press('f');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    const escape = () => fireEvent.keyDown(document.activeElement ?? document.body, {key: 'Escape'});
    escape();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.querySelector('[data-maximized="true"]')).not.toBeNull();
    // Focus returns to the filter trigger, whose tooltip opens: the tooltip
    // takes its own Escape, which is not a chain step.
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();
    escape();
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    expect(document.querySelector('[data-maximized="true"]')).not.toBeNull();

    escape();
    expect(document.querySelector('[data-maximized]')).toBeNull();
    expect(panel()).not.toBeNull();

    escape();
    expect(panel()).toBeNull();
    expect(search().get('article')).toBe('art1');

    escape();
    await waitFor(() => expect(search().has('article')).toBe(false));
    expect(box('Beta cohort')).toBeChecked();

    escape();
    await waitFor(() => expect(box('Beta cohort')).not.toBeChecked());
  });

  it('Esc in the search field clears nothing', async () => {
    const user = userEvent.setup();
    renderAll('/projects/p1?tab=screening&article=art1');
    await screen.findByRole('heading', {name: 'Alpha trial'});
    await user.click(box('Beta cohort'));
    const searchBox = screen.getByPlaceholderText('Search records…');
    searchBox.focus();
    press('Escape', searchBox);
    expect(panel()).not.toBeNull();
    expect(search().get('article')).toBe('art1');
    expect(box('Beta cohort')).toBeChecked();
  });
});

describe('TitleAbstractWorkspace — auto-advance', () => {
  const DELTA = row({article_id: 'art4', assignment_id: 'a4', queue_rank: 4, title: 'Delta study'});
  const EPSILON = row({article_id: 'art5', assignment_id: 'a5', queue_rank: 5, title: 'Epsilon series'});
  const ZETA = row({article_id: 'art6', assignment_id: 'a6', queue_rank: 6, title: 'Zeta report'});

  function serveDecide(current: {rows: ScreeningRecordRow[]}, decided: ScreeningRecordRow) {
    server.use(
      http.post(DECIDE_URL, () => {
        current.rows = current.rows.map((r) =>
          r.article_id === decided.article_id
            ? {...r, status: 'included', my_decision: 'include', outcome: 'include'}
            : r,
        );
        return ok({...assignmentFor(decided), status: 'decided'});
      }),
    );
  }

  it('auto-advances to the next To screen in queue order after a decision', async () => {
    // Beta sits before Alpha in the payload; Gamma (decided) is skipped.
    const current = serveRecords([{...BETA, queue_rank: 3}, GAMMA, {...ALPHA, queue_rank: 1}, DELTA]);
    serveAssignments(current.rows);
    serveDecide(current, ALPHA);
    const user = userEvent.setup();
    renderWorkspace({path: '/projects/p1?tab=screening&article=art1'});
    await screen.findByRole('heading', {name: 'Alpha trial'});

    await user.click(await screen.findByRole('button', {name: /Include/}));

    await waitFor(() => expect(search().get('article')).toBe('art2'));
    expect(await screen.findByRole('heading', {name: 'Beta cohort'})).toBeInTheDocument();
    // After the refetch the decided row is still listed in To screen, with its new chip.
    expect(screen.getByRole('tab', {name: /^To screen/})).toHaveAttribute('aria-selected', 'true');
    await waitFor(() =>
      expect(within(titleButton('Alpha trial')!.closest('tr')!).getByText('Included')).toBeInTheDocument(),
    );
  });

  it('announces the next record', async () => {
    const current = serveRecords([ALPHA, BETA]);
    serveAssignments(current.rows);
    serveDecide(current, ALPHA);
    const user = userEvent.setup();
    renderWorkspace({path: '/projects/p1?tab=screening&article=art1'});
    await screen.findByRole('heading', {name: 'Alpha trial'});
    const live = liveRegion();
    expect(live).toHaveTextContent('');

    await user.click(await screen.findByRole('button', {name: /Include/}));

    await waitFor(() => expect(live).toHaveTextContent('Next record: Beta cohort'));
  });

  it('prefetches the next two assignments', async () => {
    const current = serveRecords([ALPHA, BETA, DELTA, EPSILON, ZETA]);
    const calls = serveAssignments(current.rows);
    serveDecide(current, ALPHA);
    const user = userEvent.setup();
    renderWorkspace({path: '/projects/p1?tab=screening&article=art1'});
    await screen.findByRole('heading', {name: 'Alpha trial'});
    expect(calls.ids).not.toContain('a4');

    await user.click(await screen.findByRole('button', {name: /Include/}));

    await waitFor(() => expect(search().get('article')).toBe('art2'));
    // Beta is open (its own read); Delta and Epsilon wait in the cache, Zeta does not.
    await waitFor(() => expect(calls.ids).toEqual(expect.arrayContaining(['a2', 'a4', 'a5'])));
    expect(calls.ids).not.toContain('a6');
    expect(search().get('article')).toBe('art2');
  });

  it('prefetches the next two in wrapped queue order at the end of the queue', async () => {
    const current = serveRecords([ALPHA, BETA, DELTA, EPSILON, ZETA]);
    const calls = serveAssignments(current.rows);
    serveDecide(current, EPSILON);
    const user = userEvent.setup();
    renderWorkspace({path: '/projects/p1?tab=screening&article=art5'});
    await screen.findByRole('heading', {name: 'Epsilon series'});
    expect(calls.ids).not.toContain('a1');

    await user.click(await screen.findByRole('button', {name: /Include/}));

    // Zeta is the last To screen: the two after it wrap to Alpha and Beta, as nextToScreen does.
    await waitFor(() => expect(search().get('article')).toBe('art6'));
    await waitFor(() => expect(calls.ids).toEqual(expect.arrayContaining(['a6', 'a1', 'a2'])));
    expect(calls.ids).not.toContain('a4');
  });

  // Spec §4.4 advances after a To screen decision only: a solo re-decide of a
  // decided record stays on it, and its chip follows the new outcome.
  it('stays on the record after a solo re-decide', async () => {
    const DECIDED = {...ALPHA, status: 'included' as const, my_decision: 'include' as const, outcome: 'include' as const};
    const current = serveRecords([DECIDED, BETA]);
    serveAssignments(current.rows, (r) =>
      r.article_id === DECIDED.article_id
        ? {
            ...assignmentFor(r),
            status: 'decided',
            my_decision: {id: 'd1', decision: 'include', exclusion_reason: null, rationale: null, created_at: '2026-10-23T00:00:00Z'},
            outcome: {decision: 'include', exclusion_reason: null, kind: 'solo', reasons_differ: false},
          }
        : assignmentFor(r),
    );
    let decisions = 0;
    server.use(
      http.post(DECIDE_URL, () => {
        decisions += 1;
        current.rows = current.rows.map((r) =>
          r.article_id === DECIDED.article_id ? {...r, status: 'excluded', my_decision: 'exclude', outcome: 'exclude'} : r,
        );
        return ok({...assignmentFor(DECIDED), status: 'decided'});
      }),
    );
    const user = userEvent.setup();
    renderWorkspace({cfg: config({reviewer_count: 1}), path: '/projects/p1?tab=screening&status=all&article=art1'});
    expect(await screen.findByRole('button', {name: /Include/})).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', {name: /^Exclude(?! with)/}));

    await waitFor(() => expect(decisions).toBe(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Changed to Exclude'));
    await waitFor(() =>
      expect(within(titleButton('Alpha trial')!.closest('tr')!).getByText('Excluded')).toBeInTheDocument(),
    );
    expect(search().get('article')).toBe('art1');
    expect(screen.getByRole('heading', {name: 'Alpha trial'})).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('');
  });

  it('stays on the decided record when nothing is left to screen', async () => {
    const current = serveRecords([ALPHA, GAMMA]);
    serveAssignments(current.rows);
    serveDecide(current, ALPHA);
    const user = userEvent.setup();
    renderWorkspace({path: '/projects/p1?tab=screening&article=art1'});
    await screen.findByRole('heading', {name: 'Alpha trial'});

    await user.click(await screen.findByRole('button', {name: /Include/}));

    await waitFor(() =>
      expect(within(titleButton('Alpha trial')!.closest('tr')!).getByText('Included')).toBeInTheDocument(),
    );
    expect(search().get('article')).toBe('art1');
    expect(screen.getByRole('heading', {name: 'Alpha trial'})).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('');
  });

  // Spec §4.4 advances after a To screen decision only: a ruling keeps the
  // arbitrator on the ruled record, which then reads as arbitrated.
  it('keeps the panel on a ruled record', async () => {
    const CONFLICT = row({article_id: 'art7', assignment_id: 'a7', queue_rank: 7, title: 'Eta trial', status: 'conflict'});
    serveRecords([ALPHA, CONFLICT]);
    const peer = (id: string, decision: 'include' | 'exclude') => ({
      id,
      reviewer_id: `r-${id}`,
      reviewer_name: `Name ${id}`,
      decision,
      exclusion_reason: null,
      rationale: null,
      created_at: '2026-10-01T10:00:00Z',
    });
    serveAssignments([ALPHA, CONFLICT], (r) =>
      r === CONFLICT
        ? {...assignmentFor(r), status: 'conflict', peer_decisions: [peer('dA', 'include'), peer('dB', 'exclude')]}
        : assignmentFor(r),
    );
    let rulings = 0;
    server.use(
      http.post(ARBITRATE_URL, () => {
        rulings += 1;
        return ok({...assignmentFor(CONFLICT), status: 'decided'});
      }),
    );
    const user = userEvent.setup();
    renderWorkspace({cfg: config(MANAGER), path: '/projects/p1?tab=screening&article=art7'});
    await screen.findByRole('heading', {name: 'Eta trial'});

    await user.click(await screen.findByRole('button', {name: "Use Reviewer A's decision"}));

    await waitFor(() => expect(rulings).toBe(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Conflict resolved'));
    expect(search().get('article')).toBe('art7');
    expect(liveRegion()).toHaveTextContent('');
  });
});
