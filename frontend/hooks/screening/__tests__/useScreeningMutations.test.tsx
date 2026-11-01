/**
 * The two screening writes settle by refetching, never by patching: a
 * decision or a ruling refetches the project's screening family (the records
 * read among it) and the record itself.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import type {ReactNode} from 'react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));

import {useScreeningAssignment} from '@/hooks/screening/useScreeningAssignment';
import {useArbitrate, useDecide} from '@/hooks/screening/useScreeningMutations';
import {useScreeningRecords} from '@/hooks/screening/useScreeningRecords';
import {screeningKeys} from '@/lib/query-keys/screening';
import {server} from '@/test/mocks/server';

const RECORDS_URL = '*/api/v1/projects/:projectId/screening/records';
const ASSIGNMENT_URL = '*/api/v1/screening/assignments/:assignmentId';
const DECIDE_URL = '*/api/v1/screening/assignments/:assignmentId/decisions';
const ARBITRATE_URL = '*/api/v1/screening/assignments/:assignmentId/arbitration';

const ok = (data: unknown) => HttpResponse.json({ok: true, data});

function serveReads() {
  const calls = {records: 0, assignment: 0};
  server.use(
    http.get(RECORDS_URL, () => {
      calls.records += 1;
      return ok({exclusion_reasons: [], inclusion_criteria: [], phase: 'title_abstract', reviewer_count: 2, rows: []});
    }),
    http.get(ASSIGNMENT_URL, () => {
      calls.assignment += 1;
      return ok({stub: true});
    }),
  );
  return calls;
}

function setup() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () => ({
      records: useScreeningRecords('p1', 'title_abstract', true),
      assignment: useScreeningAssignment('a1'),
      decide: useDecide('p1'),
      arbitrate: useArbitrate('p1'),
    }),
    {wrapper},
  );
}

describe('useDecide / useArbitrate', () => {
  it('refetches the screening family and the record after a decision', async () => {
    const calls = serveReads();
    server.use(http.post(DECIDE_URL, () => ok({})));
    const hook = setup();
    await waitFor(() => expect(hook.result.current.records.isSuccess && hook.result.current.assignment.isSuccess).toBe(true));
    expect(calls).toEqual({records: 1, assignment: 1});

    act(() => hook.result.current.decide.mutate({assignmentId: 'a1', body: {decision: 'include'}}));

    await waitFor(() => expect(hook.result.current.decide.isSuccess).toBe(true));
    await waitFor(() => expect(calls).toEqual({records: 2, assignment: 2}));
  });

  it('refetches the screening family and the record after a ruling', async () => {
    const calls = serveReads();
    server.use(http.post(ARBITRATE_URL, () => ok({})));
    const hook = setup();
    await waitFor(() => expect(hook.result.current.records.isSuccess && hook.result.current.assignment.isSuccess).toBe(true));

    act(() =>
      hook.result.current.arbitrate.mutate({
        assignmentId: 'a1',
        body: {decision: 'include', ruled_on_decision_ids: []},
      }),
    );

    await waitFor(() => expect(hook.result.current.arbitrate.isSuccess).toBe(true));
    await waitFor(() => expect(calls).toEqual({records: 2, assignment: 2}));
  });

  it('lives under the family a PubMed import refreshes', () => {
    const family = screeningKeys.project('p1');
    expect(screeningKeys.records('p1', 'title_abstract').slice(0, family.length)).toEqual([...family]);
    expect(screeningKeys.assignment('a1')).toEqual(['screening', 'assignment', 'a1']);
  });
});
