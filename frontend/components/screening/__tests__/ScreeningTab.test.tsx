/**
 * ScreeningTab — the tab's state machine (loading, load error, not configured,
 * nothing enrolled, running) for managers, members and viewers, plus the
 * reviewer-count form and enrollment.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {MemoryRouter} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {toast} from 'sonner';

import {ScreeningTab} from '@/components/screening/ScreeningTab';
import type {components} from '@/types/api/schema';
import {server} from '@/test/mocks/server';

type ConfigRead = components['schemas']['ScreeningConfigRead'];

const CONFIG_URL = '*/api/v1/projects/:projectId/screening/config';
const ENROLL_URL = '*/api/v1/projects/:projectId/screening/enroll';
const QUEUE_URL = '*/api/v1/projects/:projectId/screening/queue';
const CONFLICTS_URL = '*/api/v1/projects/:projectId/screening/conflicts';
const ASSIGNMENT_URL = '*/api/v1/screening/assignments/:assignmentId';

function config(overrides: Partial<ConfigRead> = {}): ConfigRead {
  return {
    can_arbitrate: false,
    can_manage: true,
    can_review: false,
    enrolled: 0,
    not_enrolled: 0,
    reviewer_capable: 2,
    reviewer_count: null,
    reviewer_count_locked: false,
    ...overrides,
  };
}

const ok = (data: unknown) => HttpResponse.json({ok: true, data});
const fail = (status: number, code: string) =>
  HttpResponse.json({ok: false, error: {code, message: code}}, {status});

function serveConfig(read: ConfigRead) {
  const calls = {count: 0};
  server.use(
    http.get(CONFIG_URL, () => {
      calls.count += 1;
      return ok(read);
    }),
  );
  return calls;
}

function renderTab(path = '/projects/p1?tab=screening') {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ScreeningTab projectId="p1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ARTICLE = {
  id: 'art1',
  title: 'Deep learning for sepsis',
  abstract: 'An abstract.',
  authors: null,
  doi: null,
  journal_title: null,
  pmid: null,
  publication_year: null,
};

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('ScreeningTab', () => {
  it('shows a busy region while the config loads', async () => {
    server.use(http.get(CONFIG_URL, () => new Promise<never>(() => {})));
    renderTab();
    const region = await screen.findByRole('region', {name: 'Loading screening…'});
    expect(region).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the load error and retries', async () => {
    let calls = 0;
    server.use(
      http.get(CONFIG_URL, () => {
        calls += 1;
        return fail(500, 'INTERNAL_ERROR');
      }),
    );
    const user = userEvent.setup();
    renderTab();
    expect(await screen.findByText('Could not load screening')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(calls).toBe(1);

    await user.click(screen.getByRole('button', {name: 'Try again'}));
    await waitFor(() => expect(calls).toBe(2));
  });

  it('lets a manager choose reviewers per record', async () => {
    serveConfig(config({reviewer_capable: 2}));
    let body: unknown = null;
    server.use(
      http.put(CONFIG_URL, async ({request}) => {
        body = await request.json();
        return ok(config({reviewer_count: 2}));
      }),
    );
    const user = userEvent.setup();
    renderTab();

    expect(await screen.findByText('Reviewers per record')).toBeInTheDocument();
    expect(screen.getByRole('radio', {name: '1 reviewer'})).toBeEnabled();
    expect(screen.getByRole('radio', {name: '2 reviewers'})).toBeEnabled();
    expect(screen.getByRole('radio', {name: '3 reviewers'})).toBeDisabled();
    expect(screen.getByText('Needs 3 reviewers in the project')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', {name: '2 reviewers'}));
    await user.click(screen.getByRole('button', {name: 'Save'}));

    await waitFor(() => expect(body).toEqual({reviewer_count: 2}));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Screening is set up'));
  });

  it('explains a frozen reviewer count', async () => {
    serveConfig(config());
    server.use(http.put(CONFIG_URL, () => fail(409, 'SCREENING_CONFIG_FROZEN')));
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', {name: 'Save'}));
    expect(
      await screen.findByText('Reviewers per record cannot change after the first decision.'),
    ).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('explains too few reviewers', async () => {
    serveConfig(config());
    server.use(http.put(CONFIG_URL, () => fail(409, 'SCREENING_TOO_FEW_REVIEWERS')));
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', {name: 'Save'}));
    expect(await screen.findByText('The project has fewer reviewers than that.')).toBeInTheDocument();
  });

  it('tells a non-manager that screening is not set up', async () => {
    serveConfig(config({can_manage: false}));
    renderTab();
    expect(await screen.findByText('Screening is not set up yet')).toBeInTheDocument();
    expect(
      screen.getByText('A project manager chooses how many reviewers screen each record.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Save'})).not.toBeInTheDocument();
  });

  it('lets a manager enroll all articles', async () => {
    const calls = serveConfig(config({reviewer_count: 2, enrolled: 0, not_enrolled: 3}));
    let body: unknown = null;
    server.use(
      http.post(ENROLL_URL, async ({request}) => {
        body = await request.json();
        return ok({enrolled: 3, already_enrolled: 0});
      }),
    );
    const user = userEvent.setup();
    renderTab();

    expect(await screen.findByText('No records to screen')).toBeInTheDocument();
    expect(
      screen.getByText("Enroll the project's articles to start title and abstract screening."),
    ).toBeInTheDocument();
    expect(calls.count).toBe(1);

    await user.click(screen.getByRole('button', {name: 'Enroll all articles'}));

    await waitFor(() => expect(body).toEqual({}));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('3 articles enrolled'));
    await waitFor(() => expect(calls.count).toBe(2));
  });

  it('disables enroll when there is nothing to enroll', async () => {
    serveConfig(config({reviewer_count: 2, enrolled: 0, not_enrolled: 0}));
    renderTab();
    expect(await screen.findByRole('button', {name: 'Enroll all articles'})).toBeDisabled();
    expect(screen.getByText('Add or import articles first')).toBeInTheDocument();
  });

  it('tells a non-manager that nothing is enrolled', async () => {
    serveConfig(config({can_manage: false, can_review: true, reviewer_count: 2}));
    renderTab();
    expect(await screen.findByText('No records to screen')).toBeInTheDocument();
    expect(screen.getByText('A project manager enrolls articles for screening.')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Enroll all articles'})).not.toBeInTheDocument();
  });

  it('offers PubMed import to members', async () => {
    serveConfig(config({can_manage: false, can_review: true, reviewer_count: 2}));
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', {name: 'Import from PubMed'}));
    expect(await screen.findByRole('dialog', {name: 'Import from PubMed'})).toBeInTheDocument();
  });

  it('offers PubMed import from the running header', async () => {
    serveConfig(config({reviewer_count: 2, enrolled: 3, not_enrolled: 0}));
    renderTab();
    expect(await screen.findByRole('button', {name: 'Import from PubMed'})).toBeEnabled();
  });

  it('shows the viewer notice once screening runs', async () => {
    serveConfig(
      config({can_manage: false, can_review: false, can_arbitrate: false, reviewer_count: 2, enrolled: 3}),
    );
    renderTab();
    expect(
      await screen.findByText('You can follow screening here. Only reviewers screen records.'),
    ).toBeInTheDocument();
  });

  it('summarises enrolment in the header', async () => {
    serveConfig(config({reviewer_count: 2, enrolled: 3, not_enrolled: 2}));
    renderTab();
    expect(await screen.findByText('3 enrolled')).toBeInTheDocument();
    expect(screen.getByText('2 not enrolled')).toBeInTheDocument();
    expect(screen.getByText('2 reviewers per record')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Enroll 2 new'})).toBeEnabled();
  });

  it('hides the enroll-new action from a non-manager', async () => {
    serveConfig(
      config({can_manage: false, can_review: true, reviewer_count: 1, enrolled: 3, not_enrolled: 2}),
    );
    renderTab();
    expect(await screen.findByText('1 reviewer per record')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Enroll 2 new'})).not.toBeInTheDocument();
  });

  it('enrolls the new articles from the header', async () => {
    const calls = serveConfig(config({reviewer_count: 2, enrolled: 3, not_enrolled: 2}));
    let body: unknown = null;
    server.use(
      http.post(ENROLL_URL, async ({request}) => {
        body = await request.json();
        return ok({enrolled: 2, already_enrolled: 3});
      }),
    );
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', {name: 'Enroll 2 new'}));
    await waitFor(() => expect(body).toEqual({}));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('2 articles enrolled'));
    await waitFor(() => expect(calls.count).toBe(2));
  });

  it('gives reviewers the queue', async () => {
    serveConfig(config({can_manage: false, can_review: true, reviewer_count: 2, enrolled: 3}));
    server.use(
      http.get(QUEUE_URL, () =>
        ok({
          items: [{assignment_id: 'a1', article: ARTICLE}],
          awaiting_me: 1,
          awaiting_others: 0,
          exclusion_reasons: [],
        }),
      ),
    );
    renderTab();
    expect(await screen.findByRole('heading', {name: 'Deep learning for sepsis'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Include'})).toBeInTheDocument();
  });

  it('gives arbitrators a conflicts tab with its count', async () => {
    serveConfig(config({can_manage: false, can_review: true, can_arbitrate: true, reviewer_count: 2, enrolled: 3}));
    server.use(
      http.get(QUEUE_URL, () =>
        ok({
          items: [{assignment_id: 'a1', article: ARTICLE}],
          awaiting_me: 1,
          awaiting_others: 0,
          exclusion_reasons: [],
        }),
      ),
      http.get(CONFLICTS_URL, () =>
        ok({
          exclusion_reasons: [],
          items: [
            {assignment_id: 'c1', article: {...ARTICLE, id: 'art2', title: 'Conflicted one'}, decisions: []},
            {assignment_id: 'c2', article: {...ARTICLE, id: 'art3', title: 'Conflicted two'}, decisions: []},
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    renderTab();

    expect(await screen.findByRole('heading', {name: 'Deep learning for sepsis'})).toBeInTheDocument();
    await user.click(await screen.findByRole('tab', {name: 'Conflicts (2)'}));
    expect(await screen.findByText('Conflicted one')).toBeInTheDocument();
    expect(screen.getByText('Conflicted two')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', {name: 'Screen'}));
    expect(await screen.findByRole('heading', {name: 'Deep learning for sepsis'})).toBeInTheDocument();
  });

  it('shows an arbitrator who does not review the conflicts list', async () => {
    serveConfig(config({can_manage: false, can_review: false, can_arbitrate: true, reviewer_count: 2, enrolled: 3}));
    server.use(
      http.get(CONFLICTS_URL, () =>
        ok({
          exclusion_reasons: [],
          items: [{assignment_id: 'c1', article: {...ARTICLE, title: 'Conflicted one'}, decisions: []}],
        }),
      ),
    );
    renderTab();

    expect(await screen.findByText('Conflicted one')).toBeInTheDocument();
    expect(screen.getByRole('tab', {name: 'Conflicts (1)'})).toBeInTheDocument();
    expect(screen.queryByRole('tab', {name: 'Screen'})).not.toBeInTheDocument();
    expect(
      screen.queryByText('You can follow screening here. Only reviewers screen records.'),
    ).not.toBeInTheDocument();
  });

  it('never requests conflicts for a non-arbitrator', async () => {
    serveConfig(config({can_manage: false, can_review: true, can_arbitrate: false, reviewer_count: 2, enrolled: 3}));
    let conflictCalls = 0;
    server.use(
      http.get(QUEUE_URL, () =>
        ok({
          items: [{assignment_id: 'a1', article: ARTICLE}],
          awaiting_me: 1,
          awaiting_others: 0,
          exclusion_reasons: [],
        }),
      ),
      http.get(CONFLICTS_URL, () => {
        conflictCalls += 1;
        return ok({exclusion_reasons: [], items: []});
      }),
    );
    renderTab();

    expect(await screen.findByRole('heading', {name: 'Deep learning for sepsis'})).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(conflictCalls).toBe(0);
  });

  it('opens a record from ?assignment', async () => {
    serveConfig(
      config({can_manage: false, can_review: false, can_arbitrate: false, reviewer_count: 2, enrolled: 3}),
    );
    server.use(
      http.get(ASSIGNMENT_URL, ({params}) =>
        ok({
          id: params.assignmentId,
          project_id: 'p1',
          status: 'decided',
          exclusion_reasons: [],
          article: ARTICLE,
          my_decision: null,
          outcome: {decision: 'include', exclusion_reason: null, kind: 'solo', reasons_differ: false},
          peer_decisions: [],
        }),
      ),
    );
    const user = userEvent.setup();
    renderTab('/projects/p1?tab=screening&assignment=a1');
    expect(await screen.findByRole('heading', {name: 'Deep learning for sepsis'})).toBeInTheDocument();
    expect(screen.getByText('single reviewer')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Include'})).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: 'Back to screening'}));
    expect(
      await screen.findByText('You can follow screening here. Only reviewers screen records.'),
    ).toBeInTheDocument();
  });

  it('leaves decision keys to another open dialog', async () => {
    serveConfig(config({can_manage: false, can_review: true, reviewer_count: 2, enrolled: 3}));
    server.use(
      http.get(QUEUE_URL, () =>
        ok({
          items: [{assignment_id: 'a1', article: ARTICLE}],
          awaiting_me: 1,
          awaiting_others: 0,
          exclusion_reasons: [],
        }),
      ),
    );
    let posted = 0;
    server.use(
      http.post('*/api/v1/screening/assignments/:assignmentId/decisions', () => {
        posted += 1;
        return ok({});
      }),
    );
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('heading', {name: 'Deep learning for sepsis'});

    await user.click(screen.getByRole('button', {name: 'Import from PubMed'}));
    await screen.findByRole('dialog', {name: 'Import from PubMed'});
    await user.keyboard('1');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posted).toBe(0);
  });
});
