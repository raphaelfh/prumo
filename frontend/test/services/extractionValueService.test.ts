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

type AnyChain = Record<string, unknown> & {
  data: unknown;
  error: { message: string } | null;
};

/**
 * Builds a chainable mock that supports `.select().eq().in().order().neq().limit().maybeSingle()`
 * and resolves to `{ data, error }` either via `.maybeSingle()` or by being awaited
 * directly (Supabase query builders are thenables).
 */
function chain(payload: { data: unknown; error?: { message: string } | null }): AnyChain {
  const result = { data: payload.data, error: payload.error ?? null };
  const c: AnyChain = {
    ...result,
    select: vi.fn(() => c),
    eq: vi.fn(() => c),
    in: vi.fn(() => c),
    order: vi.fn(() => c),
    neq: vi.fn(() => c),
    limit: vi.fn(() => c),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
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

  it('throws APIError when Supabase reports an error', async () => {
    (supabase.from as any).mockReturnValueOnce(
      chain({ data: null, error: { message: 'boom' } }),
    );
    await expect(
      ExtractionValueService.findActiveRun('article-1', null),
    ).rejects.toThrow(/boom/);
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
});
