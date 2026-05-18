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
import { ReactNode } from 'react';
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

vi.mock('@/services/extractionInstanceService', () => ({
  extractionInstanceService: {
    createHierarchy: vi.fn(),
    removeInstance: vi.fn(),
  },
}));

vi.mock('@/services/extractionValueService', () => ({
  ExtractionValueService: {
    findActiveRun: vi.fn(),
    saveValue: vi.fn(),
  },
}));

import { supabase } from '@/integrations/supabase/client';
import { extractionInstanceService } from '@/services/extractionInstanceService';
import { ExtractionValueService } from '@/services/extractionValueService';
import { useModelManagement } from '@/hooks/extraction/useModelManagement';

function mockEntityTypeFetch(fields: any[] = []) {
  // 1) supabase.from('extraction_entity_types').select('*').eq('id', X).single()
  //    → parent entity type
  // 2) supabase.from('extraction_entity_types').select('*').eq('parent_entity_type_id', X).order(...)
  //    → child entity types
  // 3) supabase.from('extraction_fields')... modelling_method lookup
  const parentChain: any = {
    select: vi.fn(() => parentChain),
    eq: vi.fn(() => parentChain),
    single: vi.fn(() =>
      Promise.resolve({ data: { id: 'pred-et', cardinality: 'many' }, error: null }),
    ),
  };
  const childrenChain: any = {
    select: vi.fn(() => childrenChain),
    eq: vi.fn(() => childrenChain),
    order: vi.fn(() => Promise.resolve({ data: [], error: null })),
  };
  const fieldsChain: any = {
    select: vi.fn(() => fieldsChain),
    eq: vi.fn(() => fieldsChain),
    single: vi.fn(() =>
      Promise.resolve({ data: fields[0] ?? null, error: fields[0] ? null : { code: 'PGRST116' } }),
    ),
  };
  (supabase.from as any)
    .mockReturnValueOnce(parentChain)
    .mockReturnValueOnce(childrenChain)
    .mockReturnValueOnce(fieldsChain);
}

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
    expect(extractionInstanceService.createHierarchy).not.toHaveBeenCalled();
  });

  it('delegates to extractionInstanceService.createHierarchy with trimmed label', async () => {
    mockLoadModelsToEmpty();
    mockEntityTypeFetch();
    (extractionInstanceService.createHierarchy as any).mockResolvedValue({
      parent: { id: 'parent-inst', label: 'LogReg' },
      children: [],
    });

    const { result } = renderHook(() => useModelManagement(baseProps));
    await act(async () => {
      await result.current.createModel('  LogReg  ', '');
    });

    expect(extractionInstanceService.createHierarchy).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'LogReg', userId: 'user-1' }),
    );
  });

  it('adds the new model to local state on success', async () => {
    mockLoadModelsToEmpty();
    mockEntityTypeFetch();
    (extractionInstanceService.createHierarchy as any).mockResolvedValue({
      parent: { id: 'parent-inst', label: 'XGBoost' },
      children: [],
    });

    const { result } = renderHook(() => useModelManagement(baseProps));
    await act(async () => {
      await result.current.createModel('XGBoost', '');
    });
    expect(result.current.models).toHaveLength(1);
    expect(result.current.models[0].modelName).toBe('XGBoost');
    expect(result.current.activeModelId).toBe('parent-inst');
  });

  it('skips modelling_method write when no active run exists yet', async () => {
    mockLoadModelsToEmpty();
    mockEntityTypeFetch([{ id: 'method-field' }]);
    (extractionInstanceService.createHierarchy as any).mockResolvedValue({
      parent: { id: 'inst-x', label: 'M' },
      children: [],
    });
    (ExtractionValueService.findActiveRun as any).mockResolvedValue(null);

    const { result } = renderHook(() => useModelManagement(baseProps));
    await act(async () => {
      await result.current.createModel('M', 'CART');
    });
    expect(ExtractionValueService.saveValue).not.toHaveBeenCalled();
  });

  it('persists modelling_method as a ReviewerDecision when active run is present', async () => {
    mockLoadModelsToEmpty();
    mockEntityTypeFetch([{ id: 'method-field' }]);
    (extractionInstanceService.createHierarchy as any).mockResolvedValue({
      parent: { id: 'inst-x', label: 'M' },
      children: [],
    });
    (ExtractionValueService.findActiveRun as any).mockResolvedValue({
      id: 'run-1',
      stage: 'review',
      status: 'running',
      template_id: 't-1',
    });
    (ExtractionValueService.saveValue as any).mockResolvedValue(undefined);

    const { result } = renderHook(() => useModelManagement(baseProps));
    await act(async () => {
      await result.current.createModel('M', 'Neural Net');
    });
    expect(ExtractionValueService.saveValue).toHaveBeenCalledWith(
      'run-1',
      'inst-x',
      'method-field',
      'Neural Net',
    );
  });

  it('does not throw when the modelling_method field does not exist on the template', async () => {
    mockLoadModelsToEmpty();
    mockEntityTypeFetch([]); // field lookup returns null
    (extractionInstanceService.createHierarchy as any).mockResolvedValue({
      parent: { id: 'inst-y', label: 'M' },
      children: [],
    });

    const { result } = renderHook(() => useModelManagement(baseProps));
    let outcome: any;
    await act(async () => {
      outcome = await result.current.createModel('M', 'method-x');
    });
    expect(outcome?.model.instanceId).toBe('inst-y');
    expect(ExtractionValueService.saveValue).not.toHaveBeenCalled();
  });

  it('swallows ReviewerDecision write errors so they do not abort model creation', async () => {
    mockLoadModelsToEmpty();
    mockEntityTypeFetch([{ id: 'method-field' }]);
    (extractionInstanceService.createHierarchy as any).mockResolvedValue({
      parent: { id: 'inst-z', label: 'M' },
      children: [],
    });
    (ExtractionValueService.findActiveRun as any).mockResolvedValue({
      id: 'run-1',
      stage: 'review',
      status: 'running',
      template_id: 't-1',
    });
    (ExtractionValueService.saveValue as any).mockRejectedValue(new Error('stage mismatch'));

    const { result } = renderHook(() => useModelManagement(baseProps));
    let outcome: any;
    await act(async () => {
      outcome = await result.current.createModel('M', 'method-x');
    });
    expect(outcome?.model.instanceId).toBe('inst-z');
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
