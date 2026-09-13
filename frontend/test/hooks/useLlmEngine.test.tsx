import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/services/llmEngineService', () => ({
  fetchLlmEngine: vi.fn(),
  setMyEngine: vi.fn(),
}));

import {projectKeys} from '@/lib/query-keys';
import {fetchLlmEngine, setMyEngine} from '@/services/llmEngineService';
import {useLlmEngine, useSetMyEngine} from '@/hooks/extraction/useLlmEngine';

function harness() {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {wrapper, queryClient};
}

describe('useLlmEngine / useSetMyEngine', () => {
  it('a failed read is the query error state', async () => {
    vi.mocked(fetchLlmEngine).mockResolvedValue({ok: false, error: new Error('x')});
    const {wrapper} = harness();
    const {result} = renderHook(() => useLlmEngine('p1'), {wrapper});
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('a successful write lands on the read key synchronously', async () => {
    const read = {source: 'user'} as never;
    vi.mocked(setMyEngine).mockResolvedValue({ok: true, data: read});
    const {wrapper, queryClient} = harness();
    const {result} = renderHook(() => useSetMyEngine('p1'), {wrapper});
    await act(async () => {
      await result.current.mutateAsync({provider: 'openai', model: 'm', mode: 'fast', connection_id: null});
    });
    expect(queryClient.getQueryData(projectKeys.llmEngine('p1'))).toBe(read);
  });
});
