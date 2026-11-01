/**
 * ScreeningWorkspace — the title/abstract list + docked panel (spec §4,
 * §4.1, §4.2, §4.4, §4.6): every list-level state with the toolbar, the
 * role-based default view, decided rows staying in the current view, the URL
 * selection (`?article=`, a legacy `?assignment=`, a miss), "Start screening"
 * and the shell's Escape chain.
 */
import {fireEvent, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http} from 'msw';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));
vi.mock('sonner', () => ({toast: Object.assign(vi.fn(), {success: vi.fn(), error: vi.fn()})}));

import {toast} from 'sonner';

import {screeningKeys} from '@/lib/query-keys/screening';
import type {ScreeningConfigRead} from '@/services/screeningService';
import {server} from '@/test/mocks/server';

import {
  ALPHA,
  assignmentFor,
  BETA,
  config,
  CONSENSUS,
  DECIDE_URL,
  ENROLL_URL,
  fail,
  GAMMA,
  MANAGER,
  notEnrolled,
  ok,
  panel,
  records,
  RECORDS_URL,
  renderWorkspace,
  REVIEWER,
  row,
  search,
  serveAssignments,
  serveRecords,
  titleButton,
  VIEWER,
} from './screeningWorkspace.fixtures';

beforeEach(() => {
  vi.mocked(toast).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('ScreeningWorkspace — list-level states', () => {
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

describe('ScreeningWorkspace — Enroll N new', () => {
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

describe('ScreeningWorkspace — status views', () => {
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

describe('ScreeningWorkspace — selection', () => {
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

  it('passes the protocol criteria from the records read to the panel', async () => {
    server.use(
      http.get(RECORDS_URL, () =>
        ok({...records([ALPHA, BETA]), inclusion_criteria: ['Adults'], exclusion_reasons: ['Not ML']}),
      ),
    );
    serveAssignments([ALPHA, BETA]);
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(await screen.findByRole('button', {name: 'Beta cohort'}));
    expect(await screen.findByRole('button', {name: 'Criteria (2)'})).toBeInTheDocument();
    expect(screen.queryByRole('complementary', {name: 'Screening criteria'})).toBeNull();
  });

  it('passes maximized to the panel', async () => {
    server.use(
      http.get(RECORDS_URL, () =>
        ok({...records([ALPHA, BETA]), inclusion_criteria: ['Adults'], exclusion_reasons: ['Not ML']}),
      ),
    );
    serveAssignments([ALPHA, BETA]);
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(await screen.findByRole('button', {name: 'Start screening'}));
    expect(await screen.findByRole('complementary', {name: 'Screening criteria'})).toHaveTextContent('Not ML');
    expect(screen.queryByRole('button', {name: 'Criteria (2)'})).toBeNull();
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

describe('ScreeningWorkspace — unknown ?status=', () => {
  it('rewrites a status the title/abstract phase lacks to the role default', async () => {
    serveRecords([ALPHA, BETA]);
    renderWorkspace({path: '/projects/p1?tab=screening&status=not_retrieved'});
    await waitFor(() => expect(search().get('status')).toBe('to_screen'));
    expect(screen.getByRole('tab', {name: /^To screen/})).toHaveAttribute('aria-selected', 'true');
  });
});
