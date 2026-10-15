import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/oauthConnectionsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/oauthConnectionsService')>()),
  fetchMyConnections: vi.fn(),
  revokeMyConnection: vi.fn(),
}));

import {meKeys} from '@/lib/query-keys';
import {fetchMyConnections, revokeMyConnection} from '@/services/oauthConnectionsService';
import {useMyOAuthConnections, useRevokeOAuthConnection} from '@/hooks/user/useOAuthConnections';

function makeClient() {
  return new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
}

function wrapperFor(client: QueryClient) {
  return ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('meKeys.oauthConnections', () => {
  it("is ['me', 'oauth-connections'], distinct from the LLM connections key", () => {
    expect(meKeys.oauthConnections()).toEqual(['me', 'oauth-connections']);
    expect(meKeys.oauthConnections()).not.toEqual(meKeys.connections());
  });
});

describe('useMyOAuthConnections', () => {
  it('reads under meKeys.oauthConnections()', async () => {
    const rows = [{id: 'c1'}];
    vi.mocked(fetchMyConnections).mockResolvedValue({ok: true, data: rows as never});
    const client = makeClient();
    const {result} = renderHook(() => useMyOAuthConnections(), {wrapper: wrapperFor(client)});

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryData(meKeys.oauthConnections())).toEqual(rows);
  });

  it('surfaces a service error as the query error', async () => {
    const error = new Error('down');
    vi.mocked(fetchMyConnections).mockResolvedValue({ok: false, error});
    const client = makeClient();
    const {result} = renderHook(() => useMyOAuthConnections(), {wrapper: wrapperFor(client)});

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBe(error);
  });
});

describe('useRevokeOAuthConnection', () => {
  it('invalidates exactly meKeys.oauthConnections() on success', async () => {
    vi.mocked(revokeMyConnection).mockResolvedValue({ok: true, data: undefined});
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const {result} = renderHook(() => useRevokeOAuthConnection(), {wrapper: wrapperFor(client)});

    await act(async () => {
      await result.current.mutateAsync('c1');
    });

    expect(revokeMyConnection).toHaveBeenCalledWith('c1');
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({queryKey: meKeys.oauthConnections()});
  });

  it('a cached list is refetched after a revoke', async () => {
    vi.mocked(fetchMyConnections)
      .mockResolvedValueOnce({ok: true, data: [{id: 'c1', status: 'active'}] as never})
      .mockResolvedValue({ok: true, data: [{id: 'c1', status: 'revoked'}] as never});
    vi.mocked(revokeMyConnection).mockResolvedValue({ok: true, data: undefined});
    const client = makeClient();
    const {result} = renderHook(
      () => ({list: useMyOAuthConnections(), revoke: useRevokeOAuthConnection()}),
      {wrapper: wrapperFor(client)},
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    await act(async () => {
      await result.current.revoke.mutateAsync('c1');
    });

    await waitFor(() => expect(result.current.list.data).toEqual([{id: 'c1', status: 'revoked'}]));
    expect(fetchMyConnections).toHaveBeenCalledTimes(2);
  });

  it('a service {ok: false, error} rejects with that error and does not invalidate', async () => {
    const error = new Error('gone');
    vi.mocked(revokeMyConnection).mockResolvedValue({ok: false, error});
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const {result} = renderHook(() => useRevokeOAuthConnection(), {wrapper: wrapperFor(client)});

    await expect(
      act(async () => {
        await result.current.mutateAsync('c1');
      }),
    ).rejects.toBe(error);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
