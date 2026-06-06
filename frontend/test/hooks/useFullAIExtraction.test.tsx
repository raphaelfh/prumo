/**
 * Regression tests for ``useFullAIExtraction`` toast behaviour (#102 / #159).
 *
 * The bug class these lock down: the hook owns every user-facing toast, and a
 * caller (ArticleExtractionTable) used to ALSO fire a success toast from
 * ``onSuccess``. Combined with the failure / no-models / partial paths calling
 * ``onSuccess`` for refresh, that produced contradictory "error + success" or
 * "warning + success" toast pairs. These tests assert the hook itself never
 * emits an unqualified success toast on a non-success outcome, and that
 * ``onSuccess`` (refresh) still fires on every terminal path.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  extractModels: vi.fn(),
  extractTopLevelSections: vi.fn(),
  extractAllSectionsForAllModels: vi.fn(),
  // Result of supabase fetchExtractedModels (.order(...) resolves to this).
  modelsResult: { data: [] as Array<{ id: string; label: string }>, error: null as unknown },
}));

vi.mock('@/hooks/extraction/useModelExtraction', () => ({
  useModelExtraction: () => ({ extractModels: h.extractModels }),
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
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => Promise.resolve(h.modelsResult),
          }),
        }),
      }),
    }),
  },
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

import { toast } from 'sonner';
import { useFullAIExtraction } from '@/hooks/extraction/useFullAIExtraction';

const PARAMS = { projectId: 'p1', articleId: 'a1', templateId: 't1' };

function setup() {
  const onSuccess = vi.fn(async () => undefined);
  const { result } = renderHook(() => useFullAIExtraction({ onSuccess }));
  return { onSuccess, result };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.extractModels.mockResolvedValue(undefined);
  h.extractTopLevelSections.mockResolvedValue({ totalSections: 2, successfulSections: 2 });
  h.extractAllSectionsForAllModels.mockResolvedValue(undefined);
  h.modelsResult = { data: [{ id: 'inst-1', label: 'Model 1' }], error: null };
});

afterEach(() => vi.restoreAllMocks());

describe('useFullAIExtraction toast contract', () => {
  it('full success: one success toast, no warning/error, refreshes', async () => {
    const { onSuccess, result } = setup();
    await act(async () => {
      await result.current.extractFullAI(PARAMS);
    });
    expect(toast.success).toHaveBeenCalledWith('fullAICompleteSuccessTitle', expect.anything());
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('models rejected: NO success toast, still refreshes (#102 false-success guard)', async () => {
    h.extractModels.mockRejectedValue(new Error('boom'));
    const { onSuccess, result } = setup();
    await act(async () => {
      await result.current.extractFullAI(PARAMS);
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('no models found: warning only, NO success toast, refreshes (#159)', async () => {
    h.modelsResult = { data: [], error: null };
    const { onSuccess, result } = setup();
    await act(async () => {
      await result.current.extractFullAI(PARAMS);
    });
    expect(toast.warning).toHaveBeenCalledWith('noModelsFoundTitle', expect.anything());
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('top-level sections rejected but models succeed: partial WARNING, not success', async () => {
    h.extractTopLevelSections.mockRejectedValue(new Error('study-level failed'));
    const { onSuccess, result } = setup();
    await act(async () => {
      await result.current.extractFullAI(PARAMS);
    });
    expect(toast.warning).toHaveBeenCalledWith('fullAIPartialTitle', expect.anything());
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
