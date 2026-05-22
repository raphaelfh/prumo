/**
 * Contract tests for ``ExtractionValueService.findActiveRun`` and
 * ``findLatestFinalizedRun``.
 *
 * These are the single read entry point for resolving "which run is the
 * extraction surface currently editing" — they decide whether the form
 * shows REVIEW (writes ReviewerDecisions), FINALIZED (read-only with
 * reopen button), or "no run yet" (the AI hasn't proposed anything).
 *
 * Pinned invariants:
 *  - Always filters by ``kind='extraction'`` so a QA run on the same
 *    article cannot leak into the extraction surface.
 *  - Picks the most recent non-terminal run (DESC by created_at).
 *  - Returns ``null`` instead of throwing when no row matches.
 *  - ``findLatestFinalizedRun`` is the symmetric query, scoped to stage
 *    = 'finalized' only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => {
  const mock = { from: vi.fn() };
  return { supabase: mock };
});

import { supabase } from '@/integrations/supabase/client';
import { ExtractionValueService } from '@/services/extractionValueService';

interface RecordedQuery {
  eqs: Array<[string, unknown]>;
  ins: Array<[string, unknown[]]>;
  order?: { column: string; ascending: boolean | undefined };
  data: unknown;
}

function buildQuery(opts: { data?: unknown; error?: { message: string } | null }) {
  const recorded: RecordedQuery = { eqs: [], ins: [], data: opts.data ?? null };
  const error = opts.error ?? null;
  const q: any = {};
  q.select = vi.fn(() => q);
  q.eq = vi.fn((col: string, val: unknown) => {
    recorded.eqs.push([col, val]);
    return q;
  });
  q.in = vi.fn((col: string, vals: unknown[]) => {
    recorded.ins.push([col, vals]);
    return q;
  });
  q.order = vi.fn((col: string, opts?: { ascending?: boolean }) => {
    recorded.order = { column: col, ascending: opts?.ascending };
    return q;
  });
  q.limit = vi.fn(() => q);
  q.maybeSingle = vi.fn(() => Promise.resolve({ data: recorded.data, error }));
  return { q, recorded };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findActiveRun', () => {
  it("filters by kind='extraction' so QA runs can't leak in", async () => {
    const { q, recorded } = buildQuery({
      data: {
        id: 'run-1',
        stage: 'review',
        status: 'running',
        template_id: 'tpl-1',
      },
    });
    (supabase.from as any).mockReturnValueOnce(q);

    const run = await ExtractionValueService.findActiveRun('art-1', 'tpl-1');
    expect(run?.id).toBe('run-1');
    expect(recorded.eqs).toContainEqual(['kind', 'extraction']);
  });

  it('scopes by article_id', async () => {
    const { q, recorded } = buildQuery({ data: null });
    (supabase.from as any).mockReturnValueOnce(q);
    await ExtractionValueService.findActiveRun('art-42', 'tpl-1');
    expect(recorded.eqs).toContainEqual(['article_id', 'art-42']);
  });

  it('restricts to non-terminal stages', async () => {
    const { q, recorded } = buildQuery({ data: null });
    (supabase.from as any).mockReturnValueOnce(q);
    await ExtractionValueService.findActiveRun('art-1', null);
    expect(recorded.ins).toContainEqual([
      'stage',
      ['pending', 'proposal', 'review', 'consensus'],
    ]);
  });

  it('orders DESC by created_at and takes the most recent row', async () => {
    const { q, recorded } = buildQuery({ data: null });
    (supabase.from as any).mockReturnValueOnce(q);
    await ExtractionValueService.findActiveRun('art-1', 'tpl-1');
    expect(recorded.order).toEqual({ column: 'created_at', ascending: false });
  });

  it('returns null when no run matches', async () => {
    const { q } = buildQuery({ data: null });
    (supabase.from as any).mockReturnValueOnce(q);
    const run = await ExtractionValueService.findActiveRun('art-1', 'tpl-1');
    expect(run).toBeNull();
  });

  it('throws APIError when supabase reports an error', async () => {
    const { q } = buildQuery({ data: null, error: { message: 'boom' } });
    (supabase.from as any).mockReturnValueOnce(q);
    await expect(
      ExtractionValueService.findActiveRun('art-1', 'tpl-1'),
    ).rejects.toMatchObject({ message: expect.stringContaining('Failed to load active run') });
  });

  it('omits the template filter when projectTemplateId is null', async () => {
    const { q, recorded } = buildQuery({ data: null });
    (supabase.from as any).mockReturnValueOnce(q);
    await ExtractionValueService.findActiveRun('art-1', null);
    expect(recorded.eqs.some(([c]) => c === 'template_id')).toBe(false);
  });
});

describe('findLatestFinalizedRun', () => {
  it("filters by stage='finalized'", async () => {
    const { q, recorded } = buildQuery({
      data: { id: 'r2', stage: 'finalized', status: 'completed', template_id: 't' },
    });
    (supabase.from as any).mockReturnValueOnce(q);
    await ExtractionValueService.findLatestFinalizedRun('art-1', 't');
    expect(recorded.eqs).toContainEqual(['stage', 'finalized']);
  });

  it("filters by kind='extraction' (mirrors findActiveRun)", async () => {
    const { q, recorded } = buildQuery({ data: null });
    (supabase.from as any).mockReturnValueOnce(q);
    await ExtractionValueService.findLatestFinalizedRun('art-1', 't');
    expect(recorded.eqs).toContainEqual(['kind', 'extraction']);
  });

  it('returns null when there is no finalized run', async () => {
    const { q } = buildQuery({ data: null });
    (supabase.from as any).mockReturnValueOnce(q);
    const r = await ExtractionValueService.findLatestFinalizedRun('art-1', 't');
    expect(r).toBeNull();
  });
});
