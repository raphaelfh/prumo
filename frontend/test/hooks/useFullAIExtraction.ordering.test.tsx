/**
 * Phase-ordering regression for ``useFullAIExtraction`` (the "extract
 * everything" flow): Phase 2 (load extracted models) must not run until
 * Phase 1's model extraction has actually completed.
 *
 * The fire-and-forget bug (#269 refactor dropped the ``return`` on the
 * ``doExtract()`` chain in ``useModelExtraction``) made Phase 1 settle
 * immediately, so Phase 2 read the models table before the new models
 * existed — pre-existing models got their sections extracted, freshly
 * extracted ones never did, and the UI showed an "extraction complete"
 * with nothing visibly extracted.
 *
 * Uses the REAL ``useModelExtraction`` (the composition under test) with a
 * deferred service response; the sibling batch/top-level hooks stay mocked.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  serviceExtractModels: vi.fn(),
  loadExtractedModels: vi.fn(),
  extractTopLevelSections: vi.fn(),
  extractAllSectionsForAllModels: vi.fn(),
}));

vi.mock('@/services/sectionExtractionService', () => ({
  SectionExtractionService: { extractModels: h.serviceExtractModels },
}));
vi.mock('@/services/extractionInstanceService', () => ({
  loadExtractedModels: h.loadExtractedModels,
}));
vi.mock('@/hooks/extraction/useTopLevelSectionsExtraction', () => ({
  useTopLevelSectionsExtraction: () => ({ extractTopLevelSections: h.extractTopLevelSections }),
}));
vi.mock('@/hooks/extraction/useBatchAllModelsSectionsExtraction', () => ({
  useBatchAllModelsSectionsExtraction: () => ({
    extractAllSectionsForAllModels: h.extractAllSectionsForAllModels,
  }),
}));
vi.mock('@/hooks/extraction/helpers/queryEntityTypes', () => ({
  queryEntityTypesWithFallback: vi.fn(async () => [{ id: 'model-container-1' }]),
}));
vi.mock('@/lib/extraction/entityTypeRoles', () => ({
  ENTITY_ROLE: { MODEL_CONTAINER: 'model_container' },
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

import { useFullAIExtraction } from '@/hooks/extraction/useFullAIExtraction';

const PARAMS = { projectId: 'p1', articleId: 'a1', templateId: 't1' };
const SERVICE_RESULT = {
  data: {
    runId: 'run-1',
    modelsCreated: [{ instanceId: 'inst-new', modelName: 'CatBoost' }],
    metadata: { tokensTotal: 10 },
  },
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.extractTopLevelSections.mockResolvedValue({ totalSections: 0, successfulSections: 0 });
  h.extractAllSectionsForAllModels.mockResolvedValue(undefined);
  h.loadExtractedModels.mockResolvedValue({
    ok: true,
    data: [{ instanceId: 'inst-new', modelName: 'CatBoost' }],
  });
});

describe('useFullAIExtraction phase ordering', () => {
  it('does not load models (Phase 2) before model extraction completes', async () => {
    const gate = deferred<typeof SERVICE_RESULT>();
    h.serviceExtractModels.mockReturnValue(gate.promise);

    const { result } = renderHook(() => useFullAIExtraction());

    let fullPromise: Promise<void>;
    act(() => {
      fullPromise = result.current.extractFullAI(PARAMS);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // Model extraction is still in flight — the models table must not have
    // been read yet, and Phase 3 must not have started.
    expect(h.loadExtractedModels).not.toHaveBeenCalled();
    expect(h.extractAllSectionsForAllModels).not.toHaveBeenCalled();

    await act(async () => {
      gate.resolve(SERVICE_RESULT);
      await fullPromise;
    });

    expect(h.loadExtractedModels).toHaveBeenCalledTimes(1);
    expect(h.extractAllSectionsForAllModels).toHaveBeenCalledWith(
      expect.objectContaining({
        models: [{ instanceId: 'inst-new', modelName: 'CatBoost' }],
      }),
    );
  });
});
