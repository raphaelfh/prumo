import {renderHook, act} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {useExtractionFormAIActions} from '@/hooks/extraction/useExtractionFormAIActions';

// Mock the three downstream hooks the custom hook composes.
const extractModels = vi.fn().mockResolvedValue(undefined);
const extractAllSections = vi.fn().mockResolvedValue(undefined);
const extractAllSectionsForAllModels = vi.fn().mockResolvedValue(undefined);

vi.mock('@/hooks/extraction/useModelExtraction', () => ({
  useModelExtraction: ({onSuccess}: {onSuccess: (runId: string, n: number) => Promise<void>}) => {
    (globalThis as Record<string, unknown>).__modelExtractionOnSuccess = onSuccess;
    return {extractModels, loading: false};
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
  activeModelId: 'm-1' as string | null,
  models: [{instanceId: 'm-1', modelName: 'Logistic'}],
  onRefreshModels: vi.fn().mockResolvedValue(undefined),
  onRefreshInstances: vi.fn().mockResolvedValue(undefined),
  onExtractionComplete: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useExtractionFormAIActions', () => {
  it('exposes 3 trigger handlers and 3 loading flags', () => {
    const {result} = renderHook(() => useExtractionFormAIActions(baseProps()));
    expect(typeof result.current.handleExtractModels).toBe('function');
    expect(typeof result.current.handleExtractAllSections).toBe('function');
    expect(typeof result.current.handleExtractAllSectionsForAllModels).toBe('function');
    expect(result.current.extractingModels).toBe(false);
    expect(result.current.extractingAllSections).toBe(false);
    expect(result.current.extractingAllSectionsForAllModels).toBe(false);
  });

  it('handleExtractModels calls extractModels with the props', async () => {
    const {result} = renderHook(() => useExtractionFormAIActions(baseProps()));
    await act(() => result.current.handleExtractModels());
    expect(extractModels).toHaveBeenCalledWith({
      projectId: 'p',
      articleId: 'a',
      templateId: 't',
    });
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

  it('model-extraction onSuccess refreshes models then instances', async () => {
    const props = baseProps();
    renderHook(() => useExtractionFormAIActions(props));
    const cb = (globalThis as Record<string, unknown>).__modelExtractionOnSuccess as (
      r: string,
      n: number,
    ) => Promise<void>;
    await act(() => cb('run-1', 2));
    expect(props.onRefreshModels).toHaveBeenCalled();
    expect(props.onRefreshInstances).toHaveBeenCalled();
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
