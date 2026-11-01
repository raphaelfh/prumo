/**
 * DuplicatesWorkspace — the pair list + compare panel (spec §8.4): list-level
 * states, status views and counts, the URL selection (`?article=`, `?kept=`),
 * Merge / Not duplicates / Skip / Undo, "Accept N exact", refusals, the busy
 * guard and the j/k/Enter/Esc keys. Real English copy; MSW for the API.
 */
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

import {DuplicatesWorkspace} from '@/components/screening/duplicates/DuplicatesWorkspace';
import {TooltipProvider} from '@/components/ui/tooltip';
import {HeaderActionsProvider} from '@/contexts/HeaderActionsContext';
import type {DuplicatePair, DuplicatesRead, DuplicateVerdictCreate} from '@/services/duplicatesService';
import {createQueryWrapper} from '@/test/helpers/queryClientWrapper';
import {server} from '@/test/mocks/server';

const DUPLICATES_URL = '*/api/v1/projects/:projectId/duplicates';
const VERDICTS_URL = '*/api/v1/projects/:projectId/duplicates/verdicts';

const ok = (data: unknown) => HttpResponse.json({ok: true, data});
const fail = (status: number, code: string) =>
  HttpResponse.json({ok: false, error: {code, message: code}}, {status});

type Side = DuplicatePair['kept'];

function side(id: string, title: string, over: Partial<Side> = {}): Side {
  return {
    article_id: id,
    title,
    authors: ['Smith J'],
    publication_year: 2020,
    journal_title: 'Lancet',
    doi: null,
    pmid: null,
    ingestion_source: 'PUBMED',
    has_pdf: false,
    has_abstract: true,
    screening_decisions: 0,
    has_review_work: false,
    ...over,
  };
}

function pair(
  removed: Side,
  kept: Side,
  tier: DuplicatePair['tier'],
  match: DuplicatePair['match_label'],
  over: Partial<DuplicatePair> = {},
): DuplicatePair {
  return {
    article_id: removed.article_id,
    kept_article_id: kept.article_id,
    tier,
    basis: tier === 'exact' ? 'pmid' : 'title',
    match_label: match,
    removed,
    kept,
    ...over,
  };
}

const EXACT = pair(
  side('r1', 'Aspirin trial copy', {ingestion_source: 'RIS', publication_year: 2019}),
  side('k1', 'Aspirin trial'),
  'exact',
  'pmid',
);
const LIKELY = pair(side('r2', 'Statin cohort'), side('k2', 'Statin cohort study'), 'likely', 'title');
const POSSIBLE = pair(side('r3', 'Insulin review'), side('k3', 'Insulin meta-analysis'), 'possible', 'doi_only');
const RESOLVED = pair(side('r4', 'Metformin copy'), side('k4', 'Metformin trial'), null, null, {
  verdict: 'duplicate',
  decided_by_name: 'Ana',
  created_at: '2026-10-01T10:00:00Z',
});

const READ: DuplicatesRead = {open: [EXACT, LIKELY, POSSIBLE], resolved: [RESOLVED]};

/** A mutable read: assign `current.read` before a refetch; `current.gets` counts the reads. */
function serveDuplicates(initial: DuplicatesRead = READ) {
  const current = {read: initial, gets: 0};
  server.use(
    http.get(DUPLICATES_URL, () => {
      current.gets += 1;
      return ok(current.read);
    }),
  );
  return current;
}

function captureVerdicts(respond: () => Response | Promise<Response> = () => ok({written: 1, enrolled_kept: 0})) {
  const bodies: DuplicateVerdictCreate[][] = [];
  server.use(
    http.post(VERDICTS_URL, async ({request}) => {
      bodies.push(((await request.json()) as {items: DuplicateVerdictCreate[]}).items);
      return respond();
    }),
  );
  return bodies;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}
const search = () => new URLSearchParams(screen.getByTestId('location').textContent ?? '');

function renderWorkspace(query = '') {
  const {wrapper: Wrapper} = createQueryWrapper();
  return render(
    <Wrapper>
      <TooltipProvider delayDuration={0}>
        <HeaderActionsProvider>
          <MemoryRouter initialEntries={[`/projects/p1?tab=screening&screeningTab=duplicates${query}`]}>
            <DuplicatesWorkspace projectId="p1" />
            <LocationProbe />
          </MemoryRouter>
        </HeaderActionsProvider>
      </TooltipProvider>
    </Wrapper>,
  );
}

const pairRow = (title: RegExp) => screen.findByRole('button', {name: title});
const keepRadio = (n: 1 | 2, title: string) => screen.findByRole('radio', {name: `Keep record ${n}: "${title}"`});
const key = (k: string) => fireEvent.keyDown(document.body, {key: k});

beforeEach(() => {
  vi.mocked(toast).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('DuplicatesWorkspace — list-level states', () => {
  it('shows skeleton rows while loading', async () => {
    server.use(http.get(DUPLICATES_URL, () => new Promise(() => {})));
    renderWorkspace();
    const busy = await screen.findByRole('region', {name: 'Loading screening…'});
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy.querySelectorAll('[data-slot="skeleton-row"]').length).toBeGreaterThan(0);
  });

  it('shows an error with retry', async () => {
    let attempts = 0;
    server.use(
      http.get(DUPLICATES_URL, () => {
        attempts += 1;
        return attempts === 1 ? fail(500, 'INTERNAL') : ok(READ);
      }),
    );
    const user = userEvent.setup();
    renderWorkspace();
    expect(await screen.findByText('Could not load duplicates')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Try again'}));
    expect(await pairRow(/^Aspirin trial copy/)).toBeInTheDocument();
  });

  it('shows the manager-only error on 403', async () => {
    server.use(http.get(DUPLICATES_URL, () => fail(403, 'FORBIDDEN')));
    renderWorkspace();
    expect(await screen.findByText('Only project managers can do this')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Try again'})).toBeNull();
  });

  it.each(['open', 'exact', 'likely', 'possible'])('shows "No open pairs" (%s)', async (view) => {
    serveDuplicates({open: [], resolved: [RESOLVED]});
    renderWorkspace(`&status=${view}`);
    expect(await screen.findByText('No open pairs')).toBeInTheDocument();
  });

  it('shows "No resolved pairs"', async () => {
    serveDuplicates({open: [EXACT], resolved: []});
    renderWorkspace('&status=resolved');
    expect(await screen.findByText('No resolved pairs')).toBeInTheDocument();
  });
});

describe('DuplicatesWorkspace — list', () => {
  it('lists pairs with their match chip and status-view counts', async () => {
    serveDuplicates();
    renderWorkspace();
    const exactRow = (await pairRow(/^Aspirin trial copy/)).closest('tr') as HTMLElement;
    expect(within(exactRow).getByText('PMID')).toBeInTheDocument();
    expect(within(exactRow).getByText('RIS · PubMed')).toBeInTheDocument();
    expect(within(exactRow).getByText('2019')).toBeInTheDocument();
    const likelyRow = (await pairRow(/^Statin cohort/)).closest('tr') as HTMLElement;
    expect(within(likelyRow).getByText('Same title')).toBeInTheDocument();
    const possibleRow = (await pairRow(/^Insulin review/)).closest('tr') as HTMLElement;
    expect(within(possibleRow).getByText('Same DOI, different title')).toBeInTheDocument();

    expect(screen.getByRole('tab', {name: 'Open 3'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', {name: 'Exact 1'})).toBeInTheDocument();
    expect(screen.getByRole('tab', {name: 'Likely 1'})).toBeInTheDocument();
    expect(screen.getByRole('tab', {name: 'Possible 1'})).toBeInTheDocument();
    expect(screen.getByRole('tab', {name: 'Resolved 1'})).toBeInTheDocument();
    // The resolved pair is not in the Open view.
    expect(screen.queryByRole('button', {name: /^Metformin copy/})).toBeNull();
  });

  it('filters by status view', async () => {
    serveDuplicates();
    const user = userEvent.setup();
    renderWorkspace();
    await pairRow(/^Aspirin trial copy/);
    await user.click(screen.getByRole('tab', {name: 'Exact 1'}));
    expect(search().get('status')).toBe('exact');
    expect(screen.getByRole('button', {name: /^Aspirin trial copy/})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /^Statin cohort/})).toBeNull();

    await user.click(screen.getByRole('tab', {name: 'Resolved 1'}));
    expect(await pairRow(/^Metformin copy/)).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /^Aspirin trial copy/})).toBeNull();
  });
});

describe('DuplicatesWorkspace — URL selection', () => {
  it('opens a pair and writes ?article= and ?kept=', async () => {
    serveDuplicates();
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(await pairRow(/^Statin cohort/));
    expect(search().get('article')).toBe('r2');
    expect(search().get('kept')).toBe('k2');
    expect(await keepRadio(1, 'Statin cohort study')).toBeChecked();
  });

  it('selects the first open pair for an ?article= in several pairs', async () => {
    // Triple A > B > C: pairs B→A, C→A, C→B. C sits in two of them.
    const a = side('A', 'Alpha original');
    const b = side('B', 'Alpha copy one');
    const c = side('C', 'Alpha copy two');
    serveDuplicates({
      open: [pair(b, a, 'exact', 'pmid'), pair(c, a, 'exact', 'pmid'), pair(c, b, 'exact', 'pmid')],
      resolved: [],
    });
    renderWorkspace('&article=C');
    expect(await keepRadio(1, 'Alpha original')).toBeChecked();
    expect(await keepRadio(2, 'Alpha copy two')).toBeInTheDocument();
    const selected = document.querySelector('tr[data-state="selected"]');
    expect(selected?.getAttribute('data-pair-row')).toBe('C~A');
  });

  it('drops an ?article= that matches no pair', async () => {
    serveDuplicates();
    renderWorkspace('&article=zzz&kept=yyy');
    await pairRow(/^Aspirin trial copy/);
    await waitFor(() => expect(search().has('article')).toBe(false));
    expect(search().has('kept')).toBe(false);
    expect(search().get('screeningTab')).toBe('duplicates');
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('DuplicatesWorkspace — verdicts', () => {
  it('merges, toasts with Undo, and Undo posts cleared', async () => {
    serveDuplicates();
    const bodies = captureVerdicts();
    const user = userEvent.setup();
    renderWorkspace('&article=r1&kept=k1');
    await user.click(await screen.findByRole('button', {name: 'Merge, keep selected'}));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Merged', expect.anything()));
    expect(bodies).toEqual([[{article_id: 'r1', kept_article_id: 'k1', verdict: 'duplicate'}]]);
    // The next open pair in list order is selected.
    await waitFor(() => expect(search().get('article')).toBe('r2'));
    expect(search().get('kept')).toBe('k2');

    const {action} = vi.mocked(toast.success).mock.calls[0][1] as {action: {label: string; onClick: () => void}};
    expect(action.label).toBe('Undo');
    action.onClick();
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual([{article_id: 'r1', kept_article_id: 'k1', verdict: 'cleared'}]);
  });

  it('marks not duplicates', async () => {
    serveDuplicates();
    const bodies = captureVerdicts();
    const user = userEvent.setup();
    renderWorkspace('&article=r1&kept=k1');
    await user.click(await screen.findByRole('button', {name: 'Not duplicates'}));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Marked not duplicates', expect.anything()));
    expect(bodies).toEqual([[{article_id: 'r1', kept_article_id: 'k1', verdict: 'distinct'}]]);
    const {action} = vi.mocked(toast.success).mock.calls[0][1] as {action: {label: string; onClick: () => void}};
    action.onClick();
    await waitFor(() => expect(bodies[1]).toEqual([{article_id: 'r1', kept_article_id: 'k1', verdict: 'cleared'}]));
  });

  it('Skip moves to the next open pair without a request', async () => {
    serveDuplicates();
    const bodies = captureVerdicts();
    const user = userEvent.setup();
    renderWorkspace('&article=r1&kept=k1');
    await user.click(await screen.findByRole('button', {name: 'Skip'}));
    await waitFor(() => expect(search().get('article')).toBe('r2'));
    expect(search().get('kept')).toBe('k2');
    expect(bodies).toHaveLength(0);
  });

  it('Undo on a resolved pair posts cleared', async () => {
    serveDuplicates();
    const bodies = captureVerdicts();
    const user = userEvent.setup();
    renderWorkspace('&status=resolved&article=r4&kept=k4');
    await user.click(await screen.findByRole('button', {name: 'Undo'}));
    await waitFor(() => expect(bodies).toEqual([[{article_id: 'r4', kept_article_id: 'k4', verdict: 'cleared'}]]));
  });

  it('Accept N exact asks with min(N, 500) and posts the acceptable pairs', async () => {
    const a = side('A', 'Alpha original');
    const b = side('B', 'Alpha copy one');
    const c = side('C', 'Alpha copy two');
    const worked = pair(side('W', 'Worked copy', {has_review_work: true}), side('V', 'Worked'), 'exact', 'pmid');
    serveDuplicates({
      open: [pair(b, a, 'exact', 'pmid'), pair(c, a, 'exact', 'pmid'), pair(c, b, 'exact', 'pmid'), worked],
      resolved: [],
    });
    const bodies = captureVerdicts(() => ok({written: 2, enrolled_kept: 0}));
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(await screen.findByRole('button', {name: 'Accept 2 exact'}));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Merge 2 exact duplicates?')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Each keeps the suggested record. Pairs where the record to remove has review work are left out.',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', {name: 'Accept 2 exact'}));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Merged 2'));
    expect(bodies).toEqual([
      [
        {article_id: 'B', kept_article_id: 'A', verdict: 'duplicate'},
        {article_id: 'C', kept_article_id: 'A', verdict: 'duplicate'},
      ],
    ]);
  });

  it('hides Accept exact when no exact pair is acceptable', async () => {
    serveDuplicates({open: [LIKELY], resolved: []});
    renderWorkspace();
    await pairRow(/^Statin cohort/);
    expect(screen.queryByRole('button', {name: /^Accept \d+ exact$/})).toBeNull();
  });

  it('a refused verdict toasts the mapped copy and refetches', async () => {
    const current = serveDuplicates();
    captureVerdicts(() => fail(409, 'DUPLICATE_KEPT_IS_REMOVED'));
    const user = userEvent.setup();
    renderWorkspace('&article=r1&kept=k1');
    await user.click(await screen.findByRole('button', {name: 'Merge, keep selected'}));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('The record you chose to keep was already removed as a duplicate.'),
    );
    await waitFor(() => expect(current.gets).toBeGreaterThanOrEqual(2));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a toast's Undo does nothing while another verdict is in flight", async () => {
    serveDuplicates();
    let calls = 0;
    const bodies = captureVerdicts(() => {
      calls += 1;
      return calls === 1 ? ok({written: 1, enrolled_kept: 0}) : new Promise<Response>(() => {});
    });
    const user = userEvent.setup();
    renderWorkspace('&article=r1&kept=k1');
    await user.click(await screen.findByRole('button', {name: 'Merge, keep selected'}));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Merged', expect.anything()));
    const {action} = vi.mocked(toast.success).mock.calls[0][1] as {action: {onClick: () => void}};

    await waitFor(() => expect(search().get('article')).toBe('r2'));
    await user.click(await screen.findByRole('button', {name: 'Not duplicates'}));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Not duplicates'})).toBeDisabled());
    expect(bodies).toHaveLength(2);

    action.onClick();
    // Give a stray request time to land before asserting none did.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bodies).toHaveLength(2);
  });

  it('a refused Accept N exact batch toasts the mapped copy and refetches', async () => {
    const a = side('A', 'Alpha original');
    const b = side('B', 'Alpha copy one');
    const current = serveDuplicates({open: [pair(b, a, 'exact', 'pmid')], resolved: []});
    const bodies = captureVerdicts(() => fail(409, 'DUPLICATE_HAS_REVIEW_WORK'));
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(await screen.findByRole('button', {name: 'Accept 1 exact'}));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', {name: 'Accept 1 exact'}));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'This record already has full-text or extraction work, so keep it instead.',
      ),
    );
    expect(bodies).toEqual([[{article_id: 'B', kept_article_id: 'A', verdict: 'duplicate'}]]);
    await waitFor(() => expect(current.gets).toBeGreaterThanOrEqual(2));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('buttons are busy and keys ignored while a verdict is in flight', async () => {
    serveDuplicates();
    captureVerdicts(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderWorkspace('&article=r1&kept=k1');
    const merge = await screen.findByRole('button', {name: 'Merge, keep selected'});
    await user.click(merge);
    await waitFor(() => expect(screen.getByRole('button', {name: 'Merge, keep selected'})).toBeDisabled());
    expect(screen.getByRole('button', {name: 'Skip'})).toBeDisabled();
    key('j');
    expect(search().get('article')).toBe('r1');
  });
});

describe('DuplicatesWorkspace — keyboard', () => {
  it('j/k move, Enter opens, Esc closes', async () => {
    serveDuplicates();
    renderWorkspace();
    await pairRow(/^Aspirin trial copy/);
    const cursor = () => document.querySelector('tr[data-cursor]')?.getAttribute('data-pair-row');

    key('j');
    await waitFor(() => expect(cursor()).toBe('r1~k1'));
    key('j');
    await waitFor(() => expect(cursor()).toBe('r2~k2'));
    key('k');
    await waitFor(() => expect(cursor()).toBe('r1~k1'));
    expect(search().has('article')).toBe(false);

    key('Enter');
    await waitFor(() => expect(search().get('article')).toBe('r1'));
    expect(await keepRadio(1, 'Aspirin trial')).toBeChecked();
    // With the panel open, the selection follows the cursor.
    key('j');
    await waitFor(() => expect(search().get('article')).toBe('r2'));

    key('Escape');
    await waitFor(() => expect(screen.queryByRole('radio', {name: /^Keep record 1/})).toBeNull());
    key('Escape');
    await waitFor(() => expect(search().has('article')).toBe(false));
    expect(search().has('kept')).toBe(false);
  });
});
