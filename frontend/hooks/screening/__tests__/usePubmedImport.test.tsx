import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import type {ReactNode} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));

import {useImportRun} from '@/hooks/screening/usePubmedImport';
import {screeningKeys} from '@/lib/query-keys/screening';
import {server} from '@/test/mocks/server';

const RUN_URL = '*/api/v1/projects/:projectId/imports/:syncRunId';

function runBody(status: string) {
  return {
    ok: true,
    data: {
      completed_at: null,
      failed: 0,
      persisted: 1,
      skipped: 0,
      source: 'pubmed',
      started_at: '2026-10-23T00:00:00Z',
      status,
      sync_run_id: 's1',
      total_received: 1,
      updated: 0,
    },
  };
}

/** Serves each status in turn; the last repeats. */
function serveRuns(statuses: string[]) {
  let reads = 0;
  server.use(
    http.get(RUN_URL, () => {
      const status = statuses[Math.min(reads, statuses.length - 1)];
      reads += 1;
      return HttpResponse.json(runBody(status));
    }),
  );
}

function setup() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}}});
  client.setQueryData(screeningKeys.config('p1'), {stub: 'config'});
  client.setQueryData([...screeningKeys.project('p1'), 'probe'], {stub: 'probe'});
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {client, invalidate, wrapper};
}

describe('useImportRun', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes the whole screening family once when the run completes', async () => {
    serveRuns(['running', 'completed']);
    const {client, invalidate, wrapper} = setup();
    const {result} = renderHook(() => useImportRun('p1', 's1'), {wrapper});

    await waitFor(() => expect(result.current.data?.status).toBe('running'));
    expect(invalidate).not.toHaveBeenCalled();

    await waitFor(() => expect(result.current.data?.status).toBe('completed'), {timeout: 4000});
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    expect(invalidate).toHaveBeenCalledWith({queryKey: screeningKeys.project('p1')});
    expect(client.getQueryState(screeningKeys.config('p1'))?.isInvalidated).toBe(true);
    expect(client.getQueryState([...screeningKeys.project('p1'), 'probe'])?.isInvalidated).toBe(true);
  }, 10_000);

  it('refreshes the screening family when the run fails', async () => {
    serveRuns(['failed']);
    const {client, wrapper} = setup();
    renderHook(() => useImportRun('p1', 's1'), {wrapper});
    await waitFor(() => expect(client.getQueryState(screeningKeys.config('p1'))?.isInvalidated).toBe(true));
  });

  it('stops polling a run that errors after it was running', async () => {
    vi.useFakeTimers({shouldAdvanceTime: true});
    let reads = 0;
    server.use(
      http.get(RUN_URL, () => {
        reads += 1;
        if (reads === 1) return HttpResponse.json(runBody('running'));
        return HttpResponse.json({ok: false, error: {code: 'NOT_FOUND', message: 'gone'}}, {status: 404});
      }),
    );
    const {wrapper} = setup();
    renderHook(() => useImportRun('p1', 's1'), {wrapper});

    await vi.waitFor(() => expect(reads).toBe(1));
    // First poll: the run is gone (404). The query keeps its last `running` data.
    await vi.advanceTimersByTimeAsync(2000);
    expect(reads).toBe(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(reads).toBe(2);
  });

  it('does not fetch without a run id', async () => {
    const reads = vi.fn();
    server.use(
      http.get(RUN_URL, () => {
        reads();
        return HttpResponse.json(runBody('running'));
      }),
    );
    const {wrapper} = setup();
    const {result} = renderHook(() => useImportRun('p1', null), {wrapper});
    expect(result.current.fetchStatus).toBe('idle');
    expect(reads).not.toHaveBeenCalled();
  });
});
