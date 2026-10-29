/**
 * ConflictsPanel — the arbitrator's list: every reviewer decision per
 * record, the two ways to rule (adopt a decision, decide differently), and
 * the 409s that mean the list is out of date.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn()}}));

import {toast} from 'sonner';

import {ConflictsPanel} from '@/components/screening/ConflictsPanel';
import {server} from '@/test/mocks/server';

const CONFLICTS_URL = '*/api/v1/projects/:projectId/screening/conflicts';
const ARBITRATION_URL = '*/api/v1/screening/assignments/:assignmentId/arbitration';

const ok = (data: unknown) => HttpResponse.json({ok: true, data});
const fail = (status: number, code: string) =>
  HttpResponse.json({ok: false, error: {code, message: code}}, {status});

const ARTICLE = {
  id: 'art1',
  title: 'Deep learning for sepsis',
  abstract: 'We trained a model on ICU data.',
  authors: null,
  doi: null,
  journal_title: null,
  pmid: null,
  publication_year: null,
};

const DECISION_A = {
  id: 'dA',
  reviewer_id: 'rA',
  reviewer_name: 'Ana',
  decision: 'include',
  exclusion_reason: null,
  rationale: null,
  created_at: '2026-10-01T10:00:00Z',
};
const DECISION_B = {
  id: 'dB',
  reviewer_id: 'rB',
  reviewer_name: 'Bruno',
  decision: 'exclude',
  exclusion_reason: 'Not ML',
  rationale: null,
  created_at: '2026-10-01T11:00:00Z',
};

const CONFLICTS = {
  exclusion_reasons: ['Wrong population', 'Not ML'],
  items: [{assignment_id: 'a1', article: ARTICLE, decisions: [DECISION_A, DECISION_B]}],
};

function serveConflicts(data: unknown = CONFLICTS) {
  const calls = {count: 0};
  server.use(
    http.get(CONFLICTS_URL, () => {
      calls.count += 1;
      return ok(data);
    }),
  );
  return calls;
}

function serveArbitration() {
  const posted: {assignmentId: string; body: unknown}[] = [];
  server.use(
    http.post(ARBITRATION_URL, async ({params, request}) => {
      posted.push({assignmentId: String(params.assignmentId), body: await request.json()});
      return ok({});
    }),
  );
  return posted;
}

function renderPanel() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  return render(
    <QueryClientProvider client={client}>
      <ConflictsPanel projectId="p1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('ConflictsPanel', () => {
  it('lists each conflict with every reviewer decision', async () => {
    serveConflicts();
    renderPanel();

    expect(await screen.findByText('Deep learning for sepsis')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Include')).toBeInTheDocument();
    expect(screen.getByText('Bruno')).toBeInTheDocument();
    expect(screen.getByText('Exclude')).toBeInTheDocument();
    expect(screen.getByText('Not ML')).toBeInTheDocument();
  });

  it('names a reviewer without a profile name generically', async () => {
    serveConflicts({
      ...CONFLICTS,
      items: [{...CONFLICTS.items[0], decisions: [{...DECISION_A, reviewer_name: null}, DECISION_B]}],
    });
    renderPanel();
    expect(await screen.findByText('A reviewer')).toBeInTheDocument();
  });

  it('keeps the abstract folded until asked', async () => {
    serveConflicts();
    const user = userEvent.setup();
    renderPanel();

    const toggle = await screen.findByRole('button', {name: /Deep learning for sepsis/});
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('We trained a model on ICU data.')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByText('We trained a model on ICU data.')).toBeInTheDocument();
  });

  it('resolves by choosing a reviewer decision', async () => {
    serveConflicts();
    const posted = serveArbitration();
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', {name: "Use Bruno's decision"}));

    await waitFor(() =>
      expect(posted).toEqual([
        {assignmentId: 'a1', body: {ruled_on_decision_ids: ['dA', 'dB'], selected_decision_id: 'dB'}},
      ]),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Conflict resolved'));
  });

  it('resolves by deciding differently with a reason and a note', async () => {
    serveConflicts();
    const posted = serveArbitration();
    const user = userEvent.setup();
    renderPanel();

    await user.type(await screen.findByLabelText('Note for the record (optional)'), 'Out of scope');
    await user.click(screen.getByRole('button', {name: 'Decide differently'}));
    await user.click(screen.getByRole('button', {name: /Exclude with reason/}));
    await user.click(await screen.findByRole('button', {name: /Wrong population/}));

    await waitFor(() =>
      expect(posted).toEqual([
        {
          assignmentId: 'a1',
          body: {
            ruled_on_decision_ids: ['dA', 'dB'],
            decision: 'exclude',
            exclusion_reason: 'Wrong population',
            rationale: 'Out of scope',
          },
        },
      ]),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Conflict resolved'));
  });

  it('sends the note with an adopted decision too', async () => {
    serveConflicts();
    const posted = serveArbitration();
    const user = userEvent.setup();
    renderPanel();

    await user.type(await screen.findByLabelText('Note for the record (optional)'), 'Agree with Ana');
    await user.click(screen.getByRole('button', {name: "Use Ana's decision"}));

    await waitFor(() =>
      expect(posted).toEqual([
        {
          assignmentId: 'a1',
          body: {ruled_on_decision_ids: ['dA', 'dB'], selected_decision_id: 'dA', rationale: 'Agree with Ana'},
        },
      ]),
    );
  });

  it('posts one ruling when two choices are clicked back to back', async () => {
    serveConflicts();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let posts = 0;
    server.use(
      http.post(ARBITRATION_URL, async () => {
        posts += 1;
        await gate;
        return ok({});
      }),
    );
    renderPanel();

    const ana = await screen.findByRole('button', {name: "Use Ana's decision"});
    const bruno = screen.getByRole('button', {name: "Use Bruno's decision"});
    // Back to back, before React re-renders `isPending` into `disabled`: only
    // the in-flight flag can stop the second ruling.
    fireEvent.click(ana);
    fireEvent.click(bruno);

    release();
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(posts).toBe(1);
  });

  it('shows the empty state', async () => {
    serveConflicts({exclusion_reasons: [], items: []});
    renderPanel();
    expect(await screen.findByText('No conflicts to resolve')).toBeInTheDocument();
    expect(screen.getByText('Records where reviewers disagree appear here.')).toBeInTheDocument();
  });

  it('reloads on stale decisions', async () => {
    const calls = serveConflicts();
    server.use(http.post(ARBITRATION_URL, () => fail(409, 'SCREENING_STALE_DECISIONS')));
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', {name: "Use Ana's decision"}));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'The decisions changed since you opened this conflict. It has been reloaded.',
      ),
    );
    await waitFor(() => expect(calls.count).toBe(2));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('reloads when the record is no longer in conflict', async () => {
    const calls = serveConflicts();
    server.use(http.post(ARBITRATION_URL, () => fail(409, 'SCREENING_NOT_IN_CONFLICT')));
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', {name: "Use Ana's decision"}));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This record is no longer in conflict.'));
    await waitFor(() => expect(calls.count).toBe(2));
  });

  it('shows the load error', async () => {
    server.use(http.get(CONFLICTS_URL, () => fail(500, 'INTERNAL_ERROR')));
    renderPanel();
    expect(await screen.findByText('Could not load screening')).toBeInTheDocument();
  });
});
