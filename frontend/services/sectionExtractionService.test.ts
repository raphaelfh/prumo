/**
 * Tests for SectionExtractionService — async poll pattern (B8)
 *
 * Covers:
 * - extractSection: POST → poll → map to SectionExtractionResponse
 * - extractAllSections: POST → poll → map to BatchSectionExtractionResponse
 * - failed/cancelled job → throws APIError
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mocks before imports
// ---------------------------------------------------------------------------

const {apiClientMock, getExtractionJobStatusMock} = vi.hoisted(() => ({
  apiClientMock: vi.fn(),
  getExtractionJobStatusMock: vi.fn(),
}));

vi.mock('@/integrations/api/client', () => ({
  apiClient: apiClientMock,
  ApiError: class ApiError extends Error {
    public status?: number;
    public code?: string;
    public traceId?: string;
    constructor(message: string, status?: number, code?: string, traceId?: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.traceId = traceId;
    }
  },
  sectionExtractionClient: vi.fn(),
  modelExtractionClient: vi.fn(),
}));

vi.mock('./extractionRunService', () => ({
  getExtractionJobStatus: getExtractionJobStatusMock,
}));

import {SectionExtractionService} from './sectionExtractionService';

// --------------------------------------------------------------------------
// Test data
// --------------------------------------------------------------------------

const JOB_ID = 'job-123';

const runningStatus = () => ({
  ok: true as const,
  data: {jobId: JOB_ID, status: 'running', result: null, error: null},
});

const completedSingleStatus = () => ({
  ok: true as const,
  data: {
    jobId: JOB_ID,
    status: 'completed',
    error: null,
    result: {
      mode: 'single',
      extractionRunId: 'run-abc',
      entityTypeId: 'et-1',
      suggestionsCreated: 5,
      totalSections: null,
      successfulSections: null,
      failedSections: null,
      totalSuggestionsCreated: null,
      sections: null,
    },
  },
});

const completedBatchStatus = () => ({
  ok: true as const,
  data: {
    jobId: JOB_ID,
    status: 'completed',
    error: null,
    result: {
      mode: 'batch',
      extractionRunId: 'run-batch-xyz',
      entityTypeId: null,
      suggestionsCreated: null,
      totalSections: 3,
      successfulSections: 2,
      failedSections: 1,
      totalSuggestionsCreated: 7,
      sections: [
        {
          entity_type_id: 'et-a',
          entity_type_name: 'Section A',
          success: true,
          suggestions_created: 4,
          tokens_used: 100,
          skipped: false,
          error: null,
        },
        {
          entity_type_id: 'et-b',
          entity_type_name: 'Section B',
          success: false,
          suggestions_created: 0,
          tokens_used: 0,
          skipped: false,
          error: 'parse error',
        },
      ],
    },
  },
});

const failedStatus = () => ({
  ok: true as const,
  data: {jobId: JOB_ID, status: 'failed', error: 'backend error', result: null},
});

const cancelledStatus = () => ({
  ok: true as const,
  data: {jobId: JOB_ID, status: 'cancelled', error: null, result: null},
});

// --------------------------------------------------------------------------
// Setup
// --------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  apiClientMock.mockResolvedValue({job_id: JOB_ID});
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// --------------------------------------------------------------------------
// extractSection
// --------------------------------------------------------------------------

describe('SectionExtractionService.extractSection', () => {
  it('polls until completed and maps to SectionExtractionResponse shape', async () => {
    getExtractionJobStatusMock
      .mockResolvedValueOnce(runningStatus())
      .mockResolvedValueOnce(completedSingleStatus());

    const promise = SectionExtractionService.extractSection({
      projectId: 'p1',
      articleId: 'a1',
      templateId: 't1',
      entityTypeId: 'et-1',
    });

    // First poll is immediate; advance past POLL_INTERVAL_MS for the second
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;

    expect(result.ok).toBe(true);
    expect(result.data?.runId).toBe('run-abc');
    expect(result.data?.suggestionsCreated).toBe(5);
    expect(result.data?.entityTypeId).toBe('et-1');
    expect(getExtractionJobStatusMock).toHaveBeenCalledTimes(2);
    expect(getExtractionJobStatusMock).toHaveBeenCalledWith(JOB_ID);
  });

  it('throws APIError when job fails', async () => {
    getExtractionJobStatusMock.mockResolvedValue(failedStatus());

    // Advance timers while awaiting the rejection in one chain — avoids
    // the "unhandled rejection" window between separate awaits.
    const settled = await Promise.allSettled([
      SectionExtractionService.extractSection({
        projectId: 'p1',
        articleId: 'a1',
        templateId: 't1',
        entityTypeId: 'et-1',
      }),
      vi.advanceTimersByTimeAsync(0),
    ]);
    const [outcome] = settled;
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason?.message).toBe('backend error');
    }
  });

  it('throws APIError when job is cancelled', async () => {
    getExtractionJobStatusMock.mockResolvedValue(cancelledStatus());

    const settled = await Promise.allSettled([
      SectionExtractionService.extractSection({
        projectId: 'p1',
        articleId: 'a1',
        templateId: 't1',
        entityTypeId: 'et-1',
      }),
      vi.advanceTimersByTimeAsync(0),
    ]);
    const [outcome] = settled;
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason?.message).toContain('cancelled');
    }
  });

  it('POSTs to /api/v1/extraction/sections with correct body fields', async () => {
    getExtractionJobStatusMock.mockResolvedValue(completedSingleStatus());

    const promise = SectionExtractionService.extractSection({
      projectId: 'proj-1',
      articleId: 'art-1',
      templateId: 'tmpl-1',
      entityTypeId: 'et-x',
      parentInstanceId: 'inst-p',
      runId: 'run-existing',
      options: {model: 'gpt-4o'},
    });

    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/extraction/sections',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          projectId: 'proj-1',
          articleId: 'art-1',
          templateId: 'tmpl-1',
          entityTypeId: 'et-x',
          parentInstanceId: 'inst-p',
          runId: 'run-existing',
          model: 'gpt-4o',
        }),
      }),
    );
  });
});

// --------------------------------------------------------------------------
// extractAllSections
// --------------------------------------------------------------------------

describe('SectionExtractionService.extractAllSections', () => {
  it('polls until completed and maps to BatchSectionExtractionResponse shape', async () => {
    getExtractionJobStatusMock
      .mockResolvedValueOnce(runningStatus())
      .mockResolvedValueOnce(completedBatchStatus());

    const promise = SectionExtractionService.extractAllSections({
      projectId: 'p1',
      articleId: 'a1',
      templateId: 't1',
      parentInstanceId: 'inst-1',
      extractAllSections: true,
    });

    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;

    expect(result.ok).toBe(true);
    expect(result.data?.runId).toBe('run-batch-xyz');
    expect(result.data?.totalSections).toBe(3);
    expect(result.data?.successfulSections).toBe(2);
    expect(result.data?.failedSections).toBe(1);
    expect(result.data?.totalSuggestionsCreated).toBe(7);

    // sections mapped from SectionOutcome (snake_case) to BatchSectionResult (camelCase)
    expect(result.data?.sections).toHaveLength(2);
    expect(result.data?.sections[0]).toMatchObject({
      entityTypeId: 'et-a',
      entityTypeName: 'Section A',
      success: true,
      suggestionsCreated: 4,
    });
    expect(result.data?.sections[1]).toMatchObject({
      entityTypeId: 'et-b',
      success: false,
      error: 'parse error',
    });

    expect(getExtractionJobStatusMock).toHaveBeenCalledTimes(2);
  });

  it('throws APIError when batch job fails', async () => {
    getExtractionJobStatusMock.mockResolvedValue(failedStatus());

    const settled = await Promise.allSettled([
      SectionExtractionService.extractAllSections({
        projectId: 'p1',
        articleId: 'a1',
        templateId: 't1',
        parentInstanceId: 'inst-1',
        extractAllSections: true,
      }),
      vi.advanceTimersByTimeAsync(0),
    ]);
    const [outcome] = settled;
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason?.message).toBe('backend error');
    }
  });

  it('completed with no sections returns empty sections array', async () => {
    const noSectionsStatus = {
      ok: true as const,
      data: {
        jobId: JOB_ID,
        status: 'completed',
        error: null,
        result: {
          mode: 'batch',
          extractionRunId: 'run-empty',
          entityTypeId: null,
          suggestionsCreated: null,
          totalSections: 0,
          successfulSections: 0,
          failedSections: 0,
          totalSuggestionsCreated: 0,
          sections: [],
        },
      },
    };
    getExtractionJobStatusMock.mockResolvedValue(noSectionsStatus);

    const promise = SectionExtractionService.extractAllSections({
      projectId: 'p1',
      articleId: 'a1',
      templateId: 't1',
      parentInstanceId: 'inst-1',
      extractAllSections: true,
    });

    await vi.advanceTimersByTimeAsync(0);

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data?.sections).toEqual([]);
    expect(result.data?.totalSections).toBe(0);
  });

  it('POSTs with extractAllSections=true and sectionIds', async () => {
    getExtractionJobStatusMock.mockResolvedValue(completedBatchStatus());

    const promise = SectionExtractionService.extractAllSections({
      projectId: 'proj-1',
      articleId: 'art-1',
      templateId: 'tmpl-1',
      parentInstanceId: 'inst-p',
      extractAllSections: true,
      sectionIds: ['s1', 's2'],
    });

    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/extraction/sections',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          projectId: 'proj-1',
          articleId: 'art-1',
          extractAllSections: true,
          sectionIds: ['s1', 's2'],
        }),
      }),
    );
  });
});
