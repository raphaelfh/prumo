import {renderHook, act} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {useExtractionFormAIActions} from '@/hooks/extraction/useExtractionFormAIActions';

// Mock the three downstream hooks the custom hook composes.
const identifyEntries = vi.fn().mockResolvedValue(undefined);
const extractAllSections = vi.fn().mockResolvedValue(undefined);
const extractAllSectionsForAllModels = vi.fn().mockResolvedValue(undefined);

vi.mock('@/hooks/extraction/useSectionExtraction', () => ({
  useSectionExtraction: ({onSuccess}: {onSuccess: () => Promise<void>}) => {
    (globalThis as Record<string, unknown>).__identifyOnSuccess = onSuccess;
    return {extractSection: identifyEntries, loading: false, error: null};
  },
}));
vi.mock('@/hooks/extraction/useBatchSectionExtractionChunked', () => ({
  useBatchSectionExtractionChunked: ({onSuccess}: {onSuccess: (r: unknown) => Promise<void>}) => {
    (globalThis as Record<string, unknown>).__batchSectionOnSuccess = onSuccess;
    return {extractAllSections, loading: false, progress: null};
  },
}));
vi.mock('@/hooks/extraction/useBatchAllModelsSectionsExtraction', () => ({
  useBatchAllModelsSectionsExtraction: ({onSuccess}: {onSuccess: (r: unknown) => Promise<void>}) => {
    (globalThis as Record<string, unknown>).__batchAllOnSuccess = onSuccess;
    return {extractAllSectionsForAllModels, loading: false, progress: null};
  },
}));

const baseProps = () => ({
  projectId: 'p',
  articleId: 'a',
  templateId: 't',
  entityTypeId: 'et-group',
  parentInstanceId: null as string | null,
  activeModelId: 'm-1' as string | null,
  models: [{instanceId: 'm-1', entryName: 'Logistic'}],
  onRefreshInstances: vi.fn().mockResolvedValue(undefined),
  onExtractionComplete: vi.fn(),
});

// Run-pinned section list (B-5b): the form derives it from the run view and
// threads it into every batch dispatch so the loop matches the snapshot.
const RUN_VIEW_SECTIONS = [
  {id: 'et-a', name: 'section_a', label: 'Section A', sort_order: 1},
  {id: 'et-b', name: 'section_b', label: 'Section B', sort_order: 2},
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useExtractionFormAIActions', () => {
  it('exposes 3 trigger handlers and 3 loading flags', () => {
    const {result} = renderHook(() => useExtractionFormAIActions(baseProps()));
    expect(typeof result.current.handleIdentifyEntries).toBe('function');
    expect(typeof result.current.handleExtractAllSections).toBe('function');
    expect(typeof result.current.handleExtractAllSectionsForAllModels).toBe('function');
    expect(result.current.identifying).toBe(false);
    expect(result.current.extractingAllSections).toBe(false);
    expect(result.current.extractingAllSectionsForAllModels).toBe(false);
  });

  it('handleIdentifyEntries targets THIS group under THIS parent entry', async () => {
    // The whole point of the repoint: the retired endpoint took no entity
    // type, so on any group but the one container it identified the wrong
    // one. Both coordinates have to reach the request.
    const props = {...baseProps(), entityTypeId: 'et-validations', parentInstanceId: 'm-a'};
    const {result} = renderHook(() => useExtractionFormAIActions(props));
    await act(() => result.current.handleIdentifyEntries());
    expect(identifyEntries).toHaveBeenCalledWith({
      projectId: 'p',
      articleId: 'a',
      templateId: 't',
      runId: undefined,
      entityTypeId: 'et-validations',
      parentInstanceId: 'm-a',
    });
  });

  it('sends no parentInstanceId for a root group', async () => {
    const {result} = renderHook(() => useExtractionFormAIActions(baseProps()));
    await act(() => result.current.handleIdentifyEntries());
    expect(identifyEntries).toHaveBeenCalledWith(
      expect.objectContaining({parentInstanceId: undefined}),
    );
  });

  it('handleExtractAllSections short-circuits when no active model', async () => {
    const props = {...baseProps(), activeModelId: null};
    const {result} = renderHook(() => useExtractionFormAIActions(props));
    await act(() => result.current.handleExtractAllSections());
    expect(extractAllSections).not.toHaveBeenCalled();
  });

  it('handleExtractAllSectionsForAllModels short-circuits when no models', async () => {
    const props = {...baseProps(), models: []};
    const {result} = renderHook(() => useExtractionFormAIActions(props));
    await act(() => result.current.handleExtractAllSectionsForAllModels());
    expect(extractAllSectionsForAllModels).not.toHaveBeenCalled();
  });

  it('identification onSuccess refreshes instances and fires completion', async () => {
    // It does NOT chain "extract every section for every entry" the way the
    // model path did. That chain existed because the model endpoint created
    // BARE instances; `/extraction/sections` fills the group's own fields in
    // the same call, and filling the CHILD sections stays the separate,
    // separately-labelled action.
    const props = baseProps();
    renderHook(() => useExtractionFormAIActions(props));
    const cb = (globalThis as Record<string, unknown>).__identifyOnSuccess as () => Promise<void>;
    await act(() => cb());
    expect(props.onRefreshInstances).toHaveBeenCalled();
    expect(props.onExtractionComplete).toHaveBeenCalled();
    expect(extractAllSectionsForAllModels).not.toHaveBeenCalled();
  });

  it('threads the run-view sections into per-model batch extraction (B-5b)', async () => {
    const props = {...baseProps(), sections: RUN_VIEW_SECTIONS};
    const {result} = renderHook(() => useExtractionFormAIActions(props));
    await act(() => result.current.handleExtractAllSections());
    expect(extractAllSections).toHaveBeenCalledWith(
      expect.objectContaining({sections: RUN_VIEW_SECTIONS}),
    );
  });

  it('threads the run-view sections into cross-model batch extraction (B-5b)', async () => {
    const props = {...baseProps(), sections: RUN_VIEW_SECTIONS};
    const {result} = renderHook(() => useExtractionFormAIActions(props));
    await act(() => result.current.handleExtractAllSectionsForAllModels());
    expect(extractAllSectionsForAllModels).toHaveBeenCalledWith(
      expect.objectContaining({sections: RUN_VIEW_SECTIONS}),
    );
  });

  it('batch-section onSuccess refreshes instances and fires completion callback', async () => {
    const props = baseProps();
    renderHook(() => useExtractionFormAIActions(props));
    const cb = (globalThis as Record<string, unknown>).__batchSectionOnSuccess as (
      r: unknown,
    ) => Promise<void>;
    await act(() => cb({}));
    expect(props.onRefreshInstances).toHaveBeenCalled();
    expect(props.onExtractionComplete).toHaveBeenCalled();
  });
});
