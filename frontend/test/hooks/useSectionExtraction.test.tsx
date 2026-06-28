/**
 * Tests for the async ``useSectionExtraction`` hook (B4/B5 rewrite).
 *
 * Covers:
 *  - POST kicks off the job and stores jobId in state.
 *  - ``onSuccess`` fires with runId + suggestionsCreated when completed.
 *  - Success toast emitted on completion with suggestion count.
 *  - Warning toast when completed with 0 suggestions.
 *  - Error toast + ``error`` state when kickoff fails.
 *  - Error toast + ``error`` state when job reaches ``failed``.
 */

import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {ReactElement, ReactNode} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/integrations/api/client', () => ({
  apiClient: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
  sectionExtractionClient: vi.fn(),
  modelExtractionClient: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {success: vi.fn(), error: vi.fn(), warning: vi.fn()},
}));

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

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

import {apiClient} from '@/integrations/api/client';
import {getExtractionJobStatus} from '@/services/extractionRunService';
import {useSectionExtraction} from '@/hooks/extraction/useSectionExtraction';
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
  return {jobId: 'job-sec-1', status, result: null, error: null, ...overrides};
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
  entityTypeId: 'et-1',
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

describe('useSectionExtraction (async job)', () => {
  it('POSTs to /api/v1/extraction/sections with section params', async () => {
    apiClientMock.mockResolvedValueOnce({job_id: 'job-sec-1'});
    statusMock.mockResolvedValue({ok: true, data: makeStatus('completed')});

    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useSectionExtraction(), {wrapper});

    await act(async () => {
      await result.current.extractSection(PARAMS);
    });

    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/extraction/sections',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          projectId: 'proj-1',
          entityTypeId: 'et-1',
          runId: 'run-1',
        }),
      }),
    );
  });

  it('calls onSuccess with runId and suggestionsCreated when completed', async () => {
    apiClientMock.mockResolvedValueOnce({job_id: 'job-sec-1'});
    statusMock.mockResolvedValue({
      ok: true,
      data: makeStatus('completed', {
        result: {
          mode: 'section',
          extractionRunId: 'run-abc',
          suggestionsCreated: 4,
          totalSuggestionsCreated: 4,
          totalSections: 1,
          successfulSections: 1,
          failedSections: 0,
        },
      }),
    });

    const onSuccess = vi.fn();
    const {wrapper} = createWrapper();
    const {result} = renderHook(
      () => useSectionExtraction({onSuccess}),
      {wrapper},
    );

    await act(async () => {
      await result.current.extractSection(PARAMS);
    });

    // Exactly one call guards against a future double-fire regression.
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledWith('run-abc', 4);
    expect(toast.success).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it('shows warning toast when completed with 0 suggestions', async () => {
    apiClientMock.mockResolvedValueOnce({job_id: 'job-sec-1'});
    statusMock.mockResolvedValue({
      ok: true,
      data: makeStatus('completed', {
        result: {
          mode: 'section',
          extractionRunId: 'run-abc',
          suggestionsCreated: 0,
          totalSuggestionsCreated: 0,
          totalSections: 1,
          successfulSections: 0,
          failedSections: 0,
        },
      }),
    });

    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useSectionExtraction(), {wrapper});

    await act(async () => {
      await result.current.extractSection(PARAMS);
    });

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        'sectionExtractionNoSuggestionsTitle',
        expect.objectContaining({
          description: 'sectionExtractionNoSuggestionsDesc',
        }),
      ),
    );
    expect(result.current.loading).toBe(false);
  });

  it('sets error and shows toast when kickoff POST fails', async () => {
    apiClientMock.mockRejectedValueOnce(new Error('auth error'));

    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useSectionExtraction(), {wrapper});

    await act(async () => {
      await result.current.extractSection(PARAMS);
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(toast.error).toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('sets error and shows toast when job reaches failed', async () => {
    apiClientMock.mockResolvedValueOnce({job_id: 'job-sec-1'});
    statusMock.mockResolvedValue({
      ok: true,
      data: makeStatus('failed', {error: 'extraction failed'}),
    });

    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useSectionExtraction(), {wrapper});

    await act(async () => {
      await result.current.extractSection(PARAMS);
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(toast.error).toHaveBeenCalledWith(
      'sectionExtractionErrorTitle',
      expect.objectContaining({description: 'extraction failed'}),
    );
    expect(result.current.loading).toBe(false);
  });

  it('maps a MISSING_API_KEY failure code to the specific auth toast copy', async () => {
    apiClientMock.mockResolvedValueOnce({job_id: 'job-sec-1'});
    statusMock.mockResolvedValue({
      ok: true,
      data: makeStatus('failed', {
        error: 'No OpenAI API key available.',
        errorCode: 'MISSING_API_KEY',
      }),
    });

    const {wrapper} = createWrapper();
    const {result} = renderHook(() => useSectionExtraction(), {wrapper});

    await act(async () => {
      await result.current.extractSection(PARAMS);
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(toast.error).toHaveBeenCalledWith(
      'sectionExtractionErrorAuth',
      expect.objectContaining({description: 'No OpenAI API key available.'}),
    );
  });
});
