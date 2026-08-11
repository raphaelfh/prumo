/**
 * B-5b — the batch section-extraction hooks accept a run-pinned section
 * list and only fall back to the live entity-type read when none is
 * provided.
 *
 * The backend extracts from the run's pinned snapshot, but the dispatch
 * loop used to enumerate sections from LIVE rows — so a manager's
 * unpublished draft section got dispatched (the backend cannot extract
 * it) and a published-but-since-deleted one was skipped. The run form
 * now supplies the snapshot-derived list. The worklist Full-AI path
 * dispatches with no run view loaded, so the live fallback is CHAINED,
 * never removed — and an empty provided list is treated as absent (an
 * empty tree would "succeed" wrongly).
 */

import {renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const h = vi.hoisted(() => ({
  toast: {success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn()},
  getModelChildSections: vi.fn(),
  processSectionsInChunks: vi.fn(),
}));

vi.mock('sonner', () => ({toast: h.toast}));
vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
vi.mock('@/hooks/extraction/helpers/getModelChildSections', () => ({
  getModelChildSections: h.getModelChildSections,
}));
vi.mock('@/hooks/extraction/helpers/processSectionsInChunks', () => ({
  processSectionsInChunks: h.processSectionsInChunks,
}));

import {useBatchAllModelsSectionsExtraction} from '@/hooks/extraction/useBatchAllModelsSectionsExtraction';
import {useBatchSectionExtractionChunked} from '@/hooks/extraction/useBatchSectionExtractionChunked';

const PINNED_SECTIONS = [
  {id: 'et-a', name: 'section_a', label: 'Section A', sort_order: 1},
  {id: 'et-b', name: 'section_b', label: 'Section B', sort_order: 2},
];

const LIVE_SECTIONS = [
  {id: 'et-live', name: 'section_live', label: 'Live Section', sort_order: 1},
];

const okResult = {
  totalSuggestionsCreated: 1,
  successfulSections: 1,
  failedSections: 0,
  completedSections: 1,
  totalTokensUsed: 10,
  totalDurationMs: 5,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.getModelChildSections.mockResolvedValue(LIVE_SECTIONS);
  h.processSectionsInChunks.mockResolvedValue(okResult);
});

describe('useBatchSectionExtractionChunked — section source', () => {
  const request = {
    projectId: 'p1',
    articleId: 'a1',
    templateId: 't1',
    parentInstanceId: 'i1',
    runId: 'r1',
    extractAllSections: true as const,
  };

  it('uses the provided sections and never hits the live read', async () => {
    const {result} = renderHook(() => useBatchSectionExtractionChunked());
    await result.current.extractAllSections({...request, sections: PINNED_SECTIONS});

    expect(h.getModelChildSections).not.toHaveBeenCalled();
    expect(h.processSectionsInChunks).toHaveBeenCalledWith(
      expect.objectContaining({sections: PINNED_SECTIONS}),
    );
  });

  it('does not leak the sections list into the service request', async () => {
    const {result} = renderHook(() => useBatchSectionExtractionChunked());
    await result.current.extractAllSections({...request, sections: PINNED_SECTIONS});

    const {baseRequest} = h.processSectionsInChunks.mock.calls[0][0];
    expect(baseRequest).not.toHaveProperty('sections');
  });

  it('falls back to the live read when no sections are provided (worklist path)', async () => {
    const {result} = renderHook(() => useBatchSectionExtractionChunked());
    await result.current.extractAllSections(request);

    expect(h.getModelChildSections).toHaveBeenCalledWith('i1', 't1');
    expect(h.processSectionsInChunks).toHaveBeenCalledWith(
      expect.objectContaining({sections: LIVE_SECTIONS}),
    );
  });

  it('treats an empty provided list as absent (chained fallback)', async () => {
    const {result} = renderHook(() => useBatchSectionExtractionChunked());
    await result.current.extractAllSections({...request, sections: []});

    expect(h.getModelChildSections).toHaveBeenCalledWith('i1', 't1');
    expect(h.processSectionsInChunks).toHaveBeenCalledWith(
      expect.objectContaining({sections: LIVE_SECTIONS}),
    );
  });
});

describe('useBatchAllModelsSectionsExtraction — section source', () => {
  const params = {
    projectId: 'p1',
    articleId: 'a1',
    templateId: 't1',
    models: [
      {instanceId: 'm1', modelName: 'CatBoost'},
      {instanceId: 'm2', modelName: 'XGBoost'},
    ],
    runId: 'r1',
  };

  it('uses the provided sections for every model and never hits the live read', async () => {
    const {result} = renderHook(() => useBatchAllModelsSectionsExtraction());
    await result.current.extractAllSectionsForAllModels({
      ...params,
      sections: PINNED_SECTIONS,
    });

    expect(h.getModelChildSections).not.toHaveBeenCalled();
    expect(h.processSectionsInChunks).toHaveBeenCalledTimes(2);
    for (const call of h.processSectionsInChunks.mock.calls) {
      expect(call[0].sections).toEqual(PINNED_SECTIONS);
    }
  });

  it('falls back to the per-model live read when no sections are provided', async () => {
    const {result} = renderHook(() => useBatchAllModelsSectionsExtraction());
    await result.current.extractAllSectionsForAllModels(params);

    expect(h.getModelChildSections).toHaveBeenNthCalledWith(1, 'm1', 't1');
    expect(h.getModelChildSections).toHaveBeenNthCalledWith(2, 'm2', 't1');
  });

  it('treats an empty provided list as absent (chained fallback)', async () => {
    const {result} = renderHook(() => useBatchAllModelsSectionsExtraction());
    await result.current.extractAllSectionsForAllModels({...params, sections: []});

    expect(h.getModelChildSections).toHaveBeenCalledTimes(2);
    expect(h.processSectionsInChunks).toHaveBeenCalledWith(
      expect.objectContaining({sections: LIVE_SECTIONS}),
    );
  });
});
