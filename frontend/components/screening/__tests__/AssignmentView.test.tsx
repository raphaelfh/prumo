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
import type {ScreeningAssignmentRead} from '@/services/screeningService';
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

function renderView({canReview = true, onBack = vi.fn()} = {}) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  render(
    <QueryClientProvider client={client}>
      <AssignmentView assignmentId="a1" canReview={canReview} onBack={onBack} />
    </QueryClientProvider>,
  );
  return {onBack};
}

describe('AssignmentView', () => {
  it('renders not-found for a missing assignment', async () => {
    failAssignment(404, 'NOT_FOUND');
    const user = userEvent.setup();
    const {onBack} = renderView();
    expect(await screen.findByText('This record no longer exists.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Back to screening'}));
    expect(onBack).toHaveBeenCalled();
  });

  it('renders forbidden for a non-member', async () => {
    failAssignment(403, 'FORBIDDEN');
    renderView();
    expect(await screen.findByText('You do not have permission to do this.')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Back to screening'})).toBeInTheDocument();
  });

  it('shows no peers while the record is blind', async () => {
    serveAssignment(assignment());
    renderView();
    expect(await screen.findByRole('heading', {name: 'Deep learning for sepsis'})).toBeInTheDocument();
    expect(screen.getByText('Waiting for other reviewers')).toBeInTheDocument();
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
    renderView();
    expect(await screen.findByText('Outcome')).toBeInTheDocument();
    expect(screen.getByText('Decided')).toBeInTheDocument();
    expect(screen.getByText('consensus')).toBeInTheDocument();
    expect(screen.getByText('Other reviewers')).toBeInTheDocument();
    expect(screen.getByText('Ana Lima')).toBeInTheDocument();
    expect(screen.queryByText('Reviewers gave different reasons')).not.toBeInTheDocument();
  });

  it('lets a reviewer change the decision', async () => {
    const calls = serveAssignment(assignment());
    let body: unknown = null;
    server.use(
      http.post(DECIDE_URL, async ({request}) => {
        body = await request.json();
        return HttpResponse.json({ok: true, data: assignment()});
      }),
    );
    const user = userEvent.setup();
    renderView({canReview: true});
    await screen.findByRole('heading', {name: 'Deep learning for sepsis'});
    expect(calls.count).toBe(1);

    await user.click(screen.getByRole('button', {name: 'Exclude'}));

    await waitFor(() => expect(body).toEqual({decision: 'exclude'}));
    await waitFor(() => expect(calls.count).toBe(2));
  });

  it('sends one decision for two back-to-back keys', async () => {
    serveAssignment(assignment());
    const bodies: unknown[] = [];
    server.use(
      http.post(DECIDE_URL, async ({request}) => {
        bodies.push(await request.json());
        return HttpResponse.json({ok: true, data: assignment()});
      }),
    );
    renderView({canReview: true});
    await screen.findByRole('heading', {name: 'Deep learning for sepsis'});

    fireEvent.keyDown(window, {key: '1'});
    fireEvent.keyDown(window, {key: '2'});

    await waitFor(() => expect(bodies.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bodies).toEqual([{decision: 'include'}]);
  });

  it('decides again once the first decision settles', async () => {
    serveAssignment(assignment());
    const bodies: unknown[] = [];
    server.use(
      http.post(DECIDE_URL, async ({request}) => {
        bodies.push(await request.json());
        return HttpResponse.json({ok: true, data: assignment()});
      }),
    );
    const user = userEvent.setup();
    renderView({canReview: true});
    await screen.findByRole('heading', {name: 'Deep learning for sepsis'});

    await user.click(screen.getByRole('button', {name: 'Include'}));
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
