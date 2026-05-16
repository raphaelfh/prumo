import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => {
  const mock = { from: vi.fn(), auth: { getUser: vi.fn() } };
  return { supabase: mock };
});

vi.mock('@/services/extractionValueService', () => ({
  ExtractionValueService: {
    findActiveRun: vi.fn(),
    acceptProposal: vi.fn(async () => undefined),
    rejectValue: vi.fn(async () => undefined),
  },
}));

import { AISuggestionService } from '@/services/aiSuggestionService';
import { ExtractionValueService } from '@/services/extractionValueService';
import { supabase } from '@/integrations/supabase/client';

interface ChainCalls {
  selects: string[];
  eqs: Array<[string, unknown]>;
  ins: Array<[string, unknown[]]>;
  nots: Array<[string, string, unknown]>;
  orders: Array<[string, { ascending?: boolean } | undefined]>;
  limits: number[];
}

type AnyChain = Record<string, unknown> & {
  data: unknown;
  error: { message: string } | null;
  __calls: ChainCalls;
};

function chain(payload: { data: unknown; error?: { message: string } | null }): AnyChain {
  const result = { data: payload.data, error: payload.error ?? null };
  const calls: ChainCalls = {
    selects: [],
    eqs: [],
    ins: [],
    nots: [],
    orders: [],
    limits: [],
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
    not: vi.fn((col: string, op: string, val: unknown) => {
      calls.nots.push([col, op, val]);
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
    then: (cb: (r: typeof result) => unknown) => Promise.resolve(cb(result)),
  };
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AISuggestionService.acceptSuggestion', () => {
  it('uses the provided runId without calling findActiveRun', async () => {
    await AISuggestionService.acceptSuggestion({
      suggestionId: 'proposal-1',
      projectId: 'proj-1',
      articleId: 'art-1',
      instanceId: 'inst-1',
      fieldId: 'field-1',
      value: 'X',
      confidence: 0.9,
      reviewerId: 'user-1',
      runId: 'run-explicit',
    });
    expect(ExtractionValueService.findActiveRun).not.toHaveBeenCalled();
    expect(ExtractionValueService.acceptProposal).toHaveBeenCalledWith(
      'run-explicit',
      'inst-1',
      'field-1',
      'proposal-1',
    );
  });

  it('falls back to findActiveRun when no runId is supplied', async () => {
    (ExtractionValueService.findActiveRun as any).mockResolvedValueOnce({
      id: 'run-fallback',
      stage: 'review',
      status: 'running',
      template_id: 'tpl-1',
    });
    await AISuggestionService.acceptSuggestion({
      suggestionId: 'proposal-1',
      projectId: 'proj-1',
      articleId: 'art-1',
      instanceId: 'inst-1',
      fieldId: 'field-1',
      value: 'X',
      confidence: 0.9,
      reviewerId: 'user-1',
    });
    expect(ExtractionValueService.findActiveRun).toHaveBeenCalledWith(
      'art-1',
      null,
    );
    expect(ExtractionValueService.acceptProposal).toHaveBeenCalledWith(
      'run-fallback',
      'inst-1',
      'field-1',
      'proposal-1',
    );
  });
});

describe('AISuggestionService.loadSuggestions', () => {
  it('short-circuits to empty when instanceIds is empty (no Supabase call)', async () => {
    const result = await AISuggestionService.loadSuggestions('art-1', []);
    expect(result).toEqual({ suggestions: {}, count: 0 });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("filters proposals by source='ai', orders by created_at desc, scopes by instance_id", async () => {
    const proposalsChain = chain({ data: [] });
    (supabase.from as any).mockReturnValueOnce(proposalsChain);
    (supabase.auth.getUser as any).mockResolvedValueOnce({ data: { user: null } });

    await AISuggestionService.loadSuggestions('art-1', ['inst-1', 'inst-2']);

    expect(proposalsChain.__calls.eqs).toContainEqual(['source', 'ai']);
    expect(proposalsChain.__calls.ins).toContainEqual([
      'instance_id',
      ['inst-1', 'inst-2'],
    ]);
    expect(proposalsChain.__calls.orders).toContainEqual([
      'created_at',
      { ascending: false },
    ]);
  });

  it('scopes proposals AND reviewer_states by run_id when one is provided', async () => {
    const proposalsChain = chain({
      data: [
        {
          id: 'p-1',
          run_id: 'run-A',
          instance_id: 'inst-1',
          field_id: 'f-1',
          source: 'ai',
          proposed_value: { value: 'X' },
          confidence_score: 0.8,
          rationale: null,
          created_at: '2026-04-28T10:00:00Z',
        },
      ],
    });
    const evidenceChain = chain({ data: [] });
    const statesChain = chain({ data: [] });
    (supabase.from as any)
      .mockReturnValueOnce(proposalsChain)
      .mockReturnValueOnce(evidenceChain)
      .mockReturnValueOnce(statesChain);
    (supabase.auth.getUser as any).mockResolvedValueOnce({
      data: { user: { id: 'user-1' } },
    });

    await AISuggestionService.loadSuggestions('art-1', ['inst-1'], 'run-A');

    expect(proposalsChain.__calls.eqs).toContainEqual(['run_id', 'run-A']);
    expect(statesChain.__calls.eqs).toContainEqual(['run_id', 'run-A']);
    expect(statesChain.__calls.eqs).toContainEqual(['reviewer_id', 'user-1']);
  });

  it('does NOT scope by run_id when none is provided', async () => {
    const proposalsChain = chain({ data: [] });
    (supabase.from as any).mockReturnValueOnce(proposalsChain);
    (supabase.auth.getUser as any).mockResolvedValueOnce({
      data: { user: null },
    });

    await AISuggestionService.loadSuggestions('art-1', ['inst-1']);

    expect(
      proposalsChain.__calls.eqs.find(([col]) => col === 'run_id'),
    ).toBeUndefined();
  });

  it('joins evidence onto proposals via proposal_record_id', async () => {
    const proposalsChain = chain({
      data: [
        {
          id: 'p-1',
          run_id: 'run-A',
          instance_id: 'inst-1',
          field_id: 'f-1',
          source: 'ai',
          proposed_value: { value: 'Y' },
          confidence_score: 0.9,
          rationale: 'because',
          created_at: '2026-04-28T10:00:00Z',
        },
      ],
    });
    const evidenceChain = chain({
      data: [
        {
          proposal_record_id: 'p-1',
          text_content: 'verbatim quote',
          page_number: 3,
        },
      ],
    });
    (supabase.from as any)
      .mockReturnValueOnce(proposalsChain)
      .mockReturnValueOnce(evidenceChain);
    (supabase.auth.getUser as any).mockResolvedValueOnce({
      data: { user: null },
    });

    const result = await AISuggestionService.loadSuggestions('art-1', ['inst-1']);
    expect(result.count).toBe(1);
    const sug = result.suggestions['inst-1_f-1'];
    expect(sug).toBeDefined();
    expect(sug.evidence).toEqual({ text: 'verbatim quote', pageNumber: 3 });
    expect(sug.value).toBe('Y');
    expect(sug.runId).toBe('run-A');
    // Status defaults to pending when there's no reviewer_state.
    expect(sug.status).toBe('pending');
  });

  it("derives status='accepted' from a non-reject reviewer_state", async () => {
    const proposalsChain = chain({
      data: [
        {
          id: 'p-1',
          run_id: 'run-A',
          instance_id: 'inst-1',
          field_id: 'f-1',
          source: 'ai',
          proposed_value: { value: 'V' },
          confidence_score: 0.8,
          rationale: null,
          created_at: '2026-04-28T10:00:00Z',
        },
      ],
    });
    const evidenceChain = chain({ data: [] });
    const statesChain = chain({
      data: [
        {
          instance_id: 'inst-1',
          field_id: 'f-1',
          reviewer_decision: { decision: 'accept_proposal' },
        },
      ],
    });
    (supabase.from as any)
      .mockReturnValueOnce(proposalsChain)
      .mockReturnValueOnce(evidenceChain)
      .mockReturnValueOnce(statesChain);
    (supabase.auth.getUser as any).mockResolvedValueOnce({
      data: { user: { id: 'user-1' } },
    });

    const result = await AISuggestionService.loadSuggestions(
      'art-1',
      ['inst-1'],
    );
    expect(result.suggestions['inst-1_f-1'].status).toBe('accepted');
  });

  it("derives status='rejected' from a reject reviewer_state", async () => {
    const proposalsChain = chain({
      data: [
        {
          id: 'p-1',
          run_id: 'run-A',
          instance_id: 'inst-1',
          field_id: 'f-1',
          source: 'ai',
          proposed_value: { value: 'V' },
          confidence_score: 0.8,
          rationale: null,
          created_at: '2026-04-28T10:00:00Z',
        },
      ],
    });
    const evidenceChain = chain({ data: [] });
    const statesChain = chain({
      data: [
        {
          instance_id: 'inst-1',
          field_id: 'f-1',
          reviewer_decision: { decision: 'reject' },
        },
      ],
    });
    (supabase.from as any)
      .mockReturnValueOnce(proposalsChain)
      .mockReturnValueOnce(evidenceChain)
      .mockReturnValueOnce(statesChain);
    (supabase.auth.getUser as any).mockResolvedValueOnce({
      data: { user: { id: 'user-1' } },
    });

    const result = await AISuggestionService.loadSuggestions(
      'art-1',
      ['inst-1'],
    );
    expect(result.suggestions['inst-1_f-1'].status).toBe('rejected');
  });

  it('keeps only the newest proposal per (instance, field) — already ordered desc', async () => {
    const proposalsChain = chain({
      data: [
        {
          id: 'p-newest',
          run_id: 'run-A',
          instance_id: 'inst-1',
          field_id: 'f-1',
          source: 'ai',
          proposed_value: { value: 'newer' },
          confidence_score: 0.9,
          rationale: null,
          created_at: '2026-04-28T11:00:00Z',
        },
        {
          id: 'p-older',
          run_id: 'run-A',
          instance_id: 'inst-1',
          field_id: 'f-1',
          source: 'ai',
          proposed_value: { value: 'older' },
          confidence_score: 0.5,
          rationale: null,
          created_at: '2026-04-28T10:00:00Z',
        },
      ],
    });
    const evidenceChain = chain({ data: [] });
    (supabase.from as any)
      .mockReturnValueOnce(proposalsChain)
      .mockReturnValueOnce(evidenceChain);
    (supabase.auth.getUser as any).mockResolvedValueOnce({ data: { user: null } });

    const result = await AISuggestionService.loadSuggestions('art-1', ['inst-1']);
    expect(result.count).toBe(1);
    expect(result.suggestions['inst-1_f-1'].id).toBe('p-newest');
  });

  it('throws APIError when proposals fetch fails', async () => {
    const proposalsChain = chain({
      data: null,
      error: { message: 'proposals down' },
    });
    (supabase.from as any).mockReturnValueOnce(proposalsChain);

    await expect(
      AISuggestionService.loadSuggestions('art-1', ['inst-1']),
    ).rejects.toThrow(/proposals down/);
  });

  it('throws when getUser reports an auth error (#49)', async () => {
    const proposalsChain = chain({ data: [] });
    (supabase.from as any).mockReturnValueOnce(proposalsChain);
    (supabase.auth.getUser as any).mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'token expired' },
    });

    await expect(
      AISuggestionService.loadSuggestions('art-1', ['inst-1']),
    ).rejects.toThrow(/token expired/);
  });

  it('throws when the reviewer_states query fails (#73)', async () => {
    const proposalsChain = chain({
      data: [
        {
          id: 'p-1',
          run_id: 'run-A',
          instance_id: 'inst-1',
          field_id: 'f-1',
          source: 'ai',
          proposed_value: { value: 'V' },
          confidence_score: 0.9,
          rationale: null,
          created_at: '2026-04-28T10:00:00Z',
        },
      ],
    });
    const evidenceChain = chain({ data: [] });
    const statesChain = chain({
      data: null,
      error: { message: 'states down' },
    });
    (supabase.from as any)
      .mockReturnValueOnce(proposalsChain)
      .mockReturnValueOnce(evidenceChain)
      .mockReturnValueOnce(statesChain);
    (supabase.auth.getUser as any).mockResolvedValueOnce({
      data: { user: { id: 'user-1' } },
    });

    await expect(
      AISuggestionService.loadSuggestions('art-1', ['inst-1']),
    ).rejects.toThrow(/states down/);
  });
});

describe('AISuggestionService.getHistory', () => {
  it('scopes by (instance, field) + source=ai, orders desc, applies limit', async () => {
    const c = chain({ data: [] });
    (supabase.from as any).mockReturnValueOnce(c);
    await AISuggestionService.getHistory('inst-1', 'f-1', 7);
    expect(c.__calls.eqs).toContainEqual(['instance_id', 'inst-1']);
    expect(c.__calls.eqs).toContainEqual(['field_id', 'f-1']);
    expect(c.__calls.eqs).toContainEqual(['source', 'ai']);
    expect(c.__calls.orders).toContainEqual(['created_at', { ascending: false }]);
    expect(c.__calls.limits).toContain(7);
  });

  it('default limit is 10', async () => {
    const c = chain({ data: [] });
    (supabase.from as any).mockReturnValueOnce(c);
    await AISuggestionService.getHistory('inst-1', 'f-1');
    expect(c.__calls.limits).toContain(10);
  });

  it('returns mapped suggestions with evidence joined', async () => {
    const proposalsChain = chain({
      data: [
        {
          id: 'p-1',
          run_id: 'run-A',
          instance_id: 'inst-1',
          field_id: 'f-1',
          source: 'ai',
          proposed_value: { value: 'V' },
          confidence_score: 0.8,
          rationale: null,
          created_at: '2026-04-28T10:00:00Z',
        },
      ],
    });
    const evidenceChain = chain({
      data: [
        {
          proposal_record_id: 'p-1',
          text_content: 'quote',
          page_number: 2,
        },
      ],
    });
    (supabase.from as any)
      .mockReturnValueOnce(proposalsChain)
      .mockReturnValueOnce(evidenceChain);

    const result = await AISuggestionService.getHistory('inst-1', 'f-1');
    expect(result).toHaveLength(1);
    expect(result[0].evidence).toEqual({ text: 'quote', pageNumber: 2 });
  });
});

describe('AISuggestionService.getArticleInstanceIds', () => {
  it('returns only the ids array from the article instances query', async () => {
    const c = chain({
      data: [{ id: 'inst-1' }, { id: 'inst-2' }, { id: 'inst-3' }],
    });
    (supabase.from as any).mockReturnValueOnce(c);
    const ids = await AISuggestionService.getArticleInstanceIds('art-1');
    expect(ids).toEqual(['inst-1', 'inst-2', 'inst-3']);
  });

  it('throws APIError when the query fails', async () => {
    (supabase.from as any).mockReturnValueOnce(
      chain({ data: null, error: { message: 'instance fail' } }),
    );
    await expect(
      AISuggestionService.getArticleInstanceIds('art-1'),
    ).rejects.toThrow(/instance fail/);
  });

  it('handles empty data gracefully', async () => {
    (supabase.from as any).mockReturnValueOnce(chain({ data: null }));
    const ids = await AISuggestionService.getArticleInstanceIds('art-1');
    expect(ids).toEqual([]);
  });
});

describe('AISuggestionService.rejectSuggestion', () => {
  it('uses the provided runId without calling findActiveRun', async () => {
    await AISuggestionService.rejectSuggestion({
      suggestionId: 'proposal-1',
      reviewerId: 'user-1',
      instanceId: 'inst-1',
      fieldId: 'field-1',
      projectId: 'proj-1',
      articleId: 'art-1',
      runId: 'run-explicit',
    });
    expect(ExtractionValueService.findActiveRun).not.toHaveBeenCalled();
    expect(ExtractionValueService.rejectValue).toHaveBeenCalledWith(
      'run-explicit',
      'inst-1',
      'field-1',
    );
  });

  it('falls back to findActiveRun when no runId is supplied', async () => {
    (ExtractionValueService.findActiveRun as any).mockResolvedValueOnce({
      id: 'run-fallback',
      stage: 'review',
      status: 'running',
      template_id: 'tpl-1',
    });
    await AISuggestionService.rejectSuggestion({
      suggestionId: 'proposal-1',
      reviewerId: 'user-1',
      instanceId: 'inst-1',
      fieldId: 'field-1',
      projectId: 'proj-1',
      articleId: 'art-1',
    });
    expect(ExtractionValueService.findActiveRun).toHaveBeenCalledWith(
      'art-1',
      null,
    );
    expect(ExtractionValueService.rejectValue).toHaveBeenCalledWith(
      'run-fallback',
      'inst-1',
      'field-1',
    );
  });
});
