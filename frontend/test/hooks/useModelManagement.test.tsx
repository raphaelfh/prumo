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

import { act, renderHook, waitFor } from '@testing-library/react';
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

const mockLoadModelInstances = vi.fn();
const mockFetchModelProgress = vi.fn();

vi.mock('@/services/extractionInstanceService', () => ({
  extractionInstanceService: {
    removeInstance: vi.fn(),
  },
  loadModelInstances: (...args: any[]) => mockLoadModelInstances(...args),
  fetchModelProgress: (...args: any[]) => mockFetchModelProgress(...args),
}));

import { supabase } from '@/integrations/supabase/client';
import { createManualModelHierarchy } from '@/integrations/api';
import { extractionInstanceService } from '@/services/extractionInstanceService';
import { useModelManagement } from '@/hooks/extraction/useModelManagement';

function mockLoadModelsToEmpty() {
  // useModelManagement fires loadModels() in a useEffect when enabled — mock
  // loadModelInstances from the service returning zero models.
  mockLoadModelInstances.mockResolvedValueOnce({ ok: true, data: [] });
}

/** Hand-resolvable promise for driving deterministic load-ordering races. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function modelRow(id: string, label: string) {
  return { id, label, sort_order: 0, created_at: '2026-01-01T00:00:00Z' };
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
  // hand the wrong chained return to a later mocked call.
  vi.resetAllMocks();
  // Default fetchModelProgress to zero progress (overridden per test as needed).
  mockFetchModelProgress.mockResolvedValue({ completed: 0, total: 0, percentage: 0 });
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
  // ``calculate_model_progress`` RPC. The RPC logic has moved to
  // ``fetchModelProgress`` in extractionInstanceService; the hook delegates
  // to it. These tests verify the delegation and the return-value contract.

  it('calls calculate_model_progress with (p_article_id, p_model_id), not the legacy (p_project_id, p_article_id)', async () => {
    mockLoadModelsToEmpty();
    mockFetchModelProgress.mockResolvedValue({ completed: 0, total: 0, percentage: 0 });

    const { result } = renderHook(() => useModelManagement(baseProps));
    await act(async () => {
      await result.current.getModelProgress('model-instance-1');
    });

    // fetchModelProgress is called with (articleId, instanceId) — maps to
    // (p_article_id, p_model_id) inside the service (tested in service tests).
    expect(mockFetchModelProgress).toHaveBeenCalledWith('a-1', 'model-instance-1');
    // Defensive: p_project_id must not appear in any call to rpc.
    const rpcCalls = (supabase.rpc as any).mock?.calls ?? [];
    for (const call of rpcCalls) {
      expect(call[1]).not.toHaveProperty('p_project_id');
    }
  });

  it('maps the new return shape (completed_fields, total_fields, percentage) to Model.progress', async () => {
    mockLoadModelsToEmpty();
    mockFetchModelProgress.mockResolvedValue({ completed: 7, total: 10, percentage: 70 });

    const { result } = renderHook(() => useModelManagement(baseProps));
    let progress: any;
    await act(async () => {
      progress = await result.current.getModelProgress('model-instance-1');
    });

    expect(progress).toEqual({ completed: 7, total: 10, percentage: 70 });
  });

  it('returns zeros when the RPC errors (e.g. 404, RLS) instead of throwing', async () => {
    mockLoadModelsToEmpty();
    // fetchModelProgress always returns zeros on error (never throws) — see service impl.
    mockFetchModelProgress.mockResolvedValue({ completed: 0, total: 0, percentage: 0 });

    const { result } = renderHook(() => useModelManagement(baseProps));
    let progress: any;
    await act(async () => {
      progress = await result.current.getModelProgress('model-instance-1');
    });

    expect(progress).toEqual({ completed: 0, total: 0, percentage: 0 });
  });

  it('returns zeros when the RPC returns an empty result', async () => {
    mockLoadModelsToEmpty();
    mockFetchModelProgress.mockResolvedValue({ completed: 0, total: 0, percentage: 0 });

    const { result } = renderHook(() => useModelManagement(baseProps));
    let progress: any;
    await act(async () => {
      progress = await result.current.getModelProgress('model-instance-1');
    });

    expect(progress).toEqual({ completed: 0, total: 0, percentage: 0 });
  });
});

describe('useModelManagement → modelInstances prop (view-sourced)', () => {
  // When the run-open page supplies the model-container instances derived
  // from the server RunView, the hook must use them directly and NOT issue
  // the ``loadModelInstances`` Supabase read. The progress RPC loop is
  // still exercised per model.

  it('derives models from the prop and skips loadModelInstances entirely', async () => {
    // No mockLoadModelsToEmpty() — assert it is never called.
    mockFetchModelProgress.mockResolvedValue({ completed: 2, total: 4, percentage: 50 });

    const { result } = renderHook(() =>
      useModelManagement({
        ...baseProps,
        modelInstances: [
          { id: 'm-1', label: 'LogReg', sort_order: 0, created_at: '2026-01-01T00:00:00Z' },
          { id: 'm-2', label: 'XGBoost', sort_order: 1, created_at: '2026-01-02T00:00:00Z' },
        ],
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockLoadModelInstances).not.toHaveBeenCalled();
    expect(result.current.models.map((m) => m.modelName)).toEqual(['LogReg', 'XGBoost']);
    // Progress RPC still runs per supplied model.
    expect(mockFetchModelProgress).toHaveBeenCalledWith('a-1', 'm-1');
    expect(mockFetchModelProgress).toHaveBeenCalledWith('a-1', 'm-2');
  });

  it('renders zero models from an empty prop without touching the service', async () => {
    const { result } = renderHook(() =>
      useModelManagement({ ...baseProps, modelInstances: [] }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockLoadModelInstances).not.toHaveBeenCalled();
    expect(result.current.models).toHaveLength(0);
    expect(result.current.activeModelId).toBeNull();
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

describe('useModelManagement → overlapping load staleness (prod flapping 2026-07-05)', () => {
  // The mount-load effect re-fires on every articleId / entity-type /
  // modelInstancesSig change, and loadModels() has two async gaps
  // (loadModelInstances + the per-model progress fan-out). Without a
  // generation guard, whichever load RESOLVES last wins — so a slow load
  // for a no-longer-current article can overwrite the current article's
  // models. Prod logs showed this as "Encontradas 1 → 0 → 1" for one
  // article while another article's loads interleaved. These tests pin
  // the invariant: a resolved load for a superseded (article, entity-type)
  // must never commit its result.

  it('drops a stale article load that resolves AFTER navigation to another article', async () => {
    const first = deferred<{ ok: true; data: any[] }>();
    const second = deferred<{ ok: true; data: any[] }>();
    mockLoadModelInstances.mockImplementation((articleId: string) => {
      if (articleId === 'a-1') return first.promise;
      if (articleId === 'a-2') return second.promise;
      return Promise.resolve({ ok: true, data: [] });
    });

    const { result, rerender } = renderHook(
      (props: typeof baseProps) => useModelManagement(props),
      { initialProps: { ...baseProps, articleId: 'a-1' } },
    );

    // Navigate to a-2 while a-1's load is still in flight (pager next).
    rerender({ ...baseProps, articleId: 'a-2' });

    // The current article (a-2) resolves first with its own model.
    await act(async () => {
      second.resolve({ ok: true, data: [modelRow('m-2', 'XGBoost')] });
    });
    await waitFor(() =>
      expect(result.current.models.map((m) => m.modelName)).toEqual(['XGBoost']),
    );

    // The stale a-1 load now resolves LAST with a different model set.
    await act(async () => {
      first.resolve({ ok: true, data: [modelRow('m-1', 'LogReg')] });
      await Promise.resolve();
    });

    // It must NOT overwrite the current article's state.
    expect(result.current.models.map((m) => m.modelName)).toEqual(['XGBoost']);
    expect(result.current.activeModelId).toBe('m-2');
    expect(result.current.loading).toBe(false);
  });

  it('drops a stale FAILED load so it cannot clobber the current article with an error', async () => {
    const first = deferred<{ ok: false; error: { message: string } }>();
    const second = deferred<{ ok: true; data: any[] }>();
    mockLoadModelInstances.mockImplementation((articleId: string) => {
      if (articleId === 'a-1') return first.promise;
      if (articleId === 'a-2') return second.promise;
      return Promise.resolve({ ok: true, data: [] });
    });

    const { result, rerender } = renderHook(
      (props: typeof baseProps) => useModelManagement(props),
      { initialProps: { ...baseProps, articleId: 'a-1' } },
    );
    rerender({ ...baseProps, articleId: 'a-2' });

    await act(async () => {
      second.resolve({ ok: true, data: [modelRow('m-2', 'XGBoost')] });
    });
    await waitFor(() =>
      expect(result.current.models.map((m) => m.modelName)).toEqual(['XGBoost']),
    );

    // Stale a-1 load fails after a-2 already succeeded.
    await act(async () => {
      first.resolve({ ok: false, error: { message: 'rls denied' } });
      await Promise.resolve();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.models.map((m) => m.modelName)).toEqual(['XGBoost']);
  });

  it('drops a stale modelInstances-prop load superseded DURING the progress fan-out', async () => {
    // The run-open page (the actual prod surface for the 2026-07-05 flap)
    // supplies modelInstances from the server RunView, so loadModels takes
    // the prop branch — there is NO loadModelInstances read, and the ONLY
    // async gap is the per-model progress fan-out. This pins the second
    // guard (the isStale re-check after Promise.all): a load superseded
    // while its progress is resolving must not commit its models.
    const p1 = deferred<{ completed: number; total: number; percentage: number }>();
    const p2 = deferred<{ completed: number; total: number; percentage: number }>();
    mockFetchModelProgress.mockImplementation((_articleId: string, instanceId: string) => {
      if (instanceId === 'm-1') return p1.promise;
      if (instanceId === 'm-2') return p2.promise;
      return Promise.resolve({ completed: 0, total: 0, percentage: 0 });
    });

    const { result, rerender } = renderHook(
      (props: typeof baseProps & { modelInstances: any[] }) => useModelManagement(props),
      { initialProps: { ...baseProps, modelInstances: [modelRow('m-1', 'LogReg')] } },
    );

    // A newer view arrives (modelInstancesSig changes) before the first
    // load's progress resolves.
    rerender({ ...baseProps, modelInstances: [modelRow('m-2', 'XGBoost')] });

    // Current view (m-2) progress resolves first → commits [XGBoost].
    await act(async () => {
      p2.resolve({ completed: 1, total: 2, percentage: 50 });
    });
    await waitFor(() =>
      expect(result.current.models.map((m) => m.modelName)).toEqual(['XGBoost']),
    );

    // The stale first load's progress resolves LAST — must not clobber.
    await act(async () => {
      p1.resolve({ completed: 0, total: 2, percentage: 0 });
      await Promise.resolve();
    });

    expect(result.current.models.map((m) => m.modelName)).toEqual(['XGBoost']);
    expect(result.current.activeModelId).toBe('m-2');
    expect(mockLoadModelInstances).not.toHaveBeenCalled();
  });
});

describe('useModelManagement → optimistic mutation vs in-flight load', () => {
  // createModel / removeModel write state OPTIMISTICALLY. A refresh load
  // started BEFORE the mutation carries a pre-mutation instances snapshot;
  // when its progress fan-out resolves it must NOT clobber the mutation's
  // result (drop a just-created model, or resurrect a just-removed one).
  // The generation guard only protects loads superseded by a newer LOAD —
  // a mutation must also claim the next generation to supersede older
  // in-flight loads.

  it('does not let an in-flight refresh drop a model created during its progress fan-out', async () => {
    // Steady state: one model Alpha already loaded.
    mockLoadModelInstances.mockResolvedValue({ ok: true, data: [modelRow('m-A', 'Alpha')] });
    mockFetchModelProgress.mockResolvedValueOnce({ completed: 0, total: 0, percentage: 0 });

    const { result } = renderHook(() => useModelManagement(baseProps));
    await waitFor(() =>
      expect(result.current.models.map((m) => m.modelName)).toEqual(['Alpha']),
    );
    expect(result.current.activeModelId).toBe('m-A');

    // Start a refresh that parks in the progress fan-out (snapshot = [Alpha]).
    const progress = deferred<{ completed: number; total: number; percentage: number }>();
    mockFetchModelProgress.mockReturnValueOnce(progress.promise);
    await act(async () => {
      void result.current.refreshModels();
    });
    await waitFor(() => expect(mockFetchModelProgress).toHaveBeenCalledTimes(2));

    // While the refresh is parked, the user creates Beta.
    (createManualModelHierarchy as any).mockResolvedValue({
      model_id: 'm-B',
      model_label: 'Beta',
      child_instances: [],
    });
    await act(async () => {
      await result.current.createModel('Beta', '');
    });
    expect(result.current.models.map((m) => m.modelName)).toEqual(['Alpha', 'Beta']);
    expect(result.current.activeModelId).toBe('m-B');

    // The refresh's progress resolves LAST with its pre-create snapshot.
    await act(async () => {
      progress.resolve({ completed: 0, total: 0, percentage: 0 });
      await Promise.resolve();
    });

    // Beta must survive; the stale refresh must not reset the active model.
    expect(result.current.models.map((m) => m.modelName)).toEqual(['Alpha', 'Beta']);
    expect(result.current.activeModelId).toBe('m-B');
  });

  it('does not let an in-flight refresh resurrect a model removed during its progress fan-out', async () => {
    mockLoadModelInstances.mockResolvedValue({ ok: true, data: [modelRow('m-A', 'Alpha')] });
    mockFetchModelProgress.mockResolvedValueOnce({ completed: 0, total: 0, percentage: 0 });

    const { result } = renderHook(() => useModelManagement(baseProps));
    await waitFor(() =>
      expect(result.current.models.map((m) => m.modelName)).toEqual(['Alpha']),
    );

    // Refresh parks in the fan-out with snapshot = [Alpha].
    const progress = deferred<{ completed: number; total: number; percentage: number }>();
    mockFetchModelProgress.mockReturnValueOnce(progress.promise);
    await act(async () => {
      void result.current.refreshModels();
    });
    await waitFor(() => expect(mockFetchModelProgress).toHaveBeenCalledTimes(2));

    // User removes Alpha while the refresh is parked.
    (extractionInstanceService.removeInstance as any).mockResolvedValue(true);
    await act(async () => {
      await result.current.removeModel('m-A');
    });
    expect(result.current.models).toHaveLength(0);
    expect(result.current.activeModelId).toBeNull();

    // The refresh's stale snapshot resolves LAST — must not bring Alpha back.
    await act(async () => {
      progress.resolve({ completed: 0, total: 0, percentage: 0 });
      await Promise.resolve();
    });

    expect(result.current.models).toHaveLength(0);
    expect(result.current.activeModelId).toBeNull();
  });
});
