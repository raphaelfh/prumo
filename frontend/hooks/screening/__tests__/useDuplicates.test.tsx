/**
 * The duplicates read is enabled on demand, and a verdict write refetches the
 * whole screening family (records, counts and the pair list all move).
 */
import {act, renderHook, waitFor} from '@testing-library/react';
import {http, HttpResponse} from 'msw';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {auth: {getSession: async () => ({data: {session: {access_token: 'test-token'}}})}},
}));

import {useDuplicates, useDuplicateVerdicts} from '@/hooks/screening/useDuplicates';
import {screeningKeys} from '@/lib/query-keys/screening';
import {createQueryWrapper} from '@/test/helpers/queryClientWrapper';
import {server} from '@/test/mocks/server';

const DUPLICATES_URL = '*/api/v1/projects/:projectId/duplicates';
const VERDICTS_URL = '*/api/v1/projects/:projectId/duplicates/verdicts';

describe('useDuplicates', () => {
  it('returns the read', async () => {
    server.use(http.get(DUPLICATES_URL, () => HttpResponse.json({ok: true, data: {open: [], resolved: []}})));
    const {wrapper} = createQueryWrapper();
    const {result} = renderHook(() => useDuplicates('p1', true), {wrapper});
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({open: [], resolved: []});
  });

  it('sends nothing while disabled', async () => {
    let calls = 0;
    server.use(
      http.get(DUPLICATES_URL, () => {
        calls += 1;
        return HttpResponse.json({ok: true, data: {open: [], resolved: []}});
      }),
    );
    const {wrapper} = createQueryWrapper();
    const {result} = renderHook(() => useDuplicates('p1', false), {wrapper});
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(result.current.fetchStatus).toBe('idle');
    expect(calls).toBe(0);
  });
});

describe('useDuplicateVerdicts', () => {
  it('posts {items} and invalidates the screening family of the project', async () => {
    let body: unknown;
    server.use(
      http.post(VERDICTS_URL, async ({request}) => {
        body = await request.json();
        return HttpResponse.json({ok: true, data: {written: 1, enrolled_kept: 0}});
      }),
    );
    const {wrapper, queryClient} = createQueryWrapper();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const {result} = renderHook(() => useDuplicateVerdicts('p1'), {wrapper});
    const items = [{article_id: 'a', kept_article_id: 'b', verdict: 'duplicate' as const}];

    act(() => result.current.mutate(items));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({items});
    await waitFor(() => expect(spy).toHaveBeenCalledWith({queryKey: screeningKeys.project('p1')}));
  });
});
