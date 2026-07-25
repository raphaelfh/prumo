/**
 * Regression tests for the "partial failure treated as success" bug class
 * (#284, #333).
 *
 * Both hooks process sections independently and continue past individual
 * failures. The bug in each case was that the aggregate outcome path did not
 * distinguish "everything worked" from "some/none worked":
 *
 * - useTopLevelSectionsExtraction fired `toast.success` whenever a single
 *   section survived, so a 1-of-5 result read as a success (#284).
 * - useBatchSectionExtractionChunked invoked `options.onSuccess` even when
 *   every section failed, so callers refreshed as if suggestions had been
 *   created (#333).
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
  getTopLevelSections: vi.fn(),
  extractSection: vi.fn(),
  getModelChildSections: vi.fn(),
  processSectionsInChunks: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/hooks/extraction/helpers/getTopLevelSections', () => ({
  getTopLevelSections: h.getTopLevelSections,
}));
vi.mock('@/services/sectionExtractionService', () => ({
  SectionExtractionService: { extractSection: h.extractSection },
}));
vi.mock('@/hooks/extraction/helpers/getModelChildSections', () => ({
  getModelChildSections: h.getModelChildSections,
}));
vi.mock('@/hooks/extraction/helpers/processSectionsInChunks', () => ({
  processSectionsInChunks: h.processSectionsInChunks,
}));

import { useBatchSectionExtractionChunked } from '@/hooks/extraction/useBatchSectionExtractionChunked';
import { useTopLevelSectionsExtraction } from '@/hooks/extraction/useTopLevelSectionsExtraction';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTopLevelSectionsExtraction — partial failure is a warning (#284)', () => {
  const params = {
    projectId: 'p1',
    articleId: 'a1',
    templateId: 't1',
    runId: 'r1',
  };

  it('warns instead of claiming success when only some sections succeed', async () => {
    h.getTopLevelSections.mockResolvedValue([
      { id: 's1', label: 'Section one' },
      { id: 's2', label: 'Section two' },
    ]);
    // First section succeeds, second one throws.
    h.extractSection
      .mockResolvedValueOnce({ data: { suggestionsCreated: 3 } })
      .mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useTopLevelSectionsExtraction());
    await result.current.extractTopLevelSections(params);

    await waitFor(() => {
      expect(h.toast.warning).toHaveBeenCalledTimes(1);
    });
    expect(h.toast.success).not.toHaveBeenCalled();

    const [title, opts] = h.toast.warning.mock.calls[0];
    expect(title).toContain('1/2');
    expect(opts.description).toContain('1 section(s) failed');
  });

  it('still reports an unqualified success when every section succeeds', async () => {
    h.getTopLevelSections.mockResolvedValue([{ id: 's1', label: 'Section one' }]);
    h.extractSection.mockResolvedValue({ data: { suggestionsCreated: 2 } });

    const { result } = renderHook(() => useTopLevelSectionsExtraction());
    await result.current.extractTopLevelSections(params);

    await waitFor(() => {
      expect(h.toast.success).toHaveBeenCalledTimes(1);
    });
    expect(h.toast.warning).not.toHaveBeenCalled();
  });

  it('reports an error when every section fails', async () => {
    h.getTopLevelSections.mockResolvedValue([{ id: 's1', label: 'Section one' }]);
    h.extractSection.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useTopLevelSectionsExtraction());
    await result.current.extractTopLevelSections(params);

    await waitFor(() => {
      expect(h.toast.error).toHaveBeenCalledTimes(1);
    });
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(h.toast.warning).not.toHaveBeenCalled();
  });
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
