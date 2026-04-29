/**
 * Tests for the ``useRunAIExtraction`` hook.
 *
 * Covers the contract that:
 *  - It POSTs to ``/api/v1/extraction/sections`` with the run reuse fields
 *    (``runId``, ``autoAdvanceToReview``, ``skipFieldsWithHumanProposals``)
 *    that distinguish QA-style "fill an existing run" from the legacy
 *    "create a new run per section" path.
 *  - The frontend defaults are the QA defaults: ``autoAdvanceToReview=false``
 *    (publish flow advances stages atomically) and
 *    ``skipFieldsWithHumanProposals=true`` (re-running AI must not bury the
 *    user's edits).
 *  - ``onSuccess`` runs after a successful extraction and ``error`` is
 *    surfaced (and re-thrown) when the API fails.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/api', () => ({
  apiClient: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

import { apiClient } from '@/integrations/api';
import { useRunAIExtraction } from '@/hooks/extraction/ai/useRunAIExtraction';

const apiClientMock = apiClient as unknown as ReturnType<typeof vi.fn>;

const SUCCESS_PAYLOAD = {
  extractionRunId: 'run-1',
  totalSections: 3,
  successfulSections: 3,
  failedSections: 0,
  totalSuggestionsCreated: 12,
  totalTokensUsed: 1234,
  durationMs: 5000,
};

beforeEach(() => {
  apiClientMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useRunAIExtraction', () => {
  it('POSTs to /api/v1/extraction/sections with QA defaults', async () => {
    apiClientMock.mockResolvedValueOnce(SUCCESS_PAYLOAD);
    const { result } = renderHook(() => useRunAIExtraction());

    await act(async () => {
      await result.current.extractForRun({
        projectId: 'proj-1',
        articleId: 'art-1',
        templateId: 'tpl-1',
        runId: 'run-1',
      });
    });

    expect(apiClientMock).toHaveBeenCalledTimes(1);
    expect(apiClientMock).toHaveBeenCalledWith('/api/v1/extraction/sections', {
      method: 'POST',
      body: {
        projectId: 'proj-1',
        articleId: 'art-1',
        templateId: 'tpl-1',
        runId: 'run-1',
        skipFieldsWithHumanProposals: true,
        autoAdvanceToReview: false,
        model: 'gpt-4o-mini',
      },
    });
  });

  it('honours explicit overrides for the run-reuse flags', async () => {
    apiClientMock.mockResolvedValueOnce(SUCCESS_PAYLOAD);
    const { result } = renderHook(() => useRunAIExtraction());

    await act(async () => {
      await result.current.extractForRun({
        projectId: 'proj-1',
        articleId: 'art-1',
        templateId: 'tpl-1',
        runId: 'run-1',
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

  it('returns the typed response payload (no ApiResponse double-unwrap)', async () => {
    apiClientMock.mockResolvedValueOnce(SUCCESS_PAYLOAD);
    const { result } = renderHook(() => useRunAIExtraction());

    let returned;
    await act(async () => {
      returned = await result.current.extractForRun({
        projectId: 'proj-1',
        articleId: 'art-1',
        templateId: 'tpl-1',
        runId: 'run-1',
      });
    });
    expect(returned).toEqual(SUCCESS_PAYLOAD);
  });

  it('flips loading→true→false around the call', async () => {
    let resolve!: (v: unknown) => void;
    apiClientMock.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { result } = renderHook(() => useRunAIExtraction());

    expect(result.current.loading).toBe(false);

    let extractPromise: Promise<unknown>;
    act(() => {
      extractPromise = result.current.extractForRun({
        projectId: 'proj-1',
        articleId: 'art-1',
        templateId: 'tpl-1',
        runId: 'run-1',
      });
    });

    await waitFor(() => expect(result.current.loading).toBe(true));

    await act(async () => {
      resolve(SUCCESS_PAYLOAD);
      await extractPromise;
    });

    expect(result.current.loading).toBe(false);
  });

  it('invokes onSuccess with the response and clears prior errors', async () => {
    const onSuccess = vi.fn();
    apiClientMock.mockResolvedValueOnce(SUCCESS_PAYLOAD);
    const { result } = renderHook(() => useRunAIExtraction({ onSuccess }));

    await act(async () => {
      await result.current.extractForRun({
        projectId: 'proj-1',
        articleId: 'art-1',
        templateId: 'tpl-1',
        runId: 'run-1',
      });
    });

    expect(onSuccess).toHaveBeenCalledWith(SUCCESS_PAYLOAD);
    expect(result.current.error).toBeNull();
  });

  it('surfaces and rethrows API errors so callers can react', async () => {
    apiClientMock.mockRejectedValueOnce(
      new Error('Run is at REVIEW; AI extraction requires PROPOSAL'),
    );
    const { result } = renderHook(() => useRunAIExtraction());

    await act(async () => {
      await expect(
        result.current.extractForRun({
          projectId: 'proj-1',
          articleId: 'art-1',
          templateId: 'tpl-1',
          runId: 'run-1',
        }),
      ).rejects.toThrow(/PROPOSAL/);
    });

    await waitFor(() =>
      expect(result.current.error).toMatch(/PROPOSAL/),
    );
    expect(result.current.loading).toBe(false);
  });
});
