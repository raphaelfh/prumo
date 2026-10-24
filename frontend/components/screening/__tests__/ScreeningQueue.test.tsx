/**
 * ScreeningQueue — the reviewer's current record, keyboard decisions, the
 * waiting / done states and the decision 409s.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {MemoryRouter} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {toast} from 'sonner';

import {ScreeningQueue} from '@/components/screening/ScreeningQueue';
import type {ScreeningQueueRead} from '@/services/screeningService';
import {server} from '@/test/mocks/server';

const QUEUE_URL = '*/api/v1/projects/:projectId/screening/queue';
const DECIDE_URL = '*/api/v1/screening/assignments/:assignmentId/decisions';

type Item = ScreeningQueueRead['items'][number];

function item(id: string, article: Partial<Item['article']> = {}): Item {
  return {
    assignment_id: id,
    article: {
      id: `art-${id}`,
      title: `Title ${id}`,
      abstract: `Abstract ${id}`,
      authors: ['Smith J', 'Doe A'],
      doi: null,
      journal_title: 'Lancet',
      pmid: null,
      publication_year: 2020,
      ...article,
    },
  };
}

function queue(overrides: Partial<ScreeningQueueRead> = {}): ScreeningQueueRead {
  return {
    items: [item('a1'), item('a2')],
    awaiting_me: 2,
    awaiting_others: 0,
    exclusion_reasons: [],
    ...overrides,
  };
}

function serveQueue(read: ScreeningQueueRead) {
  const calls = {count: 0};
  server.use(
    http.get(QUEUE_URL, () => {
      calls.count += 1;
      return HttpResponse.json({ok: true, data: read});
    }),
  );
  return calls;
}

function serveDecision() {
  const posted: {assignmentId: string; body: unknown}[] = [];
  server.use(
    http.post(DECIDE_URL, async ({params, request}) => {
      posted.push({assignmentId: String(params.assignmentId), body: await request.json()});
      return HttpResponse.json({ok: true, data: {}});
    }),
  );
  return posted;
}

function failDecision(code: string) {
  server.use(
    http.post(DECIDE_URL, () => HttpResponse.json({ok: false, error: {code, message: code}}, {status: 409})),
  );
}

function renderQueue() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/p1?tab=screening']}>
        <ScreeningQueue projectId="p1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
});

describe('ScreeningQueue', () => {
  it('shows the current record with its abstract and the remaining count', async () => {
    serveQueue(queue());
    renderQueue();
    expect(await screen.findByRole('heading', {name: 'Title a1'})).toBeInTheDocument();
    expect(screen.getByText('Abstract a1')).toBeInTheDocument();
    expect(screen.getByText('Smith J, Doe A · Lancet · 2020')).toBeInTheDocument();
    expect(screen.getByText('2 left for you')).toBeInTheDocument();
    expect(screen.queryByText('Title a2')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Include'})).toBeEnabled();
  });

  it('decides with the keyboard', async () => {
    serveQueue(queue());
    const posted = serveDecision();
    const user = userEvent.setup();
    renderQueue();
    await screen.findByRole('heading', {name: 'Title a1'});

    await user.keyboard('1');

    await waitFor(() => expect(posted).toEqual([{assignmentId: 'a1', body: {decision: 'include'}}]));
  });

  it('ignores a held key', async () => {
    serveQueue(queue());
    const posted = serveDecision();
    renderQueue();
    await screen.findByRole('heading', {name: 'Title a1'});

    fireEvent.keyDown(window, {key: '1', repeat: true});

    // Give a stray POST the chance to land before asserting there was none.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posted).toEqual([]);
  });

  it('sends one decision for two back-to-back keys', async () => {
    serveQueue(queue());
    const posted = serveDecision();
    renderQueue();
    await screen.findByRole('heading', {name: 'Title a1'});

    // No re-render between the two keys: `isPending` has not reached the props yet.
    fireEvent.keyDown(window, {key: '1'});
    fireEvent.keyDown(window, {key: '2'});

    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posted).toEqual([{assignmentId: 'a1', body: {decision: 'include'}}]);
  });

  it('excludes with a numbered reason', async () => {
    serveQueue(queue({exclusion_reasons: ['Wrong population', 'Not ML']}));
    const posted = serveDecision();
    const user = userEvent.setup();
    renderQueue();
    await screen.findByRole('heading', {name: 'Title a1'});

    await user.keyboard('e');
    expect(await screen.findByRole('dialog', {name: 'Exclusion reason'})).toBeInTheDocument();
    await user.keyboard('2');

    await waitFor(() =>
      expect(posted).toEqual([
        {assignmentId: 'a1', body: {decision: 'exclude', exclusion_reason: 'Not ML'}},
      ]),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('hides exclude-with-reason when the protocol has no reasons', async () => {
    serveQueue(queue());
    renderQueue();
    await screen.findByRole('heading', {name: 'Title a1'});
    expect(screen.queryByRole('button', {name: 'Exclude with reason'})).not.toBeInTheDocument();
  });

  it('says when a record has no abstract', async () => {
    serveQueue(queue({items: [item('a1', {abstract: null})]}));
    renderQueue();
    expect(await screen.findByText('No abstract available')).toBeInTheDocument();
  });

  it('says it is waiting on other reviewers', async () => {
    serveQueue(queue({items: [], awaiting_me: 0, awaiting_others: 3}));
    renderQueue();
    expect(await screen.findByText('Waiting on other reviewers')).toBeInTheDocument();
    expect(
      screen.getByText('3 records you screened are waiting for other reviewers or an arbitrator.'),
    ).toBeInTheDocument();
  });

  it('says all done', async () => {
    serveQueue(queue({items: [], awaiting_me: 0, awaiting_others: 0}));
    renderQueue();
    expect(await screen.findByText('All done')).toBeInTheDocument();
    expect(screen.getByText('There is nothing left for you to screen.')).toBeInTheDocument();
  });

  it('shows the reviewer-cap message on 409', async () => {
    serveQueue(queue());
    failDecision('SCREENING_REVIEWER_CAP');
    const user = userEvent.setup();
    renderQueue();
    await user.click(await screen.findByRole('button', {name: 'Include'}));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('This record already has all its reviewers.'),
    );
  });

  it('shows the reasons-changed message on SCREENING_UNKNOWN_EXCLUSION_REASON', async () => {
    const calls = serveQueue(queue({exclusion_reasons: ['Wrong population']}));
    failDecision('SCREENING_UNKNOWN_EXCLUSION_REASON');
    const user = userEvent.setup();
    renderQueue();
    await screen.findByRole('heading', {name: 'Title a1'});
    expect(calls.count).toBe(1);

    await user.keyboard('e');
    await screen.findByRole('dialog', {name: 'Exclusion reason'});
    await user.keyboard('1');

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "The protocol's exclusion reasons changed. Reload and pick again.",
      ),
    );
    await waitFor(() => expect(calls.count).toBe(2));
  });

  it('shows the not-configured message on SCREENING_NOT_CONFIGURED', async () => {
    serveQueue(queue());
    failDecision('SCREENING_NOT_CONFIGURED');
    const user = userEvent.setup();
    renderQueue();
    await user.click(await screen.findByRole('button', {name: 'Maybe'}));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Screening is not set up for this project.'));
  });

  it('links to the last decided record', async () => {
    serveQueue(queue());
    serveDecision();
    const user = userEvent.setup();
    renderQueue();
    await screen.findByRole('heading', {name: 'Title a1'});
    expect(screen.queryByRole('link', {name: 'Change last decision'})).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: 'Include'}));

    const link = await screen.findByRole('link', {name: 'Change last decision'});
    expect(link.getAttribute('href')).toContain('assignment=a1');
    expect(link.getAttribute('href')).toContain('tab=screening');
  });
});
