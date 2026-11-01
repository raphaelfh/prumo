/**
 * AssignmentView — one record as the caller may see it. The client renders
 * `peer_decisions` and `outcome` exactly as the API returns them.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {AssignmentView} from '@/components/screening/AssignmentView';
import type {ScreeningAssignmentRead, ScreeningConfigRead, ScreeningRecordRow} from '@/services/screeningService';
import {server} from '@/test/mocks/server';

const ASSIGNMENT_URL = '*/api/v1/screening/assignments/:assignmentId';
const DECIDE_URL = '*/api/v1/screening/assignments/:assignmentId/decisions';

function assignment(overrides: Partial<ScreeningAssignmentRead> = {}): ScreeningAssignmentRead {
  return {
    id: 'a1',
    project_id: 'p1',
    status: 'awaiting_others',
    exclusion_reasons: [],
    article: {
      id: 'art1',
      title: 'Deep learning for sepsis',
      abstract: 'An abstract.',
      authors: ['Smith J'],
      doi: null,
      journal_title: 'Lancet',
      pmid: null,
      publication_year: 2021,
    },
    my_decision: {
      id: 'd1',
      decision: 'include',
      exclusion_reason: null,
      rationale: null,
      created_at: '2026-10-23T00:00:00Z',
    },
    outcome: null,
    peer_decisions: [],
    ...overrides,
  };
}

function serveAssignment(read: ScreeningAssignmentRead) {
  const calls = {count: 0};
  server.use(
    http.get(ASSIGNMENT_URL, () => {
      calls.count += 1;
      return HttpResponse.json({ok: true, data: read});
    }),
  );
  return calls;
}

function failAssignment(status: number, code: string) {
  server.use(
    http.get(ASSIGNMENT_URL, () => HttpResponse.json({ok: false, error: {code, message: code}}, {status})),
  );
}

const ROW: ScreeningRecordRow = {
  article_id: 'art1',
  assignment_id: 'a1',
  doi: null,
  first_author: 'Smith J',
  has_pdf: false,
  ingestion_source: null,
  journal_title: 'Lancet',
  my_decision: 'include',
  my_exclusion_reason: null,
  outcome: null,
  outcome_exclusion_reason: null,
  outcome_kind: null,
  pmid: null,
  publication_year: 2021,
  queue_rank: 1,
  status: 'waiting',
  title: 'Deep learning for sepsis',
};

function config(canReview: boolean): ScreeningConfigRead {
  return {
    can_arbitrate: false,
    can_manage: false,
    can_review: canReview,
    enrolled: 1,
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
}

function renderView({canReview = true, row = ROW}: {canReview?: boolean; row?: ScreeningRecordRow} = {}) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  const onNotInPhase = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <AssignmentView
        assignmentId="a1"
        row={row}
        config={config(canReview)}
        onDecided={vi.fn()}
        onNotInPhase={onNotInPhase}
      />
    </QueryClientProvider>,
  );
  return {onNotInPhase, client};
}

describe('AssignmentView', () => {
  it('hands a missing assignment to onNotInPhase, with no back button', async () => {
    failAssignment(404, 'NOT_FOUND');
    const {onNotInPhase} = renderView();
    await waitFor(() => expect(onNotInPhase).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', {name: 'Back to screening'})).toBeNull();
  });

  it('shows no peers while the record is blind', async () => {
    serveAssignment(assignment());
    renderView();
    expect(await screen.findByRole('heading', {name: 'Deep learning for sepsis'})).toBeInTheDocument();
    expect(screen.getByText('Waiting for others')).toBeInTheDocument();
    expect(screen.getByText('Your decision')).toBeInTheDocument();
    expect(screen.queryByText('Other reviewers')).not.toBeInTheDocument();
    expect(screen.queryByText('Outcome')).not.toBeInTheDocument();
  });

  it('shows the outcome and peers once decided', async () => {
    serveAssignment(
      assignment({
        status: 'decided',
        outcome: {decision: 'include', exclusion_reason: null, kind: 'consensus', reasons_differ: false},
        peer_decisions: [
          {
            id: 'd2',
            decision: 'include',
            exclusion_reason: null,
            rationale: null,
            created_at: '2026-10-23T00:00:00Z',
            reviewer_id: 'u2',
            reviewer_name: 'Ana Lima',
          },
        ],
      }),
    );
    renderView({row: {...ROW, status: 'included', outcome: 'include', outcome_kind: 'consensus'}});
    expect(await screen.findByText('Outcome')).toBeInTheDocument();
    expect(screen.getByText('Included')).toBeInTheDocument();
    expect(screen.getByText('consensus')).toBeInTheDocument();
    expect(screen.getByText('Other reviewers')).toBeInTheDocument();
    expect(screen.getByText('Ana Lima')).toBeInTheDocument();
    expect(screen.queryByText('Reviewers gave different reasons')).not.toBeInTheDocument();
  });

  it('shows a decided reviewer their decision read-only', async () => {
    serveAssignment(assignment());
    renderView({canReview: true});
    await screen.findByRole('heading', {name: 'Deep learning for sepsis'});
    expect(screen.getByText('Your decision')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Include'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Exclude'})).not.toBeInTheDocument();
  });

  it('hides decision buttons from a reviewer not seated on the record', async () => {
    serveAssignment(assignment({status: 'conflict', my_decision: null}));
    renderView({canReview: true});
    await screen.findByRole('heading', {name: 'Deep learning for sepsis'});
    expect(screen.queryByRole('button', {name: 'Include'})).not.toBeInTheDocument();
  });

  it('lets a reviewer decide a record they have not decided', async () => {
    const calls = serveAssignment(assignment({status: 'awaiting_me', my_decision: null}));
    let body: unknown = null;
    server.use(
      http.post(DECIDE_URL, async ({request}) => {
        body = await request.json();
        return HttpResponse.json({ok: true, data: assignment()});
      }),
    );
    const user = userEvent.setup();
    renderView({canReview: true, row: {...ROW, status: 'to_screen', my_decision: null}});
    await screen.findByRole('heading', {name: 'Deep learning for sepsis'});
    expect(calls.count).toBe(1);

    await user.click(screen.getByRole('button', {name: 'Exclude'}));

    await waitFor(() => expect(body).toEqual({decision: 'exclude'}));
    await waitFor(() => expect(calls.count).toBe(2));
  });

  it('sends one decision for two back-to-back keys', async () => {
    serveAssignment(assignment({status: 'awaiting_me', my_decision: null}));
    const bodies: unknown[] = [];
    server.use(
      http.post(DECIDE_URL, async ({request}) => {
        bodies.push(await request.json());
        return HttpResponse.json({ok: true, data: assignment()});
      }),
    );
    const {client} = renderView({canReview: true});
    await screen.findByRole('heading', {name: 'Deep learning for sepsis'});

    fireEvent.keyDown(window, {key: '1'});
    fireEvent.keyDown(window, {key: '2'});

    // A decision starts its mutation synchronously in the key handler.
    expect(client.getMutationCache().getAll()).toHaveLength(1);
    await waitFor(() => expect(bodies).toEqual([{decision: 'include'}]));
  });

  it('decides again once a failed first decision settles', async () => {
    serveAssignment(assignment({status: 'awaiting_me', my_decision: null}));
    const bodies: unknown[] = [];
    server.use(
      http.post(DECIDE_URL, async ({request}) => {
        bodies.push(await request.json());
        if (bodies.length === 1) {
          return HttpResponse.json({ok: false, error: {code: 'INTERNAL_ERROR', message: 'x'}}, {status: 500});
        }
        return HttpResponse.json({ok: true, data: assignment()});
      }),
    );
    const user = userEvent.setup();
    renderView({canReview: true});
    await screen.findByRole('heading', {name: 'Deep learning for sepsis'});

    await user.click(screen.getByRole('button', {name: 'Include'}));
    await waitFor(() => expect(bodies).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Exclude'})).toBeEnabled());
    await user.click(screen.getByRole('button', {name: 'Exclude'}));

    await waitFor(() => expect(bodies).toEqual([{decision: 'include'}, {decision: 'exclude'}]));
  });

  it('hides decision buttons from viewers', async () => {
    serveAssignment(assignment({my_decision: null}));
    renderView({canReview: false});
    await screen.findByRole('heading', {name: 'Deep learning for sepsis'});
    expect(screen.queryByRole('button', {name: 'Include'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Exclude'})).not.toBeInTheDocument();
  });
});
