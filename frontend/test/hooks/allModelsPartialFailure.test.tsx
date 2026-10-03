/**
 * Regression test for the "partial failure treated as success" bug class
 * (#333) on the cross-model hook.
 *
 * useBatchAllModelsSectionsExtraction fans out over models and relies on
 * processSectionsInChunks, which swallows chunk errors and reports them as
 * failedSections instead of throwing. The bug was that any model that did
 * not throw counted as successful, so a run where every section failed
 * showed the green toast and invoked `options.onSuccess` — callers then
 * refreshed instances as if suggestions had been created.
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

import { useBatchAllModelsSectionsExtraction } from '@/hooks/extraction/useBatchAllModelsSectionsExtraction';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useBatchAllModelsSectionsExtraction — onSuccess needs a success (#333)', () => {
  it('does not report success when every section of every model failed', async () => {
    h.getModelChildSections.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
    h.processSectionsInChunks.mockResolvedValue({
      totalSuggestionsCreated: 0,
      successfulSections: 0,
      failedSections: 2,
      completedSections: 2,
      totalTokensUsed: 0,
      totalDurationMs: 10,
    });
    const onSuccess = vi.fn();

    const { result } = renderHook(() =>
      useBatchAllModelsSectionsExtraction({ onSuccess }),
    );
    await result.current.extractAllSectionsForAllModels({
      projectId: 'p1',
      articleId: 'a1',
      templateId: 't1',
      runId: 'r1',
      models: [{ instanceId: 'i1', entryName: 'CatBoost' }] as never,
    });

    await waitFor(() => {
      expect(h.toast.warning).toHaveBeenCalledTimes(1);
    });
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
