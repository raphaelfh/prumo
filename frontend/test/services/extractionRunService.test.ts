/**
 * Unit tests for ``extractionRunService`` (B4/B5 additions).
 *
 * Covers:
 *  - ``extractForRun`` POSTs to /api/v1/extraction/sections with the right
 *    body, normalises the snake_case ``job_id`` to camelCase ``jobId``,
 *    and returns ``ErrorResult<{ jobId }>``.
 *  - ``getExtractionJobStatus`` GETs the correct status endpoint and
 *    surfaces the API response as-is (already camelCase from the backend).
 *  - Both functions return ``ok:false`` (never throw) when the API errors.
 */

import {describe, expect, it, vi, beforeEach} from 'vitest';

const {apiClientMock} = vi.hoisted(() => ({apiClientMock: vi.fn()}));

vi.mock('@/integrations/api', () => ({
  apiClient: apiClientMock,
}));

import {extractForRun, getExtractionJobStatus} from '@/services/extractionRunService';

const BASE_PARAMS = {
  projectId: 'proj-1',
  articleId: 'art-1',
  templateId: 'tpl-1',
  runId: 'run-1',
};

beforeEach(() => apiClientMock.mockReset());

describe('extractForRun', () => {
  it('POSTs to /api/v1/extraction/sections with defaults', async () => {
    apiClientMock.mockResolvedValueOnce({job_id: 'job-abc'});
    const result = await extractForRun(BASE_PARAMS);
    expect(result.ok).toBe(true);
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/extraction/sections',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          projectId: 'proj-1',
          articleId: 'art-1',
          templateId: 'tpl-1',
          runId: 'run-1',
          skipFieldsWithHumanProposals: true,
          autoAdvanceToReview: false,
          model: 'gpt-4o-mini',
        }),
      }),
    );
  });

  it('normalises snake_case job_id to camelCase jobId', async () => {
    apiClientMock.mockResolvedValueOnce({job_id: 'job-xyz'});
    const result = await extractForRun(BASE_PARAMS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.jobId).toBe('job-xyz');
    }
  });

  it('returns ok:false and never throws on API error', async () => {
    apiClientMock.mockRejectedValueOnce(new Error('network error'));
    const result = await extractForRun(BASE_PARAMS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('network error');
    }
  });

  it('honours explicit flag overrides', async () => {
    apiClientMock.mockResolvedValueOnce({job_id: 'j'});
    await extractForRun({
      ...BASE_PARAMS,
      skipFieldsWithHumanProposals: false,
      autoAdvanceToReview: true,
      model: 'gpt-4o',
    });
    const body = apiClientMock.mock.calls[0][1].body;
    expect(body.skipFieldsWithHumanProposals).toBe(false);
    expect(body.autoAdvanceToReview).toBe(true);
    expect(body.model).toBe('gpt-4o');
  });
});

describe('getExtractionJobStatus', () => {
  it('GETs the correct status endpoint', async () => {
    const statusPayload = {
      jobId: 'job-abc',
      status: 'running',
      result: null,
      error: null,
    };
    apiClientMock.mockResolvedValueOnce(statusPayload);
    const result = await getExtractionJobStatus('job-abc');
    expect(result.ok).toBe(true);
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/extraction/sections/status/job-abc',
    );
  });

  it('surfaces status response data', async () => {
    const statusPayload = {
      jobId: 'job-abc',
      status: 'completed',
      result: {
        mode: 'full',
        extractionRunId: 'run-1',
        totalSuggestionsCreated: 10,
        totalSections: 2,
        successfulSections: 2,
        failedSections: 0,
        suggestionsCreated: 10,
      },
      error: null,
    };
    apiClientMock.mockResolvedValueOnce(statusPayload);
    const result = await getExtractionJobStatus('job-abc');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe('completed');
      expect(result.data.result?.totalSuggestionsCreated).toBe(10);
    }
  });

  it('URL-encodes the jobId', async () => {
    apiClientMock.mockResolvedValueOnce({
      jobId: 'a/b',
      status: 'pending',
      result: null,
      error: null,
    });
    await getExtractionJobStatus('a/b');
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/extraction/sections/status/a%2Fb',
    );
  });

  it('returns ok:false and never throws on API error', async () => {
    apiClientMock.mockRejectedValueOnce(new Error('timeout'));
    const result = await getExtractionJobStatus('job-1');
    expect(result.ok).toBe(false);
  });
});
