import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExtractionValueService } from '@/services/extractionValueService';

vi.mock('@/integrations/supabase/client', () => {
  const mock = { from: vi.fn() };
  return { supabase: mock };
});

vi.mock('@/integrations/api', () => ({
  apiClient: vi.fn(async () => ({})),
}));

import { supabase } from '@/integrations/supabase/client';
import { apiClient } from '@/integrations/api';

interface ChainCalls {
  table?: string;
  selects: string[];
  eqs: Array<[string, unknown]>;
  ins: Array<[string, unknown[]]>;
  neqs: Array<[string, unknown]>;
  orders: Array<[string, { ascending?: boolean } | undefined]>;
  limits: number[];
  maybeSingleCalled: boolean;
}

type AnyChain = Record<string, unknown> & {
  data: unknown;
  error: { message: string } | null;
  __calls: ChainCalls;
};

/**
 * Builds a chainable Supabase query mock that *records* every fluent
 * method call so tests can assert on the filters/ordering applied —
 * essential for catching kind/template/stage scoping regressions, the
 * source of the recent "decision posted to wrong run" bug.
 */
function chain(payload: { data: unknown; error?: { message: string } | null }): AnyChain {
  const result = { data: payload.data, error: payload.error ?? null };
  const calls: ChainCalls = {
    selects: [],
    eqs: [],
    ins: [],
    neqs: [],
    orders: [],
    limits: [],
    maybeSingleCalled: false,
  };
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
    neq: vi.fn((col: string, val: unknown) => {
      calls.neqs.push([col, val]);
      return c;
    }),
    order: vi.fn((col: string, opts?: { ascending?: boolean }) => {
      calls.orders.push([col, opts]);
      return c;
    }),
    limit: vi.fn((n: number) => {
      calls.limits.push(n);
      return c;
    }),
    maybeSingle: vi.fn(() => {
      calls.maybeSingleCalled = true;
      return Promise.resolve(result);
    }),
    then: (cb: (r: typeof result) => unknown) => Promise.resolve(cb(result)),
  };
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ExtractionValueService.findActiveRun', () => {
  it('returns null when no run exists', async () => {
    (supabase.from as any).mockReturnValueOnce(chain({ data: null }));
    const result = await ExtractionValueService.findActiveRun('article-1', 'tpl-1');
    expect(result).toBeNull();
  });

  it('returns the most recent non-finalized run', async () => {
    (supabase.from as any).mockReturnValueOnce(
      chain({
        data: {
          id: 'run-1',
          stage: 'review',
          status: 'running',
          template_id: 'tpl-1',
          created_at: '2026-04-28T10:00:00Z',
        },
      }),
    );
    const result = await ExtractionValueService.findActiveRun('article-1', 'tpl-1');
    expect(result).toEqual({
      id: 'run-1',
      stage: 'review',
      status: 'running',
      template_id: 'tpl-1',
    });
  });

  it("scopes the query to kind='extraction' so QA runs cannot leak in", async () => {
    const c = chain({ data: null });
    (supabase.from as any).mockReturnValueOnce(c);
    await ExtractionValueService.findActiveRun('article-1', 'tpl-1');
    expect(c.__calls.eqs).toContainEqual(['kind', 'extraction']);
  });

  it('restricts stages to pending/proposal/review/consensus', async () => {
    const c = chain({ data: null });
    (supabase.from as any).mockReturnValueOnce(c);
    await ExtractionValueService.findActiveRun('article-1', null);
    const stageFilter = c.__calls.ins.find(([col]) => col === 'stage');
    expect(stageFilter).toBeDefined();
    expect(new Set(stageFilter![1])).toEqual(
      new Set(['pending', 'proposal', 'review', 'consensus']),
    );
  });

  it('orders by created_at DESC and picks one row — the latest run wins', async () => {
    const c = chain({ data: null });
    (supabase.from as any).mockReturnValueOnce(c);
    await ExtractionValueService.findActiveRun('article-1', null);
    expect(c.__calls.orders).toContainEqual(['created_at', { ascending: false }]);
    expect(c.__calls.limits).toContain(1);
    expect(c.__calls.maybeSingleCalled).toBe(true);
  });

  it('applies template_id filter when provided', async () => {
    const c = chain({ data: null });
    (supabase.from as any).mockReturnValueOnce(c);
    await ExtractionValueService.findActiveRun('article-1', 'tpl-7');
    expect(c.__calls.eqs).toContainEqual(['template_id', 'tpl-7']);
  });

  it('does NOT apply template_id filter when null', async () => {
    const c = chain({ data: null });
    (supabase.from as any).mockReturnValueOnce(c);
    await ExtractionValueService.findActiveRun('article-1', null);
    expect(c.__calls.eqs.find(([col]) => col === 'template_id')).toBeUndefined();
  });

  it('throws APIError when Supabase reports an error', async () => {
    (supabase.from as any).mockReturnValueOnce(
      chain({ data: null, error: { message: 'boom' } }),
    );
    await expect(
      ExtractionValueService.findActiveRun('article-1', null),
    ).rejects.toThrow(/boom/);
  });
});

describe('ExtractionValueService.findLatestFinalizedRun', () => {
  it("scopes the query to kind='extraction' and stage='finalized'", async () => {
    const c = chain({ data: null });
    (supabase.from as any).mockReturnValueOnce(c);
    await ExtractionValueService.findLatestFinalizedRun('article-1', 'tpl-1');
    expect(c.__calls.eqs).toContainEqual(['kind', 'extraction']);
    expect(c.__calls.eqs).toContainEqual(['stage', 'finalized']);
    expect(c.__calls.eqs).toContainEqual(['template_id', 'tpl-1']);
    expect(c.__calls.orders).toContainEqual(['created_at', { ascending: false }]);
    expect(c.__calls.limits).toContain(1);
  });

  it('returns the row when one exists', async () => {
    (supabase.from as any).mockReturnValueOnce(
      chain({
        data: {
          id: 'run-final',
          stage: 'finalized',
          status: 'completed',
          template_id: 'tpl-1',
          created_at: '2026-04-28T10:00:00Z',
        },
      }),
    );
    const result = await ExtractionValueService.findLatestFinalizedRun(
      'article-1',
      'tpl-1',
    );
    expect(result).toEqual({
      id: 'run-final',
      stage: 'finalized',
      status: 'completed',
      template_id: 'tpl-1',
    });
  });

  it('returns null when no finalized run exists', async () => {
    (supabase.from as any).mockReturnValueOnce(chain({ data: null }));
    const result = await ExtractionValueService.findLatestFinalizedRun(
      'article-1',
      null,
    );
    expect(result).toBeNull();
  });

  it('throws APIError when Supabase reports an error', async () => {
    (supabase.from as any).mockReturnValueOnce(
      chain({ data: null, error: { message: 'fnz fail' } }),
    );
    await expect(
      ExtractionValueService.findLatestFinalizedRun('article-1', null),
    ).rejects.toThrow(/fnz fail/);
  });

  it('does NOT apply template_id filter when null', async () => {
    const c = chain({ data: null });
    (supabase.from as any).mockReturnValueOnce(c);
    await ExtractionValueService.findLatestFinalizedRun('article-1', null);
    expect(c.__calls.eqs.find(([col]) => col === 'template_id')).toBeUndefined();
  });
});

describe('ExtractionValueService.loadValuesForUser', () => {
  it('maps reviewer_states + decisions into DecisionValueRow entries', async () => {
    (supabase.from as any).mockReturnValueOnce(
      chain({
        data: [
          {
            run_id: 'run-1',
            reviewer_id: 'user-1',
            instance_id: 'inst-1',
            field_id: 'field-1',
            current_decision_id: 'dec-1',
            reviewer_decision: {
              decision: 'edit',
              value: { value: 42 },
              created_at: '2026-04-28T10:00:00Z',
            },
          },
          {
            run_id: 'run-1',
            reviewer_id: 'user-1',
            instance_id: 'inst-2',
            field_id: 'field-2',
            current_decision_id: null,
            reviewer_decision: null,
          },
        ],
      }),
    );
    const rows = await ExtractionValueService.loadValuesForUser('run-1', 'user-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      instanceId: 'inst-1',
      fieldId: 'field-1',
      value: 42,
      decision: 'edit',
      reviewerId: 'user-1',
    });
  });

  it('unwraps {value: X} JSONB on the way out', async () => {
    (supabase.from as any).mockReturnValueOnce(
      chain({
        data: [
          {
            run_id: 'run-1',
            reviewer_id: 'user-1',
            instance_id: 'inst-1',
            field_id: 'field-1',
            current_decision_id: 'dec-1',
            reviewer_decision: {
              decision: 'edit',
              value: { value: { value: 'nested', unit: 'mg' } },
              created_at: '2026-04-28T10:00:00Z',
            },
          },
        ],
      }),
    );
    const rows = await ExtractionValueService.loadValuesForUser('run-1', 'user-1');
    expect(rows[0].value).toEqual({ value: 'nested', unit: 'mg' });
  });

  it('keeps reject decisions in the returned rows (consumer filters them)', async () => {
    // The service is the source of truth for decision history; the
    // ``useExtractedValues`` consumer is responsible for skipping rejects
    // when populating the form. Don't filter at the service layer.
    (supabase.from as any).mockReturnValueOnce(
      chain({
        data: [
          {
            run_id: 'run-1',
            reviewer_id: 'user-1',
            instance_id: 'inst-1',
            field_id: 'field-1',
            current_decision_id: 'dec-1',
            reviewer_decision: {
              decision: 'reject',
              value: null,
              created_at: '2026-04-28T10:00:00Z',
            },
          },
        ],
      }),
    );
    const rows = await ExtractionValueService.loadValuesForUser('run-1', 'user-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].decision).toBe('reject');
  });

  it("scopes the query to (run_id, reviewer_id)", async () => {
    const c = chain({ data: [] });
    (supabase.from as any).mockReturnValueOnce(c);
    await ExtractionValueService.loadValuesForUser('run-1', 'user-1');
    expect(c.__calls.eqs).toContainEqual(['run_id', 'run-1']);
    expect(c.__calls.eqs).toContainEqual(['reviewer_id', 'user-1']);
  });

  it('throws APIError when Supabase reports an error', async () => {
    (supabase.from as any).mockReturnValueOnce(
      chain({ data: null, error: { message: 'states down' } }),
    );
    await expect(
      ExtractionValueService.loadValuesForUser('run-1', 'user-1'),
    ).rejects.toThrow(/states down/);
  });
});

describe('ExtractionValueService.loadValuesForOthers', () => {
  it('groups decisions by reviewer and skips null current_decision', async () => {
    (supabase.from as any).mockReturnValueOnce(
      chain({
        data: [
          {
            run_id: 'run-1',
            reviewer_id: 'user-2',
            instance_id: 'inst-1',
            field_id: 'field-1',
            current_decision_id: 'dec-2',
            reviewer_decision: {
              decision: 'edit',
              value: { value: 'A' },
              created_at: '2026-04-28T10:00:00Z',
            },
            reviewer: { id: 'user-2', full_name: 'Bob', avatar_url: null },
          },
          {
            run_id: 'run-1',
            reviewer_id: 'user-2',
            instance_id: 'inst-1',
            field_id: 'field-2',
            current_decision_id: 'dec-3',
            reviewer_decision: {
              decision: 'edit',
              value: { value: 'B' },
              created_at: '2026-04-28T11:00:00Z',
            },
            reviewer: { id: 'user-2', full_name: 'Bob', avatar_url: null },
          },
          {
            run_id: 'run-1',
            reviewer_id: 'user-3',
            instance_id: 'inst-1',
            field_id: 'field-1',
            current_decision_id: null,
            reviewer_decision: null,
            reviewer: { id: 'user-3', full_name: 'Carol', avatar_url: null },
          },
        ],
      }),
    );
    const result = await ExtractionValueService.loadValuesForOthers(
      'run-1',
      'user-1',
    );
    expect(result).toHaveLength(1);
    expect(result[0].reviewerName).toBe('Bob');
    expect(Object.keys(result[0].values)).toHaveLength(2);
    expect(result[0].values['inst-1_field-1']).toBe('A');
    expect(result[0].values['inst-1_field-2']).toBe('B');
    // Latest timestamp wins
    expect(result[0].latestDecidedAt).toBe('2026-04-28T11:00:00Z');
  });

  it("scopes the query to run_id and excludes the caller via neq('reviewer_id', currentReviewerId)", async () => {
    const c = chain({ data: [] });
    (supabase.from as any).mockReturnValueOnce(c);
    await ExtractionValueService.loadValuesForOthers('run-1', 'user-self');
    expect(c.__calls.eqs).toContainEqual(['run_id', 'run-1']);
    expect(c.__calls.neqs).toContainEqual(['reviewer_id', 'user-self']);
  });

  it('falls back to "User" when the reviewer profile is missing', async () => {
    (supabase.from as any).mockReturnValueOnce(
      chain({
        data: [
          {
            run_id: 'run-1',
            reviewer_id: 'user-x',
            instance_id: 'inst-1',
            field_id: 'field-1',
            current_decision_id: 'dec-x',
            reviewer_decision: {
              decision: 'edit',
              value: { value: 'V' },
              created_at: '2026-04-28T10:00:00Z',
            },
            reviewer: null,
          },
        ],
      }),
    );
    const result = await ExtractionValueService.loadValuesForOthers(
      'run-1',
      'user-self',
    );
    expect(result).toHaveLength(1);
    expect(result[0].reviewerName).toBe('User');
  });
});

describe('ExtractionValueService write paths', () => {
  it('saveValue posts an edit decision with wrapped value', async () => {
    await ExtractionValueService.saveValue('run-1', 'inst-1', 'field-1', 42);
    expect(apiClient).toHaveBeenCalledWith('/api/v1/runs/run-1/decisions', {
      method: 'POST',
      body: {
        instance_id: 'inst-1',
        field_id: 'field-1',
        decision: 'edit',
        value: { value: 42 },
        rationale: undefined,
      },
    });
  });

  it('saveValue forwards rationale when provided', async () => {
    await ExtractionValueService.saveValue('run-1', 'inst-1', 'field-1', null, 'because');
    const lastCall = (apiClient as any).mock.calls.at(-1);
    expect(lastCall[1].body.rationale).toBe('because');
    expect(lastCall[1].body.value).toEqual({ value: null });
  });

  it('acceptProposal posts decision=accept_proposal with proposal_record_id', async () => {
    await ExtractionValueService.acceptProposal(
      'run-1',
      'inst-1',
      'field-1',
      'proposal-1',
    );
    expect(apiClient).toHaveBeenCalledWith('/api/v1/runs/run-1/decisions', {
      method: 'POST',
      body: {
        instance_id: 'inst-1',
        field_id: 'field-1',
        decision: 'accept_proposal',
        proposal_record_id: 'proposal-1',
      },
    });
  });

  it('rejectValue posts a reject decision with no value', async () => {
    await ExtractionValueService.rejectValue('run-1', 'inst-1', 'field-1');
    expect(apiClient).toHaveBeenCalledWith('/api/v1/runs/run-1/decisions', {
      method: 'POST',
      body: {
        instance_id: 'inst-1',
        field_id: 'field-1',
        decision: 'reject',
      },
    });
  });

  it('writes always target the runId passed in (no implicit findActiveRun)', async () => {
    // Regression cover for the bug where an upstream layer was
    // re-resolving the active run via findActiveRun and silently
    // posting to a stale PENDING run. The service must not consult
    // ``findActiveRun`` — it must use what the caller hands it.
    (apiClient as any).mockClear();
    await ExtractionValueService.saveValue('explicit-run', 'inst-1', 'field-1', 1);
    await ExtractionValueService.acceptProposal(
      'explicit-run',
      'inst-1',
      'field-1',
      'p-1',
    );
    await ExtractionValueService.rejectValue('explicit-run', 'inst-1', 'field-1');
    for (const call of (apiClient as any).mock.calls) {
      expect(call[0]).toBe('/api/v1/runs/explicit-run/decisions');
    }
  });
});
