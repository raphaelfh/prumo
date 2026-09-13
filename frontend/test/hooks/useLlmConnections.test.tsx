import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/services/llmConnectionsService', () => ({
  fetchMyConnections: vi.fn(),
  fetchProjectConnections: vi.fn(),
}));

import {meKeys, projectKeys} from '@/lib/query-keys';
import {fetchMyConnections, fetchProjectConnections} from '@/services/llmConnectionsService';
import {useMyConnections} from '@/hooks/user/useLlmConnections';
import {useProjectConnections} from '@/hooks/project/useProjectConnections';

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
});
