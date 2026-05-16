/**
 * Regression tests for ``queryEntityTypesWithFallback``.
 *
 * Covers bug #72: the helper silently fell back to the global-template
 * query whenever the project-template query returned a DB error
 * (RLS denial, network timeout), because the fallback gate only
 * checked ``!results`` and discarded ``error`` before re-throwing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => {
  const mock = { from: vi.fn() };
  return { supabase: mock };
});

import { supabase } from '@/integrations/supabase/client';
import { queryEntityTypesWithFallback } from '@/hooks/extraction/helpers/queryEntityTypes';

interface ChainCalls {
  selects: string[];
  eqs: Array<[string, unknown]>;
}

type AnyChain = Record<string, unknown> & {
  data: unknown;
  error: { message: string } | null;
  __calls: ChainCalls;
};

function chain(payload: { data: unknown; error?: { message: string } | null }): AnyChain {
  const result = { data: payload.data, error: payload.error ?? null };
  const calls: ChainCalls = { selects: [], eqs: [] };
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
    order: vi.fn(() => c),
    then: (cb: (r: typeof result) => unknown) => Promise.resolve(cb(result)),
  };
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('queryEntityTypesWithFallback', () => {
  it('throws when the project-template query returns an error (#72)', async () => {
    // First call (project_template_id) returns a DB error. Without the
    // fix this would silently fall back to the global query.
    const projectChain = chain({
      data: null,
      error: { message: 'permission denied for table extraction_entity_types' },
    });
    (supabase.from as any).mockReturnValueOnce(projectChain);

    await expect(
      queryEntityTypesWithFallback({
        templateId: 'tpl-1',
        select: 'id',
      }),
    ).rejects.toThrow(/permission denied/);
    // The fallback must NOT have fired — `from` was called exactly once.
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it('falls back to template_id only when the first query returns zero rows', async () => {
    const projectChain = chain({ data: [], error: null });
    const globalChain = chain({ data: [{ id: 'et-global' }], error: null });
    (supabase.from as any)
      .mockReturnValueOnce(projectChain)
      .mockReturnValueOnce(globalChain);

    const out = await queryEntityTypesWithFallback({
      templateId: 'tpl-1',
      select: 'id',
    });

    expect(out).toEqual([{ id: 'et-global' }]);
    expect(projectChain.__calls.eqs).toContainEqual([
      'project_template_id',
      'tpl-1',
    ]);
    expect(globalChain.__calls.eqs).toContainEqual(['template_id', 'tpl-1']);
  });

  it('returns project-template rows without firing the fallback when they exist', async () => {
    const projectChain = chain({
      data: [{ id: 'et-project' }],
      error: null,
    });
    (supabase.from as any).mockReturnValueOnce(projectChain);

    const out = await queryEntityTypesWithFallback({
      templateId: 'tpl-1',
      select: 'id',
    });

    expect(out).toEqual([{ id: 'et-project' }]);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
});
