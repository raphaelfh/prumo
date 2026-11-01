/**
 * ScreeningRecordPanel — every panel state (spec §4.4, §4.6 panel list): the
 * placeholder, not enrolled, the assignment read's loading / error / not in
 * phase, deciding (once per settle), the solo re-decide, the in-panel ruling
 * and the read-only body.
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
vi.mock('@/components/runs/RunPdfContent', () => ({RunPdfContent: () => <div data-testid="pdf" />}));

import {toast} from 'sonner';

import {ScreeningRecordPanel} from '@/components/screening/ScreeningRecordPanel';
import {screeningKeys} from '@/lib/query-keys/screening';
import type {
  ScreeningAssignmentRead,
  ScreeningConfigRead,
  ScreeningPhase,
  ScreeningRecordRow,
} from '@/services/screeningService';
import {server} from '@/test/mocks/server';

const ASSIGNMENT_URL = '*/api/v1/screening/assignments/:assignmentId';
const DECIDE_URL = '*/api/v1/screening/assignments/:assignmentId/decisions';
const ARBITRATION_URL = '*/api/v1/screening/assignments/:assignmentId/arbitration';
const ENROLL_URL = '*/api/v1/projects/:projectId/screening/enroll';
const FILES_URL = '*/api/v1/articles/:articleId/files';

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
    ta_outcome: null,
    ta_outcome_kind: null,
    ta_reviewer_count: null,
    pmid: null,
    publication_year: 2021,
    queue_rank: 1,
    status: 'to_screen',
    title: 'Deep learning for sepsis',
    ...overrides,
  };
}

function config(overrides: Partial<ScreeningConfigRead> = {}): ScreeningConfigRead {
  return {
    can_arbitrate: false,
    can_manage: false,
    can_review: true,
    enrolled: 3,
    exclusion_reasons: [],
    not_enrolled: 0,
    reviewer_capable: 2,
    reviewer_count: 2,
    reviewer_count_locked: true,
    full_text_reviewer_count: null,
    full_text_count_locked: false,
    full_text_ready: 0,
    full_text_enrolled: 0,
    ...overrides,
  };
}

const PEER_A = {
  id: 'dA',
  reviewer_id: 'rA',
  reviewer_name: 'Ana Lima',
  decision: 'include' as const,
  exclusion_reason: null,
  rationale: null,
  created_at: '2026-10-01T10:00:00Z',
};
const PEER_B = {
  id: 'dB',
  reviewer_id: 'rB',
  reviewer_name: 'Bruno Costa',
  decision: 'exclude' as const,
  exclusion_reason: 'Not ML',
  rationale: null,
  created_at: '2026-10-01T11:00:00Z',
};

function assignment(overrides: Partial<ScreeningAssignmentRead> = {}): ScreeningAssignmentRead {
  return {
    id: 'a1',
    project_id: 'p1',
    status: 'awaiting_me',
    exclusion_reasons: ['Wrong population', 'Not ML'],
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
    my_decision: null,
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
      return ok(read);
    }),
  );
  return calls;
}

interface RenderOptions {
  row?: ScreeningRecordRow | null;
  config?: ScreeningConfigRead;
  phase?: ScreeningPhase;
}

function renderPanel({row: r = row(), config: c = config(), phase = 'title_abstract'}: RenderOptions = {}) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  const onDecided = vi.fn<(row: ScreeningRecordRow) => void>();
  const onNotInPhase = vi.fn<() => void>();
  render(
    <QueryClientProvider client={client}>
      <ScreeningRecordPanel
        projectId="p1"
        phase={phase}
        maximized={false}
        row={r}
        config={c}
        onDecided={onDecided}
        onNotInPhase={onNotInPhase}
      />
    </QueryClientProvider>,
  );
  return {client, onDecided, onNotInPhase};
}

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('ScreeningRecordPanel', () => {
  it('shows the placeholder with no row', () => {
    renderPanel({row: null});
    expect(screen.getByText('Select a record')).toBeInTheDocument();
    expect(screen.getByText('Pick a row to screen it here.')).toBeInTheDocument();
  });

  it('shows a skeleton while the assignment loads', async () => {
    server.use(http.get(ASSIGNMENT_URL, () => new Promise<never>(() => {})));
    renderPanel();
    expect(await screen.findByText('Loading screening…')).toBeInTheDocument();
  });

  it('shows an error with retry inside the panel', async () => {
    // The assignment read retries a 5xx once on its own; the panel's button is the next try.
    let healthy = false;
    server.use(http.get(ASSIGNMENT_URL, () => (healthy ? ok(assignment()) : fail(500, 'INTERNAL_ERROR'))));
    const user = userEvent.setup();
    const {onNotInPhase} = renderPanel();
    const retry = await screen.findByRole('button', {name: 'Try again'}, {timeout: 4000});
    expect(screen.getByText('Could not load screening')).toBeInTheDocument();
    healthy = true;
    await user.click(retry);
    expect(await screen.findByRole('heading', {name: 'Deep learning for sepsis'})).toBeInTheDocument();
    expect(onNotInPhase).not.toHaveBeenCalled();
  });

  it.each([
    [404, 'NOT_FOUND'],
    [403, 'FORBIDDEN'],
  ])('calls onNotInPhase on a %i assignment read', async (status, code) => {
    server.use(http.get(ASSIGNMENT_URL, () => fail(status, code)));
    const {onNotInPhase} = renderPanel();
    await waitFor(() => expect(onNotInPhase).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('You do not have permission to do this.')).toBeNull();
  });

  it('decides on a To screen record and calls onDecided', async () => {
    serveAssignment(assignment());
    let body: unknown = null;
    server.use(
      http.post(DECIDE_URL, async ({request}) => {
        body = await request.json();
        return ok(assignment({status: 'awaiting_others'}));
      }),
    );
    const user = userEvent.setup();
    const r = row();
    const {onDecided} = renderPanel({row: r});
    await user.click(await screen.findByRole('button', {name: /Include/}));
    await waitFor(() => expect(body).toEqual({decision: 'include'}));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith(r));
  });

  it('posts once for two fast key presses', async () => {
    serveAssignment(assignment());
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let posts = 0;
    server.use(
      http.post(DECIDE_URL, async () => {
        posts += 1;
        await gate;
        return ok(assignment({status: 'awaiting_others'}));
      }),
    );
    const {client, onDecided} = renderPanel();
    await screen.findByRole('button', {name: /Include/});

    fireEvent.keyDown(window, {key: '1'});
    fireEvent.keyDown(window, {key: '1'});
    expect(client.getMutationCache().getAll()).toHaveLength(1);

    release();
    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
    expect(posts).toBe(1);
  });

  it('maps a 404 from decide to the not-in-phase callback', async () => {
    serveAssignment(assignment());
    server.use(http.post(DECIDE_URL, () => fail(404, 'NOT_FOUND')));
    const user = userEvent.setup();
    const {onNotInPhase, onDecided} = renderPanel();
    await user.click(await screen.findByRole('button', {name: /Include/}));
    await waitFor(() => expect(onNotInPhase).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
    expect(onDecided).not.toHaveBeenCalled();
  });

  it('toasts the mapped 409, keeps the panel and refetches', async () => {
    serveAssignment(assignment());
    server.use(http.post(DECIDE_URL, () => fail(409, 'SCREENING_REVIEWER_CAP')));
    const user = userEvent.setup();
    const {client, onNotInPhase} = renderPanel();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await user.click(await screen.findByRole('button', {name: /Include/}));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This record already has all its reviewers.'));
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({queryKey: screeningKeys.project('p1')});
      expect(invalidate).toHaveBeenCalledWith({queryKey: screeningKeys.assignment('a1')});
    });
    expect(screen.getByRole('heading', {name: 'Deep learning for sepsis'})).toBeInTheDocument();
    expect(onNotInPhase).not.toHaveBeenCalled();
  });

  it('solo: shows the recorded ring and re-decides with "Changed to Exclude"', async () => {
    const decided = assignment({
      status: 'decided',
      my_decision: {id: 'd1', decision: 'include', exclusion_reason: null, rationale: null, created_at: '2026-10-23T00:00:00Z'},
      outcome: {decision: 'include', exclusion_reason: null, kind: 'solo', reasons_differ: false},
    });
    serveAssignment(decided);
    let body: unknown = null;
    server.use(
      http.post(DECIDE_URL, async ({request}) => {
        body = await request.json();
        return ok(decided);
      }),
    );
    const user = userEvent.setup();
    renderPanel({row: row({status: 'included', my_decision: 'include'}), config: config({reviewer_count: 1})});

    const include = await screen.findByRole('button', {name: /Include/});
    expect(include).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', {name: /^Exclude(?! with)/}));

    await waitFor(() => expect(body).toEqual({decision: 'exclude'}));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Changed to Exclude'));
  });

  it('rules on a conflict in the panel, reviewers labelled by letter', async () => {
    serveAssignment(assignment({status: 'conflict', peer_decisions: [PEER_A, PEER_B]}));
    let body: unknown = null;
    server.use(
      http.post(ARBITRATION_URL, async ({request}) => {
        body = await request.json();
        return ok(assignment({status: 'decided'}));
      }),
    );
    const user = userEvent.setup();
    renderPanel({row: row({status: 'conflict'}), config: config({can_arbitrate: true, can_manage: true})});

    await user.click(await screen.findByRole('button', {name: "Use Reviewer A's decision"}));
    expect(screen.queryByText('Ana Lima')).toBeNull();
    await waitFor(() => expect(body).toEqual({ruled_on_decision_ids: ['dA', 'dB'], selected_decision_id: 'dA'}));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Conflict resolved'));
  });

  it.each([
    ['waiting', 'awaiting_others', 'Waiting for others'],
    ['in_review', 'awaiting_others', 'In review'],
    ['included', 'decided', 'Included'],
  ] as const)('%s is read-only and shows reviewer names', async (rowStatus, readStatus, label) => {
    serveAssignment(
      assignment({
        status: readStatus,
        my_decision: {id: 'd1', decision: 'include', exclusion_reason: null, rationale: null, created_at: '2026-10-23T00:00:00Z'},
        outcome:
          readStatus === 'decided'
            ? {decision: 'include', exclusion_reason: null, kind: 'consensus', reasons_differ: false}
            : null,
        peer_decisions: readStatus === 'decided' ? [PEER_A] : [],
      }),
    );
    renderPanel({row: row({status: rowStatus, my_decision: 'include'})});
    expect(await screen.findByRole('heading', {name: 'Deep learning for sepsis'})).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText('Your decision')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /Include/})).toBeNull();
    if (readStatus === 'decided') expect(screen.getByText('Ana Lima')).toBeInTheDocument();
  });

  it('a viewer never sees decision buttons', async () => {
    serveAssignment(assignment());
    renderPanel({config: config({can_review: false, can_manage: false, can_arbitrate: false})});
    await screen.findByRole('heading', {name: 'Deep learning for sepsis'});
    expect(screen.queryByRole('button', {name: /Include/})).toBeNull();
    expect(screen.queryByRole('button', {name: /Exclude/})).toBeNull();
  });

  it('not enrolled: a manager enrolls that id', async () => {
    let body: unknown = null;
    server.use(
      http.post(ENROLL_URL, async ({request}) => {
        body = await request.json();
        return ok({enrolled: 1, already_enrolled: 0});
      }),
    );
    const user = userEvent.setup();
    renderPanel({
      row: row({article_id: 'art9', assignment_id: null, status: 'not_enrolled', pmid: '12345', doi: '10.1/x'}),
      config: config({can_manage: true}),
    });
    expect(screen.getByRole('heading', {name: 'Deep learning for sepsis'})).toBeInTheDocument();
    expect(screen.getByText('Smith J · Lancet · 2021')).toBeInTheDocument();
    expect(screen.getByText(/12345/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Enroll'}));
    await waitFor(() => expect(body).toEqual({article_ids: ['art9']}));
  });

  it('not enrolled: a reviewer sees metadata only', () => {
    renderPanel({row: row({assignment_id: null, status: 'not_enrolled'})});
    expect(screen.getByRole('heading', {name: 'Deep learning for sepsis'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Enroll'})).toBeNull();
    expect(screen.getByText('A manager enrolls articles')).toBeInTheDocument();
  });
});

describe('ScreeningRecordPanel at full text', () => {
  const FT_ROW = {ta_outcome: 'include', ta_outcome_kind: 'consensus', ta_reviewer_count: 2} as const;
  const NOT_RETRIEVED_DECIDED = {
    status: 'decided',
    outcome: {decision: 'not_retrieved', exclusion_reason: null, kind: 'consensus', reasons_differ: false},
    peer_decisions: [
      {...PEER_A, decision: 'not_retrieved'},
      {...PEER_B, decision: 'not_retrieved', exclusion_reason: null},
    ],
  } as const satisfies Partial<ScreeningAssignmentRead>;

  beforeEach(() => {
    server.use(http.get(FILES_URL, () => ok([])));
  });

  it('not retrieved: an unseated arbitrator gets the ruling form', async () => {
    serveAssignment(assignment(NOT_RETRIEVED_DECIDED));
    let body: unknown = null;
    server.use(
      http.post(ARBITRATION_URL, async ({request}) => {
        body = await request.json();
        return ok(assignment({status: 'decided'}));
      }),
    );
    const user = userEvent.setup();
    renderPanel({
      row: row({...FT_ROW, status: 'not_retrieved', outcome: 'not_retrieved', outcome_kind: 'consensus'}),
      config: config({can_arbitrate: true, can_review: true, full_text_reviewer_count: 2}),
      phase: 'full_text',
    });

    expect(await screen.findByText('PDF found later? Rule on this report.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Decide differently'}));
    // At full text the override offers no Maybe and a single note field.
    expect(screen.queryByRole('button', {name: /Maybe/})).toBeNull();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    await user.click(screen.getByRole('button', {name: /Include/}));
    await waitFor(() => expect(body).toEqual({ruled_on_decision_ids: ['dA', 'dB'], decision: 'include'}));
  });

  it('not retrieved: a reviewer sees it read-only', async () => {
    serveAssignment(
      assignment({
        ...NOT_RETRIEVED_DECIDED,
        my_decision: {id: 'dA', decision: 'not_retrieved', exclusion_reason: null, rationale: null, created_at: '2026-10-23T00:00:00Z'},
      }),
    );
    renderPanel({
      row: row({...FT_ROW, status: 'not_retrieved', outcome: 'not_retrieved', my_decision: 'not_retrieved'}),
      config: config({can_arbitrate: true, can_review: true, full_text_reviewer_count: 2}),
      phase: 'full_text',
    });

    expect(await screen.findByText('Your decision')).toBeInTheDocument();
    expect(screen.queryByText('PDF found later? Rule on this report.')).toBeNull();
    expect(screen.queryByRole('button', {name: 'Decide differently'})).toBeNull();
    expect(screen.queryByRole('button', {name: /Include/})).toBeNull();
  });

  it('full text solo re-decide uses the full-text count', async () => {
    serveAssignment(
      assignment({
        status: 'decided',
        my_decision: {id: 'd1', decision: 'include', exclusion_reason: null, rationale: null, created_at: '2026-10-23T00:00:00Z'},
        outcome: {decision: 'include', exclusion_reason: null, kind: 'solo', reasons_differ: false},
      }),
    );
    renderPanel({
      row: row({...FT_ROW, status: 'included', my_decision: 'include'}),
      config: config({reviewer_count: 2, full_text_reviewer_count: 1}),
      phase: 'full_text',
    });

    expect(await screen.findByRole('button', {name: /Include/})).toHaveAttribute('aria-pressed', 'true');
  });

  it('maps SCREENING_REASON_REQUIRED to its toast', async () => {
    serveAssignment(assignment());
    server.use(http.post(DECIDE_URL, () => fail(409, 'SCREENING_REASON_REQUIRED')));
    const user = userEvent.setup();
    renderPanel({row: row(FT_ROW), config: config({full_text_reviewer_count: 2}), phase: 'full_text'});

    await user.click(await screen.findByRole('button', {name: /Include/}));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Pick an exclusion reason.'));
  });
});
