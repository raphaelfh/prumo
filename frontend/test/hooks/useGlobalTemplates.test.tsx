/**
 * Regression tests for ``useGlobalTemplates``.
 *
 * Covers bug #75: the entity-type count was loaded via one Supabase
 * query per template (N+1), and each per-template query silently
 * dropped its error so a permission denial rendered every template as
 * "0 sections". The fix batches into a single query and surfaces
 * errors via the hook's `error` state.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => {
  const mock = { from: vi.fn() };
  return { supabase: mock };
});

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

import { supabase } from '@/integrations/supabase/client';
import { useGlobalTemplates } from '@/hooks/extraction/useGlobalTemplates';

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
    order: vi.fn(() => c),
    then: (cb: (r: typeof result) => unknown) => Promise.resolve(cb(result)),
  };
  return c;
}

const SAMPLE_TEMPLATES = [
  {
    id: 'tpl-1',
    name: 'CHARMS',
    framework: 'CHARMS',
    description: '',
    version: 1,
    is_global: true,
    schema: {},
    created_at: '',
    updated_at: '',
  },
  {
    id: 'tpl-2',
    name: 'PICOS',
    framework: 'PICOS',
    description: '',
    version: 1,
    is_global: true,
    schema: {},
    created_at: '',
    updated_at: '',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useGlobalTemplates', () => {
  it('fetches counts in a single batched query, not N+1 (#75)', async () => {
    const templatesChain = chain({ data: SAMPLE_TEMPLATES });
    const countsChain = chain({
      data: [
        { template_id: 'tpl-1' },
        { template_id: 'tpl-1' },
        { template_id: 'tpl-1' },
        { template_id: 'tpl-2' },
      ],
    });
    (supabase.from as any)
      .mockReturnValueOnce(templatesChain)
      .mockReturnValueOnce(countsChain);

    const { result } = renderHook(() => useGlobalTemplates());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Exactly two queries (templates + counts), regardless of how many
    // templates are returned. The fan-out N+1 pattern would call
    // `from('extraction_entity_types')` once per template.
    expect(supabase.from).toHaveBeenCalledTimes(2);
    expect(countsChain.__calls.ins).toContainEqual([
      'template_id',
      ['tpl-1', 'tpl-2'],
    ]);
    expect(result.current.templates).toHaveLength(2);
    expect(
      result.current.templates.find((t) => t.id === 'tpl-1')?.entityTypesCount,
    ).toBe(3);
    expect(
      result.current.templates.find((t) => t.id === 'tpl-2')?.entityTypesCount,
    ).toBe(1);
  });

  it('surfaces count-query errors via the error state (#75)', async () => {
    const templatesChain = chain({ data: SAMPLE_TEMPLATES });
    const countsChain = chain({
      data: null,
      error: { message: 'permission denied for extraction_entity_types' },
    });
    (supabase.from as any)
      .mockReturnValueOnce(templatesChain)
      .mockReturnValueOnce(countsChain);

    const { result } = renderHook(() => useGlobalTemplates());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toMatch(/permission denied/);
    expect(result.current.templates).toEqual([]);
  });
});
