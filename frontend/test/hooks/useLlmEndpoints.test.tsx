/**
 * useLlmEndpoints + the four endpoint mutations (C2 C1).
 *
 * The service module is mocked, so each test asserts the hook's contract:
 * the key comes from `projectKeys.llmEndpoints`, a failed read surfaces as
 * the query's error state (the picker's no-groups branch), and EVERY
 * endpoint mutation invalidates BOTH key families — the engine read
 * derives `endpoint_label` (and its retired/unrunnable state) from the
 * endpoint rows, so a stale engine cache would keep rendering a label for
 * an endpoint that just changed or vanished.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/services/llmEndpointService', () => ({
  fetchLlmEndpoints: vi.fn(),
  createLlmEndpoint: vi.fn(),
  updateLlmEndpoint: vi.fn(),
  deleteLlmEndpoint: vi.fn(),
  verifyLlmEndpoint: vi.fn(),
}));

import {projectKeys} from '@/lib/query-keys';
import {
  createLlmEndpoint,
  deleteLlmEndpoint,
  fetchLlmEndpoints,
  updateLlmEndpoint,
  verifyLlmEndpoint,
} from '@/services/llmEndpointService';
import {
  useCreateLlmEndpoint,
  useDeleteLlmEndpoint,
  useLlmEndpoints,
  useUpdateLlmEndpoint,
  useVerifyLlmEndpoint,
} from '@/hooks/extraction/useLlmEndpoints';

import {makeEndpointRead} from '../mocks/llmEndpointRead';

const fetchMock = vi.mocked(fetchLlmEndpoints);
const createMock = vi.mocked(createLlmEndpoint);
const updateMock = vi.mocked(updateLlmEndpoint);
const deleteMock = vi.mocked(deleteLlmEndpoint);
const verifyMock = vi.mocked(verifyLlmEndpoint);

const ENDPOINT = makeEndpointRead();

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

/** Both families must be invalidated by every endpoint mutation. */
function expectBothFamiliesInvalidated(
  spy: ReturnType<typeof vi.spyOn>,
): void {
  expect(spy).toHaveBeenCalledWith({
    queryKey: projectKeys.llmEndpoints('p1'),
  });
  expect(spy).toHaveBeenCalledWith({queryKey: projectKeys.llmEngine('p1')});
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('projectKeys.llmEndpoints', () => {
  it('is part of the projects key family', () => {
    expect(projectKeys.llmEndpoints('p1')).toEqual([
      'projects',
      'llm-endpoints',
      'p1',
    ]);
  });
});

describe('useLlmEndpoints', () => {
  it('reads through the service and exposes the rows', async () => {
    fetchMock.mockResolvedValue({ok: true, data: [ENDPOINT]});
    const {wrapper} = createWrapper();

    const {result} = renderHook(() => useLlmEndpoints('p1'), {wrapper});

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('p1');
    expect(result.current.data).toEqual([ENDPOINT]);
  });

  it('stays disabled when projectId is falsy', () => {
    const {wrapper} = createWrapper();

    const {result} = renderHook(() => useLlmEndpoints(undefined), {wrapper});

    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces an ErrorResult as the query error state (old backend 404)', async () => {
    fetchMock.mockResolvedValue({ok: false, error: new Error('Not Found')});
    const {wrapper} = createWrapper();

    const {result} = renderHook(() => useLlmEndpoints('p1'), {wrapper});

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Not Found');
  });
});

describe('useCreateLlmEndpoint', () => {
  it('POSTs through the service and invalidates both key families', async () => {
    createMock.mockResolvedValue({ok: true, data: ENDPOINT});
    const {wrapper, queryClient} = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const {result} = renderHook(() => useCreateLlmEndpoint('p1'), {wrapper});
    await result.current.mutateAsync({
      label: 'Lab vLLM',
      base_url: 'https://llm.lab.example.org/v1',
      allowed_models: ['qwen3-30b'],
      api_key: 'sk-secret',
    });

    expect(createMock).toHaveBeenCalledWith('p1', {
      label: 'Lab vLLM',
      base_url: 'https://llm.lab.example.org/v1',
      allowed_models: ['qwen3-30b'],
      api_key: 'sk-secret',
    });
    expectBothFamiliesInvalidated(invalidateSpy);
  });

  it('rejects (mutation error state) when the service refuses', async () => {
    createMock.mockResolvedValue({
      ok: false,
      error: new Error('private address rejected'),
    });
    const {wrapper} = createWrapper();

    const {result} = renderHook(() => useCreateLlmEndpoint('p1'), {wrapper});

    await expect(
      result.current.mutateAsync({
        label: 'Local',
        base_url: 'http://localhost:11434/v1',
        allowed_models: [],
      }),
    ).rejects.toThrow('private address rejected');
  });
});

describe('useUpdateLlmEndpoint', () => {
  it('PUTs the id + body through the service and invalidates both families', async () => {
    updateMock.mockResolvedValue({ok: true, data: ENDPOINT});
    const {wrapper, queryClient} = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const {result} = renderHook(() => useUpdateLlmEndpoint('p1'), {wrapper});
    await result.current.mutateAsync({
      endpointId: ENDPOINT.id,
      body: {
        label: 'Renamed',
        base_url: 'https://llm.lab.example.org/v1',
        allowed_models: ['qwen3-30b'],
        api_key: null,
      },
    });

    expect(updateMock).toHaveBeenCalledWith('p1', ENDPOINT.id, {
      label: 'Renamed',
      base_url: 'https://llm.lab.example.org/v1',
      allowed_models: ['qwen3-30b'],
      api_key: null,
    });
    expectBothFamiliesInvalidated(invalidateSpy);
  });
});

describe('useDeleteLlmEndpoint', () => {
  it('DELETEs through the service and invalidates both families', async () => {
    deleteMock.mockResolvedValue({
      ok: true,
      data: {deleted: true, id: ENDPOINT.id},
    });
    const {wrapper, queryClient} = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const {result} = renderHook(() => useDeleteLlmEndpoint('p1'), {wrapper});
    await result.current.mutateAsync(ENDPOINT.id);

    expect(deleteMock).toHaveBeenCalledWith('p1', ENDPOINT.id);
    expectBothFamiliesInvalidated(invalidateSpy);
  });

  it('rejects with the typed 409 message so the dialog can surface it', async () => {
    deleteMock.mockResolvedValue({
      ok: false,
      error: new Error('The project engine runs on this endpoint.'),
    });
    const {wrapper} = createWrapper();

    const {result} = renderHook(() => useDeleteLlmEndpoint('p1'), {wrapper});

    await expect(result.current.mutateAsync(ENDPOINT.id)).rejects.toThrow(
      'The project engine runs on this endpoint.',
    );
  });
});

describe('useVerifyLlmEndpoint', () => {
  it('probes through the service and invalidates both families', async () => {
    // The probe PERSISTS validation_status on the row, so the list read is
    // stale the moment it returns — and an endpoint that just went from
    // ok to failed changes what the engine picker may offer.
    verifyMock.mockResolvedValue({
      ok: true,
      data: {
        validation_status: 'ok',
        output_mode: 'tool',
        models_seen: ['qwen3-30b'],
        error: null,
      },
    });
    const {wrapper, queryClient} = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const {result} = renderHook(() => useVerifyLlmEndpoint('p1'), {wrapper});
    const probe = await result.current.mutateAsync(ENDPOINT.id);

    expect(verifyMock).toHaveBeenCalledWith('p1', ENDPOINT.id);
    expect(probe.output_mode).toBe('tool');
    expectBothFamiliesInvalidated(invalidateSpy);
  });
});
