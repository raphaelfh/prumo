import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import type {ReactNode} from 'react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));

import {useScreeningRecords} from '@/hooks/screening/useScreeningRecords';
import type {ScreeningRecordRow, ScreeningRecordsRead} from '@/services/screeningService';
import {server} from '@/test/mocks/server';

const RECORDS_URL = '*/api/v1/projects/:projectId/screening/records';

const ROW: ScreeningRecordRow = {
  article_id: 'art-1',
  assignment_id: 'as-1',
  doi: null,
  first_author: 'Smith',
  has_pdf: false,
  ingestion_source: null,
  journal_title: null,
  my_decision: null,
  my_exclusion_reason: null,
  outcome: null,
  outcome_exclusion_reason: null,
  outcome_kind: null,
  pmid: null,
  publication_year: 2020,
  queue_rank: 1,
  status: 'to_screen',
  title: 'A record',
};

const RECORDS: ScreeningRecordsRead = {
  phase: 'title_abstract',
  rows: [ROW],
  exclusion_reasons: [],
  inclusion_criteria: [],
  reviewer_count: 1,
};

function wrapper() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  return ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useScreeningRecords', () => {
  it('reads the phase records of the project', async () => {
    const seen: {projectId?: string; phase?: string | null} = {};
    server.use(
      http.get(RECORDS_URL, ({params, request}) => {
        seen.projectId = params.projectId as string;
        seen.phase = new URL(request.url).searchParams.get('phase');
        return HttpResponse.json({ok: true, data: RECORDS});
      }),
    );

    const hook = renderHook(() => useScreeningRecords('p1', 'title_abstract', true), {wrapper: wrapper()});

    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(hook.result.current.data?.rows).toEqual([ROW]);
    expect(seen).toEqual({projectId: 'p1', phase: 'title_abstract'});
  });

  it('sends nothing while disabled', async () => {
    let calls = 0;
    server.use(
      http.get(RECORDS_URL, () => {
        calls += 1;
        return HttpResponse.json({ok: true, data: RECORDS});
      }),
    );

    const hook = renderHook(() => useScreeningRecords('p1', 'title_abstract', false), {wrapper: wrapper()});

    // An enabled query is already `fetching` once mount effects flush; a
    // disabled one stays idle and never reaches the handler.
    await act(async () => {});
    expect(hook.result.current.fetchStatus).toBe('idle');
    expect(hook.result.current.isPending).toBe(true);
    expect(calls).toBe(0);
  });

  it('surfaces a 409 envelope as an error carrying its code', async () => {
    server.use(
      http.get(RECORDS_URL, () =>
        HttpResponse.json(
          {ok: false, error: {code: 'SCREENING_NOT_CONFIGURED', message: 'not configured'}},
          {status: 409},
        ),
      ),
    );

    const hook = renderHook(() => useScreeningRecords('p1', 'title_abstract', true), {wrapper: wrapper()});

    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect((hook.result.current.error as {code?: string}).code).toBe('SCREENING_NOT_CONFIGURED');
  });
});
