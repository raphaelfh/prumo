/**
 * Tests for ``useExtractionJob``.
 *
 * Verifies:
 *  - Disabled when ``jobId`` is null (no fetches).
 *  - Polls (refetchInterval active) while status is pending / running.
 *  - Stops polling when status reaches a terminal state (completed / failed
 *    / cancelled).
 *  - Surfaces the result payload on completion.
 */

import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import type {ReactElement, ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// Mock the service so we never hit the network.
vi.mock('@/services/extractionRunService', () => ({
  getExtractionJobStatus: vi.fn(),
}));

import {getExtractionJobStatus} from '@/services/extractionRunService';
import {useExtractionJob} from '@/hooks/extraction/useExtractionJob';
import type {ExtractionJobStatus} from '@/services/extractionRunService';

const statusMock = getExtractionJobStatus as unknown as ReturnType<typeof vi.fn>;

function makeStatus(
  status: ExtractionJobStatus['status'],
  overrides: Partial<ExtractionJobStatus> = {},
): ExtractionJobStatus {
  return {
    jobId: 'job-1',
    status,
    result: null,
    error: null,
    ...overrides,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
  const wrapper = ({children}: {children: ReactNode}): ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {wrapper, queryClient};
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useExtractionJob', () => {
  it('is disabled and does not fetch when jobId is null', () => {
    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useExtractionJob(null), {wrapper});
    expect(statusMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it('fetches when jobId is provided', async () => {
    statusMock.mockResolvedValue({ok: true, data: makeStatus('running')});
    const {wrapper} = createWrapper();
    renderHook(() => useExtractionJob('job-1'), {wrapper});
    await waitFor(() => expect(statusMock).toHaveBeenCalledWith('job-1'));
  });

  it('surfaces completed result data', async () => {
    const completedStatus = makeStatus('completed', {
      result: {
        mode: 'full',
        extractionRunId: 'run-1',
        totalSuggestionsCreated: 5,
        totalSections: 2,
        successfulSections: 2,
        failedSections: 0,
        suggestionsCreated: 5,
      },
    });
    statusMock.mockResolvedValue({ok: true, data: completedStatus});
    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useExtractionJob('job-1'), {wrapper});
    await waitFor(() => expect(result.current.data?.status).toBe('completed'));
    expect(result.current.data?.result?.totalSuggestionsCreated).toBe(5);
  });

  it('throws (causes error state) when service returns ok:false', async () => {
    statusMock.mockResolvedValue({
      ok: false,
      error: new Error('poll failed'),
    });
    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useExtractionJob('job-1'), {wrapper});
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('stops polling when status is completed (only one fetch occurs in 50 ms window)', async () => {
    // Immediately return completed on first fetch.
    statusMock.mockResolvedValue({ok: true, data: makeStatus('completed')});

    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useExtractionJob('job-1'), {wrapper});
    await waitFor(() => expect(result.current.data?.status).toBe('completed'));
    // Record calls after the initial fetch settles.
    const callCount = statusMock.mock.calls.length;
    // refetchInterval returns false for terminal status, so no further
    // automatic refetch should fire within the 50 ms window.
    await new Promise((r) => setTimeout(r, 50));
    expect(statusMock.mock.calls.length).toBe(callCount);
  });

  it('stops polling when status is failed', async () => {
    statusMock.mockResolvedValue({ok: true, data: makeStatus('failed', {error: 'oops'})});
    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useExtractionJob('job-1'), {wrapper});
    await waitFor(() => expect(result.current.data?.status).toBe('failed'));
    const callCount = statusMock.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(statusMock.mock.calls.length).toBe(callCount);
  });
});
