/**
 * Edge-case tests for ``useModelManagement.createModel``.
 *
 * The happy path (full hierarchy creation) is covered indirectly via
 * the playwright extraction flow. These tests pin the awkward corners:
 *
 *  - createModel without auth / parent entity type → graceful no-op.
 *  - modellingMethod write skipped silently when no active run yet.
 *  - modellingMethod field absent on the template (custom CHARMS) →
 *    skip write, do NOT throw.
 *  - createModel must update local state with the freshly-created
 *    instance so the form can render the new model right away.
 *  - removeModel returns void / throws on error so the dialog can
 *    surface failure to the user.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/integrations/supabase/client', () => {
  const mock = { from: vi.fn(), rpc: vi.fn() };
  return { supabase: mock };
});

vi.mock('@/integrations/api', () => ({
  createManualModelHierarchy: vi.fn(),
}));

vi.mock('@/services/extractionInstanceService', () => ({
  extractionInstanceService: {
    removeInstance: vi.fn(),
  },
}));

import { supabase } from '@/integrations/supabase/client';
import { createManualModelHierarchy } from '@/integrations/api';
import { extractionInstanceService } from '@/services/extractionInstanceService';
import { useModelManagement } from '@/hooks/extraction/useModelManagement';

function mockLoadModelsToEmpty() {
  // useModelManagement fires loadModels() in a useEffect when enabled — mock
  // a supabase.from('extraction_instances')... chain returning zero models.
  const loadChain: any = {
    select: vi.fn(() => loadChain),
    eq: vi.fn(() => loadChain),
    order: vi.fn(() => Promise.resolve({ data: [], error: null })),
  };
  (supabase.from as any).mockReturnValueOnce(loadChain);
}

const baseProps = {
  projectId: 'p-1',
  articleId: 'a-1',
  templateId: 't-1',
  modelParentEntityTypeId: 'pred-et',
  enabled: true,
};

beforeEach(() => {
  // Use resetAllMocks (not clearAllMocks) so the per-test
  // ``mockReturnValueOnce`` queues from prior tests don't bleed in and
  // hand the wrong chain to a later supabase.from() call.
  vi.resetAllMocks();
});

describe('useModelManagement → createModel guard rails', () => {
  // The hook delegates the full hierarchy creation (parent +
  // sub-section children + modelling_method persistence) to the backend
  // endpoint ``POST /api/v1/extraction/models/manual`` exposed via
  // ``createManualModelHierarchy``. Persisting modelling_method is no
  // longer a frontend concern — the backend writes it inside the same
  // transaction.

  it('returns null and toasts when modelParentEntityTypeId is missing', async () => {
    mockLoadModelsToEmpty();
    const { result } = renderHook(() =>
      useModelManagement({ ...baseProps, modelParentEntityTypeId: null }),
    );
    let outcome: any;
    await act(async () => {
      outcome = await result.current.createModel('Whatever', '');
    });
    expect(outcome).toBeNull();
    expect(createManualModelHierarchy).not.toHaveBeenCalled();
  });

  it('delegates to createManualModelHierarchy with trimmed model_name + scoped ids', async () => {
    mockLoadModelsToEmpty();
    (createManualModelHierarchy as any).mockResolvedValue({
      model_id: 'parent-inst',
      model_label: 'LogReg',
      child_instances: [],
    });

    const { result } = renderHook(() => useModelManagement(baseProps));
    await act(async () => {
      await result.current.createModel('  LogReg  ', '');
    });

    expect(createManualModelHierarchy).toHaveBeenCalledWith({
      project_id: 'p-1',
      article_id: 'a-1',
      template_id: 't-1',
      model_name: 'LogReg',
      modelling_method: null,
    });
  });

  it('forwards modelling_method to the backend (no client-side ReviewerDecision write)', async () => {
    mockLoadModelsToEmpty();
    (createManualModelHierarchy as any).mockResolvedValue({
      model_id: 'inst-x',
      model_label: 'M',
      child_instances: [],
    });

    const { result } = renderHook(() => useModelManagement(baseProps));
    await act(async () => {
      await result.current.createModel('M', 'Neural Net');
    });

    expect(createManualModelHierarchy).toHaveBeenCalledWith(
      expect.objectContaining({ modelling_method: 'Neural Net' }),
    );
    // The hook must not bypass the backend by writing the method as a
    // ReviewerDecision from the client.
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      expect.stringMatching(/save_value|reviewer_decision/i),
      expect.anything(),
    );
  });

  it('adds the new model to local state on success and maps child_instances', async () => {
    mockLoadModelsToEmpty();
    (createManualModelHierarchy as any).mockResolvedValue({
      model_id: 'parent-inst',
      model_label: 'XGBoost',
      child_instances: [
        {
          id: 'child-1',
          entity_type_id: 'et-section-1',
          parent_instance_id: 'parent-inst',
          label: 'Performance',
        },
      ],
    });

    const { result } = renderHook(() => useModelManagement(baseProps));
    let outcome: any;
    await act(async () => {
      outcome = await result.current.createModel('XGBoost', '');
    });

    expect(result.current.models).toHaveLength(1);
    expect(result.current.models[0].modelName).toBe('XGBoost');
    expect(result.current.activeModelId).toBe('parent-inst');
    expect(outcome?.childInstances).toEqual([
      {
        id: 'child-1',
        entityTypeId: 'et-section-1',
        parentInstanceId: 'parent-inst',
        label: 'Performance',
      },
    ]);
  });

  it('returns null and toasts when the backend call fails (does not throw)', async () => {
    mockLoadModelsToEmpty();
    (createManualModelHierarchy as any).mockRejectedValue(new Error('rls denied'));

    const { result } = renderHook(() => useModelManagement(baseProps));
    let outcome: any;
    await act(async () => {
      outcome = await result.current.createModel('Foo', '');
    });

    expect(outcome).toBeNull();
    // State must stay clean — no half-created model.
    expect(result.current.models).toHaveLength(0);
  });
});

describe('useModelManagement → getModelProgress (RPC contract)', () => {
  // Locks the frontend ↔ Supabase contract for the
  // ``calculate_model_progress`` RPC. The remote function signature was
  // rewritten in alembic migration 0013 from
  // ``(p_project_id, p_article_id)`` returning one-row-per-instance to
  // ``(p_article_id, p_model_id)`` returning a single
  // ``(completed_fields, total_fields, percentage)`` row.
  //
  // Passing the legacy parameter names yields PostgREST 404 PGRST202 and
  // the UI silently falls back to "0%" progress badges — these tests
  // make that drift impossible to ship.

  it('calls calculate_model_progress with (p_article_id, p_model_id), not the legacy (p_project_id, p_article_id)', async () => {
    mockLoadModelsToEmpty();
    (supabase.rpc as any).mockResolvedValue({
      data: [{ completed_fields: 0, total_fields: 0, percentage: 0 }],
      error: null,
    });

    const { result } = renderHook(() => useModelManagement(baseProps));
    await act(async () => {
      await result.current.getModelProgress('model-instance-1');
    });

    expect(supabase.rpc).toHaveBeenCalledWith('calculate_model_progress', {
      p_article_id: 'a-1',
      p_model_id: 'model-instance-1',
    });
    // Defensive: legacy keys must not leak back in.
    const callArgs = (supabase.rpc as any).mock.calls[0][1];
    expect(callArgs).not.toHaveProperty('p_project_id');
  });

  it('maps the new return shape (completed_fields, total_fields, percentage) to Model.progress', async () => {
    mockLoadModelsToEmpty();
    (supabase.rpc as any).mockResolvedValue({
      data: [{ completed_fields: 7, total_fields: 10, percentage: 70 }],
      error: null,
    });

    const { result } = renderHook(() => useModelManagement(baseProps));
    let progress: any;
    await act(async () => {
      progress = await result.current.getModelProgress('model-instance-1');
    });

    expect(progress).toEqual({ completed: 7, total: 10, percentage: 70 });
  });

  it('returns zeros when the RPC errors (e.g. 404, RLS) instead of throwing', async () => {
    mockLoadModelsToEmpty();
    (supabase.rpc as any).mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'function not found' },
    });

    const { result } = renderHook(() => useModelManagement(baseProps));
    let progress: any;
    await act(async () => {
      progress = await result.current.getModelProgress('model-instance-1');
    });

    expect(progress).toEqual({ completed: 0, total: 0, percentage: 0 });
  });

  it('returns zeros when the RPC returns an empty result', async () => {
    mockLoadModelsToEmpty();
    (supabase.rpc as any).mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useModelManagement(baseProps));
    let progress: any;
    await act(async () => {
      progress = await result.current.getModelProgress('model-instance-1');
    });

    expect(progress).toEqual({ completed: 0, total: 0, percentage: 0 });
  });
});

describe('useModelManagement → removeModel', () => {
  it('delegates to extractionInstanceService.removeInstance', async () => {
    mockLoadModelsToEmpty();
    (extractionInstanceService.removeInstance as any).mockResolvedValue(true);

    const { result } = renderHook(() => useModelManagement(baseProps));
    await act(async () => {
      await result.current.removeModel('inst-to-remove');
    });
    expect(extractionInstanceService.removeInstance).toHaveBeenCalledWith('inst-to-remove');
  });

  it('rethrows errors so the dialog can surface them', async () => {
    mockLoadModelsToEmpty();
    (extractionInstanceService.removeInstance as any).mockRejectedValue(new Error('rls'));

    const { result } = renderHook(() => useModelManagement(baseProps));
    await expect(
      act(async () => {
        await result.current.removeModel('inst-x');
      }),
    ).rejects.toThrow('rls');
  });
});
