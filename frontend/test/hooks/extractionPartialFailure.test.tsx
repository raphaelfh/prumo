/**
 * Regression test for the "partial failure treated as success" bug class
 * (#333).
 *
 * useBatchSectionExtractionChunked processes sections independently and
 * continues past individual failures. The bug was that the aggregate
 * outcome path invoked `options.onSuccess` even when every section failed,
 * so callers refreshed as if suggestions had been created.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
  getModelChildSections: vi.fn(),
  processSectionsInChunks: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/hooks/extraction/helpers/getModelChildSections', () => ({
  getModelChildSections: h.getModelChildSections,
}));
vi.mock('@/hooks/extraction/helpers/processSectionsInChunks', () => ({
  processSectionsInChunks: h.processSectionsInChunks,
}));

import { useBatchSectionExtractionChunked } from '@/hooks/extraction/useBatchSectionExtractionChunked';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useBatchSectionExtractionChunked — onSuccess needs a success (#333)', () => {
  const request = {
    projectId: 'p1',
    articleId: 'a1',
    templateId: 't1',
    parentInstanceId: 'i1',
    runId: 'r1',
  } as never;

  it('does not call onSuccess when every section failed', async () => {
    h.getModelChildSections.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
    h.processSectionsInChunks.mockResolvedValue({
      totalSuggestionsCreated: 0,
      successfulSections: 0,
      failedSections: 2,
      totalTokensUsed: 0,
      totalDurationMs: 10,
    });
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useBatchSectionExtractionChunked({ onSuccess }));
    await result.current.extractAllSections(request);

    await waitFor(() => {
      expect(h.toast.warning).toHaveBeenCalledTimes(1);
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('still calls onSuccess when at least one section succeeded', async () => {
    h.getModelChildSections.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
    h.processSectionsInChunks.mockResolvedValue({
      totalSuggestionsCreated: 4,
      successfulSections: 1,
      failedSections: 1,
      totalTokensUsed: 100,
      totalDurationMs: 10,
    });
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useBatchSectionExtractionChunked({ onSuccess }));
    await result.current.extractAllSections(request);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ successfulSections: 1, failedSections: 1 }),
    );
  });
});
