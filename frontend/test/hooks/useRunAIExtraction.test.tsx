/**
 * Tests for the async ``useRunAIExtraction`` hook (B4/B5 rewrite).
 *
 * Covers:
 *  - POST kicks off the job and stores jobId in state.
 *  - ``loading`` is true while the kickoff is in flight.
 *  - ``loading`` is true while polling (pending/running) and false once terminal.
 *  - ``onSuccess`` fires + success toast when job completes.
 *  - Error toast + ``error`` state when the kickoff POST fails.
 *  - Error toast + ``error`` state when the job reaches ``failed`` status.
 */

import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {ReactElement, ReactNode} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (must be declared before imports that reference them)
// ---------------------------------------------------------------------------

vi.mock('@/integrations/api', () => ({
  apiClient: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {success: vi.fn(), error: vi.fn(), warning: vi.fn()},
}));

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

// Mock the job-status service function directly so we control poll responses.
vi.mock('@/services/extractionRunService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/extractionRunService')>();
  return {
    ...actual,
    getExtractionJobStatus: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {apiClient} from '@/integrations/api';
import {getExtractionJobStatus} from '@/services/extractionRunService';
import {useRunAIExtraction} from '@/hooks/extraction/ai/useRunAIExtraction';
import {toast} from 'sonner';
import type {ExtractionJobStatus} from '@/services/extractionRunService';

const apiClientMock = apiClient as unknown as ReturnType<typeof vi.fn>;
const statusMock = getExtractionJobStatus as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStatus(
  status: ExtractionJobStatus['status'],
  overrides: Partial<ExtractionJobStatus> = {},
): ExtractionJobStatus {
  return {jobId: 'job-1', status, result: null, error: null, ...overrides};
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

const PARAMS = {
  projectId: 'proj-1',
  articleId: 'art-1',
  templateId: 'tpl-1',
  runId: 'run-1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useRunAIExtraction (async job)', () => {
  it('starts loading on call and POSTs to /api/v1/extraction/sections', async () => {
    // Mock the POST to return a job id.
    apiClientMock.mockResolvedValueOnce({job_id: 'job-1'});
    // Mock the poll to immediately return completed so the hook settles.
    statusMock.mockResolvedValue({
      ok: true,
      data: makeStatus('completed', {
        result: {
          mode: 'full',
          extractionRunId: 'run-1',
          totalSuggestionsCreated: 3,
          totalSections: 1,
          successfulSections: 1,
          failedSections: 0,
          suggestionsCreated: 3,
        },
      }),
    });

    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useRunAIExtraction(), {wrapper});

    await act(async () => {
      await result.current.extractForRun(PARAMS);
    });

    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/extraction/sections',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          projectId: 'proj-1',
          runId: 'run-1',
          skipFieldsWithHumanProposals: true,
          autoAdvanceToReview: false,
        }),
      }),
    );
  });

  it('honours explicit overrides for run-reuse flags', async () => {
    apiClientMock.mockResolvedValueOnce({job_id: 'job-2'});
    statusMock.mockResolvedValue({ok: true, data: makeStatus('completed')});

    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useRunAIExtraction(), {wrapper});

    await act(async () => {
      await result.current.extractForRun({
        ...PARAMS,
        skipFieldsWithHumanProposals: false,
        autoAdvanceToReview: true,
        model: 'gpt-4o',
      });
    });

    const body = apiClientMock.mock.calls[0][1].body;
    expect(body.skipFieldsWithHumanProposals).toBe(false);
    expect(body.autoAdvanceToReview).toBe(true);
    expect(body.model).toBe('gpt-4o');
  });

  it('calls onSuccess and shows success toast when job completes', async () => {
    apiClientMock.mockResolvedValueOnce({job_id: 'job-1'});
    statusMock.mockResolvedValue({
      ok: true,
      data: makeStatus('completed', {
        result: {
          mode: 'full',
          extractionRunId: 'run-1',
          totalSuggestionsCreated: 7,
          totalSections: 2,
          successfulSections: 2,
          failedSections: 0,
          suggestionsCreated: 7,
        },
      }),
    });

    const onSuccess = vi.fn().mockResolvedValue(undefined);
    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useRunAIExtraction({onSuccess}), {wrapper});

    await act(async () => {
      await result.current.extractForRun(PARAMS);
    });

    // Wait for the effect to fire after polling settles. Asserting exactly
    // one call guards against a future double-fire regression.
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith(
      'fullAICompleteSuccessTitle',
      expect.objectContaining({description: expect.stringContaining('7')}),
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets error and shows error toast when kickoff POST fails', async () => {
    apiClientMock.mockRejectedValueOnce(new Error('server error'));
    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useRunAIExtraction(), {wrapper});

    await act(async () => {
      await result.current.extractForRun(PARAMS);
    });

    await waitFor(() => expect(result.current.error).toMatch(/server error/));
    expect(toast.error).toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('sets error and shows error toast when job reaches failed status', async () => {
    apiClientMock.mockResolvedValueOnce({job_id: 'job-1'});
    statusMock.mockResolvedValue({
      ok: true,
      data: makeStatus('failed', {error: 'LLM timed out'}),
    });

    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useRunAIExtraction(), {wrapper});

    await act(async () => {
      await result.current.extractForRun(PARAMS);
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(toast.error).toHaveBeenCalledWith(
      'extractionJobFailedTitle',
      expect.objectContaining({description: expect.stringContaining('LLM timed out')}),
    );
    expect(result.current.loading).toBe(false);
  });

  it('maps a MISSING_API_KEY failure code to the specific auth toast copy', async () => {
    apiClientMock.mockResolvedValueOnce({job_id: 'job-1'});
    statusMock.mockResolvedValue({
      ok: true,
      data: makeStatus('failed', {
        error: 'No OpenAI API key available.',
        errorCode: 'MISSING_API_KEY',
      }),
    });

    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useRunAIExtraction(), {wrapper});

    await act(async () => {
      await result.current.extractForRun(PARAMS);
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(toast.error).toHaveBeenCalledWith(
      'sectionExtractionErrorAuth',
      expect.objectContaining({description: 'No OpenAI API key available.'}),
    );
    expect(result.current.loading).toBe(false);
  });

  it('loading is true while kickoff is in flight', async () => {
    let resolvePost!: (v: unknown) => void;
    apiClientMock.mockReturnValueOnce(
      new Promise((r) => {
        resolvePost = r;
      }),
    );

    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useRunAIExtraction(), {wrapper});

    expect(result.current.loading).toBe(false);

    let extractPromise: Promise<void>;
    act(() => {
      extractPromise = result.current.extractForRun(PARAMS);
    });

    await waitFor(() => expect(result.current.loading).toBe(true));

    // Now resolve and let it settle.
    statusMock.mockResolvedValue({ok: true, data: makeStatus('completed')});
    await act(async () => {
      resolvePost({job_id: 'job-1'});
      await extractPromise;
    });
  });
});
