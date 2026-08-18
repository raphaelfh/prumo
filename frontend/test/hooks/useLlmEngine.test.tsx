/**
 * useLlmEngine / useSetLlmEngine — TanStack hooks for the project engine
 * (C1b T5).
 *
 * The service module is mocked, so each test asserts the hook's contract:
 * the key comes from `projectKeys.llmEngine`, a failed read surfaces as
 * the query's error state (the chip's render-nothing branch), and a
 * successful mutation invalidates the owning key family.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/llmEngineService', () => ({
  fetchLlmEngine: vi.fn(),
  setLlmEngine: vi.fn(),
}));

import {projectKeys} from '@/lib/query-keys';
import {fetchLlmEngine, setLlmEngine} from '@/services/llmEngineService';
import {useLlmEngine, useSetLlmEngine} from '@/hooks/extraction/useLlmEngine';

import {makeEngineRead} from '../mocks/llmEngineRead';

const fetchMock = vi.mocked(fetchLlmEngine);
const setMock = vi.mocked(setLlmEngine);

const ENGINE_READ = makeEngineRead();

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {retry: false},
      mutations: {retry: false},
    },
  });
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {wrapper, queryClient};
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('projectKeys.llmEngine', () => {
  it('is part of the projects key family', () => {
    expect(projectKeys.llmEngine('p1')).toEqual([
      'projects',
      'llm-engine',
      'p1',
    ]);
  });
});

describe('useLlmEngine', () => {
  it('reads through the service and exposes the resolved engine', async () => {
    fetchMock.mockResolvedValue({ok: true, data: ENGINE_READ});
    const {wrapper} = createWrapper();

    const {result} = renderHook(() => useLlmEngine('p1'), {wrapper});

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('p1');
    expect(result.current.data?.provider).toBe('openai');
  });

  it('stays disabled when projectId is falsy', () => {
    const {wrapper} = createWrapper();

    const {result} = renderHook(() => useLlmEngine(undefined), {wrapper});

    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces an ErrorResult as the query error state', async () => {
    fetchMock.mockResolvedValue({ok: false, error: new Error('Not Found')});
    const {wrapper} = createWrapper();

    const {result} = renderHook(() => useLlmEngine('p1'), {wrapper});

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Not Found');
  });
});

describe('useSetLlmEngine', () => {
  it('PUTs through the service and invalidates the key family', async () => {
    setMock.mockResolvedValue({ok: true, data: ENGINE_READ});
    const {wrapper, queryClient} = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const {result} = renderHook(() => useSetLlmEngine('p1'), {wrapper});
    await result.current.mutateAsync({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      mode: 'fast',
      alternates: [{provider: 'openai', model: 'gpt-4o-mini'}],
    });

    // The body passes through VERBATIM — the hook never adds or strips
    // the alternates key (that responsibility lives in toUpdateBody).
    expect(setMock).toHaveBeenCalledWith('p1', {
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      mode: 'fast',
      alternates: [{provider: 'openai', model: 'gpt-4o-mini'}],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: projectKeys.llmEngine('p1'),
    });
  });

  it('writes the returned read into the cache before invalidating (lost-update race)', async () => {
    // The mutation's response IS the fresh normalized read: it must land
    // on the READ hook's key synchronously in onSuccess, so a back-to-back
    // mutation never computes from the pre-PUT list while the refetch is
    // still in flight.
    const R2 = {
      ...ENGINE_READ,
      model: 'gpt-4o',
      mode: 'verified' as const,
      alternates: [
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
          canonical: 'openai:gpt-4o-mini',
          retired: false,
        },
      ],
    };
    setMock.mockResolvedValue({ok: true, data: R2});
    const {wrapper, queryClient} = createWrapper();
    const setDataSpy = vi.spyOn(queryClient, 'setQueryData');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const {result} = renderHook(() => useSetLlmEngine('p1'), {wrapper});
    await result.current.mutateAsync({
      provider: 'openai',
      model: 'gpt-4o',
      mode: 'verified',
    });

    // No refetch ran (fetchLlmEngine never resolves here): the cache holds
    // R2 purely from the setQueryData write.
    expect(queryClient.getQueryData(projectKeys.llmEngine('p1'))).toEqual(R2);
    // And the write happened BEFORE the (kept) invalidation.
    expect(setDataSpy).toHaveBeenCalledWith(projectKeys.llmEngine('p1'), R2);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: projectKeys.llmEngine('p1'),
    });
    expect(setDataSpy.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateSpy.mock.invocationCallOrder[0],
    );
  });

  it('rejects (mutation error state) when the service refuses', async () => {
    setMock.mockResolvedValue({ok: false, error: new Error('unknown model')});
    const {wrapper} = createWrapper();

    const {result} = renderHook(() => useSetLlmEngine('p1'), {wrapper});

    await expect(
      result.current.mutateAsync({
        provider: 'openai',
        model: 'nope',
        mode: 'fast',
      }),
    ).rejects.toThrow('unknown model');
  });
});
