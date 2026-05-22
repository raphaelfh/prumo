/**
 * Regression tests for ``useExtractionProgressCalc``.
 *
 * Covers:
 *  - #48 / #77: progress must scope reviewer_states by the active run_id
 *    so finalized/cancelled-run decisions don't leak into the current
 *    run's percentage.
 *  - #52: progress must dedupe completion by (instance_id, field_id),
 *    not by field_id alone, so multi-instance entity types report
 *    accurate completion.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => {
  const mock = { from: vi.fn() };
  return { supabase: mock };
});

vi.mock('@/services/extractionValueService', () => ({
  ExtractionValueService: {
    findActiveRun: vi.fn(),
    findLatestFinalizedRun: vi.fn(),
  },
}));

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

import { supabase } from '@/integrations/supabase/client';
import { ExtractionValueService } from '@/services/extractionValueService';
import { useExtractionProgressCalc } from '@/hooks/extraction/useExtractionProgressCalc';

interface ChainCalls {
  selects: string[];
  eqs: Array<[string, unknown]>;
  ins: Array<[string, unknown[]]>;
}

type AnyChain = Record<string, unknown> & {
  data: unknown;
  error: { message: string } | null;
  __calls: ChainCalls;
};

function chain(payload: { data: unknown; error?: { message: string } | null }): AnyChain {
  const result = { data: payload.data, error: payload.error ?? null };
  const calls: ChainCalls = { selects: [], eqs: [], ins: [] };
  const c: AnyChain = {
    ...result,
    __calls: calls,
    select: vi.fn((cols?: string) => {
      if (cols) calls.selects.push(cols);
      return c;
    }),
    eq: vi.fn((col: string, val: unknown) => {
      calls.eqs.push([col, val]);
      return c;
    }),
    in: vi.fn((col: string, vals: unknown[]) => {
      calls.ins.push([col, vals]);
      return c;
    }),
    then: (cb: (r: typeof result) => unknown) => Promise.resolve(cb(result)),
  };
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useExtractionProgressCalc', () => {
  it('scopes reviewer_states by the active run_id (#48/#77)', async () => {
    // Entity types
    (supabase.from as any).mockReturnValueOnce(
      chain({ data: [{ id: 'et-1' }] }),
    );
    // Fields
    (supabase.from as any).mockReturnValueOnce(
      chain({
        data: [{ id: 'f-1', is_required: true, entity_type_id: 'et-1' }],
      }),
    );
    // Instances
    (supabase.from as any).mockReturnValueOnce(
      chain({ data: [{ id: 'inst-1', entity_type_id: 'et-1' }] }),
    );
    (ExtractionValueService.findActiveRun as any).mockResolvedValueOnce({
      id: 'run-active',
      stage: 'review',
      status: 'running',
      template_id: 'tpl-1',
    });
    const statesChain = chain({ data: [] });
    (supabase.from as any).mockReturnValueOnce(statesChain);

    const { result } = renderHook(() => useExtractionProgressCalc());
    await act(async () => {
      await result.current.calculateProgress('art-1', 'tpl-1');
    });

    expect(statesChain.__calls.eqs).toContainEqual(['run_id', 'run-active']);
    expect(statesChain.__calls.ins).toContainEqual([
      'instance_id',
      ['inst-1'],
    ]);
  });

  it('dedupes by (instance_id, field_id) — not field_id alone (#52)', async () => {
    // Entity types
    (supabase.from as any).mockReturnValueOnce(
      chain({ data: [{ id: 'et-models' }] }),
    );
    // 2 required fields on the multi-instance entity type
    (supabase.from as any).mockReturnValueOnce(
      chain({
        data: [
          { id: 'f-type', is_required: true, entity_type_id: 'et-models' },
          { id: 'f-auc', is_required: true, entity_type_id: 'et-models' },
        ],
      }),
    );
    // 3 instances (e.g. Model 1, 2, 3)
    (supabase.from as any).mockReturnValueOnce(
      chain({
        data: [
          { id: 'inst-1', entity_type_id: 'et-models' },
          { id: 'inst-2', entity_type_id: 'et-models' },
          { id: 'inst-3', entity_type_id: 'et-models' },
        ],
      }),
    );
    (ExtractionValueService.findActiveRun as any).mockResolvedValueOnce({
      id: 'run-A',
      stage: 'review',
      status: 'running',
      template_id: 'tpl-1',
    });
    // Only Model 1 has values: both required fields decided. Models 2
    // and 3 have nothing.
    (supabase.from as any).mockReturnValueOnce(
      chain({
        data: [
          {
            instance_id: 'inst-1',
            field_id: 'f-type',
            current_decision_id: 'd-1',
            reviewer_decision: { decision: 'edit' },
          },
          {
            instance_id: 'inst-1',
            field_id: 'f-auc',
            current_decision_id: 'd-2',
            reviewer_decision: { decision: 'edit' },
          },
        ],
      }),
    );

    const { result } = renderHook(() => useExtractionProgressCalc());
    let progress: any = null;
    await act(async () => {
      progress = await result.current.calculateProgress('art-1', 'tpl-1');
    });
    // 3 instances × 2 required fields = 6 total pairs, only 2 filled.
    expect(progress).not.toBeNull();
    expect(progress.totalRequiredFields).toBe(6);
    expect(progress.completedRequiredFields).toBe(2);
    expect(progress.progressPercentage).toBeLessThan(100);
    expect(progress.progressPercentage).toBe(Math.round((2 / 6) * 100));
  });

  it('falls back to the latest finalized run when no active run exists', async () => {
    (supabase.from as any).mockReturnValueOnce(
      chain({ data: [{ id: 'et-1' }] }),
    );
    (supabase.from as any).mockReturnValueOnce(
      chain({
        data: [{ id: 'f-1', is_required: true, entity_type_id: 'et-1' }],
      }),
    );
    (supabase.from as any).mockReturnValueOnce(
      chain({ data: [{ id: 'inst-1', entity_type_id: 'et-1' }] }),
    );
    (ExtractionValueService.findActiveRun as any).mockResolvedValueOnce(null);
    (
      ExtractionValueService.findLatestFinalizedRun as any
    ).mockResolvedValueOnce({
      id: 'run-final',
      stage: 'finalized',
      status: 'completed',
      template_id: 'tpl-1',
    });
    const statesChain = chain({
      data: [
        {
          instance_id: 'inst-1',
          field_id: 'f-1',
          current_decision_id: 'd-1',
          reviewer_decision: { decision: 'edit' },
        },
      ],
    });
    (supabase.from as any).mockReturnValueOnce(statesChain);

    const { result } = renderHook(() => useExtractionProgressCalc());
    let progress: any = null;
    await act(async () => {
      progress = await result.current.calculateProgress('art-1', 'tpl-1');
    });
    expect(statesChain.__calls.eqs).toContainEqual(['run_id', 'run-final']);
    expect(progress.progressPercentage).toBe(100);
  });

  it('returns 0% when no run exists for the article', async () => {
    (supabase.from as any).mockReturnValueOnce(
      chain({ data: [{ id: 'et-1' }] }),
    );
    (supabase.from as any).mockReturnValueOnce(
      chain({
        data: [{ id: 'f-1', is_required: true, entity_type_id: 'et-1' }],
      }),
    );
    (supabase.from as any).mockReturnValueOnce(
      chain({ data: [{ id: 'inst-1', entity_type_id: 'et-1' }] }),
    );
    (ExtractionValueService.findActiveRun as any).mockResolvedValueOnce(null);
    (
      ExtractionValueService.findLatestFinalizedRun as any
    ).mockResolvedValueOnce(null);

    const { result } = renderHook(() => useExtractionProgressCalc());
    let progress: any = null;
    await act(async () => {
      progress = await result.current.calculateProgress('art-1', 'tpl-1');
    });
    expect(progress).not.toBeNull();
    expect(progress.completedRequiredFields).toBe(0);
    expect(progress.progressPercentage).toBe(0);
  });

  it('ignores reject decisions in the completion count', async () => {
    (supabase.from as any).mockReturnValueOnce(
      chain({ data: [{ id: 'et-1' }] }),
    );
    (supabase.from as any).mockReturnValueOnce(
      chain({
        data: [{ id: 'f-1', is_required: true, entity_type_id: 'et-1' }],
      }),
    );
    (supabase.from as any).mockReturnValueOnce(
      chain({ data: [{ id: 'inst-1', entity_type_id: 'et-1' }] }),
    );
    (ExtractionValueService.findActiveRun as any).mockResolvedValueOnce({
      id: 'run-A',
      stage: 'review',
      status: 'running',
      template_id: 'tpl-1',
    });
    (supabase.from as any).mockReturnValueOnce(
      chain({
        data: [
          {
            instance_id: 'inst-1',
            field_id: 'f-1',
            current_decision_id: 'd-1',
            reviewer_decision: { decision: 'reject' },
          },
        ],
      }),
    );

    const { result } = renderHook(() => useExtractionProgressCalc());
    let progress: any = null;
    await act(async () => {
      progress = await result.current.calculateProgress('art-1', 'tpl-1');
    });
    expect(progress.completedRequiredFields).toBe(0);
  });
});
