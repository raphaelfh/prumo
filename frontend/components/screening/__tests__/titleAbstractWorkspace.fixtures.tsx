/** Shared fixtures for the TitleAbstractWorkspace suites (list + keyboard). */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import {MemoryRouter, useLocation} from 'react-router';

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

export const RECORDS_URL = '*/api/v1/projects/:projectId/screening/records';
const ASSIGNMENT_URL = '*/api/v1/screening/assignments/:assignmentId';
export const DECIDE_URL = '*/api/v1/screening/assignments/:assignmentId/decisions';
export const ARBITRATE_URL = '*/api/v1/screening/assignments/:assignmentId/arbitration';
export const ENROLL_URL = '*/api/v1/projects/:projectId/screening/enroll';

export const ok = (data: unknown) => HttpResponse.json({ok: true, data});
export const fail = (status: number, code: string) =>
  HttpResponse.json({ok: false, error: {code, message: code}}, {status});

export function row(overrides: Partial<ScreeningRecordRow> = {}): ScreeningRecordRow {
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
    title: 'Alpha trial',
    ...overrides,
  };
}

export const ALPHA = row();
export const BETA = row({article_id: 'art2', assignment_id: 'a2', queue_rank: 2, title: 'Beta cohort'});
export const GAMMA = row({
  article_id: 'art3',
  assignment_id: 'a3',
  queue_rank: 3,
  title: 'Gamma review',
  status: 'included',
  my_decision: 'include',
  outcome: 'include',
});
export const notEnrolled = (r: ScreeningRecordRow): ScreeningRecordRow => ({
  ...r,
  assignment_id: null,
  status: 'not_enrolled',
  my_decision: null,
  outcome: null,
});

export const REVIEWER = {can_manage: false, can_review: true, can_arbitrate: false};
export const MANAGER = {can_manage: true, can_review: true, can_arbitrate: true};
export const CONSENSUS = {can_manage: false, can_review: true, can_arbitrate: true};
export const VIEWER = {can_manage: false, can_review: false, can_arbitrate: false};

export function config(overrides: Partial<ScreeningConfigRead> = {}): ScreeningConfigRead {
  return {
    ...REVIEWER,
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

export function records(rows: ScreeningRecordRow[]): ScreeningRecordsRead {
  return {exclusion_reasons: [], inclusion_criteria: [], phase: 'title_abstract', reviewer_count: 2, rows};
}

/** A mutable records read: assign `current.rows` before a refetch. */
export function serveRecords(initial: ScreeningRecordRow[]) {
  const current = {rows: initial};
  server.use(http.get(RECORDS_URL, () => ok(records(current.rows))));
  return current;
}

export function assignmentFor(r: ScreeningRecordRow): ScreeningAssignmentRead {
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

export function serveAssignments(rows: ScreeningRecordRow[], read: (r: ScreeningRecordRow) => ScreeningAssignmentRead = assignmentFor) {
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

export const search = () => new URLSearchParams(screen.getByTestId('location').textContent ?? '');

export function renderWorkspace({
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

export const liveRegion = () => screen.getByTestId('next-record-announcement');
export const titleButton = (title: string) => screen.queryByRole('button', {name: title});
export const panel = () => document.querySelector('[data-testid="screening-shell-panel"]');
