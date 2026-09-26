import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/services/personalAccessTokenService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/personalAccessTokenService')>()),
  fetchMyTokens: vi.fn(),
  createMyToken: vi.fn(),
  revokeMyToken: vi.fn(),
}));

import {meKeys} from '@/lib/query-keys';
import {createMyToken, fetchMyTokens, revokeMyToken} from '@/services/personalAccessTokenService';
import {useCreateMyToken, useMyTokens, useRevokeMyToken} from '@/hooks/user/usePersonalAccessTokens';

function makeClient() {
  return new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
}

function wrapperFor(client: QueryClient) {
  return ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('usePersonalAccessTokens', () => {
  it('useMyTokens reads under meKeys.tokens()', async () => {
    const rows = [{id: 't1'}];
    vi.mocked(fetchMyTokens).mockResolvedValue({ok: true, data: rows as never});
    const client = makeClient();
    const {result} = renderHook(() => useMyTokens(), {wrapper: wrapperFor(client)});

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryData(meKeys.tokens())).toEqual(rows);
  });

  it('useCreateMyToken invalidates meKeys.tokens() on success', async () => {
    vi.mocked(createMyToken).mockResolvedValue({ok: true, data: {secret: 's', token: {id: 't1'}} as never});
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const {result} = renderHook(() => useCreateMyToken(), {wrapper: wrapperFor(client)});

    await act(async () => {
      await result.current.mutateAsync({name: 'cli', scope: 'read', expires_in_days: 90});
    });

    expect(invalidateSpy).toHaveBeenCalledWith({queryKey: meKeys.tokens()});
  });

  it('useRevokeMyToken invalidates meKeys.tokens() on success', async () => {
    vi.mocked(revokeMyToken).mockResolvedValue({ok: true, data: undefined});
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const {result} = renderHook(() => useRevokeMyToken(), {wrapper: wrapperFor(client)});

    await act(async () => {
      await result.current.mutateAsync('t1');
    });

    expect(invalidateSpy).toHaveBeenCalledWith({queryKey: meKeys.tokens()});
  });

  it('a service {ok: false, error} rejects the create mutation with that error', async () => {
    const error = new Error('limit');
    vi.mocked(createMyToken).mockResolvedValue({ok: false, error});
    const client = makeClient();
    const {result} = renderHook(() => useCreateMyToken(), {wrapper: wrapperFor(client)});

    await expect(
      act(async () => {
        await result.current.mutateAsync({name: 'cli', scope: 'read', expires_in_days: 90});
      }),
    ).rejects.toBe(error);
  });
});
