import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/services/llmConnectionsService', () => ({
  fetchMyConnections: vi.fn(),
  fetchProjectConnections: vi.fn(),
  createMyConnection: vi.fn(),
  createProjectConnection: vi.fn(),
}));

import {meKeys, projectKeys} from '@/lib/query-keys';
import {createMyConnection, createProjectConnection, fetchMyConnections, fetchProjectConnections} from '@/services/llmConnectionsService';
import {useCreateMyConnection, useMyConnections} from '@/hooks/user/useLlmConnections';
import {useCreateProjectConnection, useProjectConnections} from '@/hooks/project/useProjectConnections';

function wrapper() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('connection hooks', () => {
  it('keys come from the factories', () => {
    expect(meKeys.connections()).toEqual(['me', 'connections']);
    expect(projectKeys.connections('p1')).toEqual(['projects', 'connections', 'p1']);
  });

  it('a failed read is the query error state', async () => {
    vi.mocked(fetchMyConnections).mockResolvedValue({ok: false, error: new Error('x')});
    const {result} = renderHook(() => useMyConnections(), {wrapper: wrapper()});
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('project connections stay disabled without a project id', () => {
    const {result} = renderHook(() => useProjectConnections(null), {wrapper: wrapper()});
    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchProjectConnections).not.toHaveBeenCalled();
  });

  it('a user-connection mutation invalidates the list and every engine read', async () => {
    vi.mocked(createMyConnection).mockResolvedValue({ok: true, data: {id: 'c1'} as never});
    const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
    client.setQueryData(meKeys.connections(), []);
    client.setQueryData(projectKeys.llmEngine('p1'), {source: 'project'});
    const w = ({children}: {children: ReactNode}) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const {result} = renderHook(() => useCreateMyConnection(), {wrapper: w});
    await act(async () => {
      await result.current.mutateAsync({provider: 'openai', label: 'x', api_key: 'k', base_url: null, allowed_models: []});
    });
    expect(client.getQueryState(meKeys.connections())?.isInvalidated).toBe(true);
    expect(client.getQueryState(projectKeys.llmEngine('p1'))?.isInvalidated).toBe(true);
  });

  it('a shared-key mutation invalidates the project list and the project engine read', async () => {
    vi.mocked(createProjectConnection).mockResolvedValue({ok: true, data: {id: 's1'} as never});
    const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
    client.setQueryData(projectKeys.connections('p1'), []);
    client.setQueryData(projectKeys.llmEngine('p1'), {source: 'project'});
    const w = ({children}: {children: ReactNode}) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const {result} = renderHook(() => useCreateProjectConnection('p1'), {wrapper: w});
    await act(async () => {
      await result.current.mutateAsync({provider: 'openai', label: 'x', api_key: 'k', base_url: null, allowed_models: []});
    });
    expect(client.getQueryState(projectKeys.connections('p1'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(projectKeys.llmEngine('p1'))?.isInvalidated).toBe(true);
  });
});
