import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import type {ReactNode} from 'react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));

import {useDecide, useScreeningQueue} from '@/hooks/screening/useScreeningQueue';
import {screeningKeys} from '@/lib/query-keys/screening';
import type {ScreeningQueueRead} from '@/services/screeningService';
import {server} from '@/test/mocks/server';

const QUEUE_URL = '*/api/v1/projects/:projectId/screening/queue';
const DECIDE_URL = '*/api/v1/screening/assignments/:assignmentId/decisions';

function item(id: string) {
  return {
    assignment_id: id,
    article: {
      id: `art-${id}`,
      title: `Title ${id}`,
      abstract: null,
      authors: null,
      doi: null,
      journal_title: null,
      pmid: null,
      publication_year: null,
    },
  };
}

const QUEUE: ScreeningQueueRead = {
  items: [item('a1'), item('a2')],
  awaiting_me: 2,
  awaiting_others: 0,
  exclusion_reasons: [],
};

function serveQueue(read: ScreeningQueueRead = QUEUE) {
  const calls = {count: 0};
  server.use(
    http.get(QUEUE_URL, () => {
      calls.count += 1;
      return HttpResponse.json({ok: true, data: read});
    }),
  );
  return calls;
}

function setup() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => ({queue: useScreeningQueue('p1', true), decide: useDecide('p1')}), {wrapper});
  return {client, hook};
}

describe('useScreeningQueue / useDecide', () => {
  it('advances optimistically', async () => {
    serveQueue();
    server.use(http.post(DECIDE_URL, () => new Promise<never>(() => {})));
    const {client, hook} = setup();
    await waitFor(() => expect(hook.result.current.queue.isSuccess).toBe(true));

    act(() => hook.result.current.decide.mutate({assignmentId: 'a1', body: {decision: 'include'}}));

    await waitFor(() => {
      const cached = client.getQueryData<ScreeningQueueRead>(screeningKeys.queue('p1'));
      expect(cached?.items.map((i) => i.assignment_id)).toEqual(['a2']);
      expect(cached?.awaiting_me).toBe(1);
    });
  });

  it('rolls back when the decision fails', async () => {
    serveQueue();
    // The refetch after the failure must not be what restores the queue.
    server.use(
      http.post(DECIDE_URL, () =>
        HttpResponse.json(
          {ok: false, error: {code: 'SCREENING_REVIEWER_CAP', message: 'cap'}},
          {status: 409},
        ),
      ),
    );
    const {client, hook} = setup();
    await waitFor(() => expect(hook.result.current.queue.isSuccess).toBe(true));
    server.use(http.get(QUEUE_URL, () => new Promise<never>(() => {})));

    act(() => hook.result.current.decide.mutate({assignmentId: 'a1', body: {decision: 'include'}}));

    await waitFor(() => expect(hook.result.current.decide.isError).toBe(true));
    expect(client.getQueryData<ScreeningQueueRead>(screeningKeys.queue('p1'))).toEqual(QUEUE);
  });

  it('refetches the screening family after a decision', async () => {
    const calls = serveQueue();
    let posted = false;
    server.use(
      http.post(DECIDE_URL, () => {
        posted = true;
        return HttpResponse.json({ok: true, data: {}});
      }),
    );
    const {hook} = setup();
    await waitFor(() => expect(hook.result.current.queue.isSuccess).toBe(true));
    expect(calls.count).toBe(1);

    act(() => hook.result.current.decide.mutate({assignmentId: 'a1', body: {decision: 'include'}}));

    await waitFor(() => expect(hook.result.current.decide.isSuccess).toBe(true));
    expect(posted).toBe(true);
    await waitFor(() => expect(calls.count).toBe(2));
  });

  it('lives under the family a PubMed import refreshes', () => {
    const family = screeningKeys.project('p1');
    expect(screeningKeys.queue('p1').slice(0, family.length)).toEqual([...family]);
    expect(screeningKeys.assignment('a1')).toEqual(['screening', 'assignment', 'a1']);
  });
});
