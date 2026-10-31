/**
 * Enrolling settles by refetching the screening family, on success and on a
 * refusal alike: a 409 means the server's counts moved under the caller (a
 * concurrent enroll, a config change), so the cached ones are stale too.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import type {ReactNode} from 'react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));

import {useEnrollArticles, useScreeningConfig} from '@/hooks/screening/useScreeningConfig';
import {server} from '@/test/mocks/server';

const CONFIG_URL = '*/api/v1/projects/:projectId/screening/config';
const ENROLL_URL = '*/api/v1/projects/:projectId/screening/enroll';

function setup() {
  const calls = {config: 0};
  server.use(
    http.get(CONFIG_URL, () => {
      calls.config += 1;
      return HttpResponse.json({ok: true, data: {stub: true}});
    }),
  );
  const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => ({config: useScreeningConfig('p1'), enroll: useEnrollArticles('p1')}), {wrapper});
  return {hook, calls};
}

describe('useEnrollArticles', () => {
  it('refetches the screening family after an enroll', async () => {
    server.use(http.post(ENROLL_URL, () => HttpResponse.json({ok: true, data: {enrolled: 1, already_enrolled: 0}})));
    const {hook, calls} = setup();
    await waitFor(() => expect(hook.result.current.config.isSuccess).toBe(true));
    expect(calls.config).toBe(1);

    act(() => hook.result.current.enroll.mutate({article_ids: ['art1']}));

    await waitFor(() => expect(hook.result.current.enroll.isSuccess).toBe(true));
    await waitFor(() => expect(calls.config).toBe(2));
  });

  it('refetches the screening family after a refused enroll', async () => {
    server.use(
      http.post(ENROLL_URL, () =>
        HttpResponse.json(
          {ok: false, error: {code: 'SCREENING_NOT_CONFIGURED', message: 'not configured'}},
          {status: 409},
        ),
      ),
    );
    const {hook, calls} = setup();
    await waitFor(() => expect(hook.result.current.config.isSuccess).toBe(true));
    expect(calls.config).toBe(1);

    act(() => hook.result.current.enroll.mutate({article_ids: ['art1']}));

    await waitFor(() => expect(hook.result.current.enroll.isError).toBe(true));
    await waitFor(() => expect(calls.config).toBe(2));
  });
});
