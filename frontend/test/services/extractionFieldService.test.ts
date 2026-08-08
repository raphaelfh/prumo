/**
 * extractionFieldService — delete-safety contract (B-5 Task 7) plus the
 * move/reorder write layer (B-6 T1).
 *
 * The impact probe is ADVISORY: it explains the common in-use cases up
 * front, but reject-only reviewer decisions and consensus/published rows
 * RESTRICT at the DB while counting 0 here. The real invariant is the
 * SQLSTATE 23503 mapping in `deleteField` — a foreign-key refusal must
 * surface as a typed PgError carrying FRIENDLY copy, never the raw
 * Postgres message.
 *
 * B-6: PostgREST builders RESOLVE (never reject) with `{error}` payloads
 * on SQL/RLS refusals — `reorderFields` must inspect each result; a bare
 * Promise.all throw-check would report silent success on an RLS refusal.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({supabase: {from: vi.fn()}}));
vi.mock('@/lib/copy', () => ({t: (ns: string, key: string) => `${ns}.${key}`}));

import {supabase} from '@/integrations/supabase/client';
import {PgError} from '@/lib/error-utils';
import {
  deleteField,
  moveField,
  reorderFields,
  validateFieldImpact,
} from '@/services/extractionFieldService';

const fromMock = vi.mocked(supabase.from);

interface ImpactStub {
  decisions?: unknown[];
  decisionsError?: {message: string} | null;
  proposalCount?: number;
  proposalsError?: {message: string} | null;
}

/** Stub the two impact queries: reviewer decisions (rows) + proposal
 * records (head:true count). Dispatches on table name. */
function stubImpactQueries({
  decisions = [],
  decisionsError = null,
  proposalCount = 0,
  proposalsError = null,
}: ImpactStub) {
  fromMock.mockImplementation(((table: string) => {
    if (table === 'extraction_reviewer_decisions') {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.neq = vi.fn(() =>
        Promise.resolve({data: decisions, error: decisionsError}),
      );
      return chain;
    }
    if (table === 'extraction_proposal_records') {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() =>
        Promise.resolve({count: proposalCount, error: proposalsError, data: null}),
      );
      return chain;
    }
    throw new Error(`unexpected table: ${table}`);
  }) as never);
}

function stubDelete(error: {code?: string; message: string} | null) {
  fromMock.mockImplementation(((table: string) => {
    if (table !== 'extraction_fields') throw new Error(`unexpected table: ${table}`);
    const chain: Record<string, unknown> = {};
    chain.delete = vi.fn(() => chain);
    chain.eq = vi.fn(() => Promise.resolve({error}));
    return chain;
  }) as never);
}

const SAFE = 'safe-to-modify';
const inUse = (count: number, articles: number) => `in-use ${count}/${articles}`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('validateFieldImpact — widened probe (proposals RESTRICT too)', () => {
  it('blocks delete/type-change on proposals ALONE (reviewer count 0)', async () => {
    stubImpactQueries({decisions: [], proposalCount: 3});

    const result = await validateFieldImpact('f1', SAFE, inUse);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fromMock).toHaveBeenCalledWith('extraction_proposal_records');
    expect(result.data.canDelete).toBe(false);
    expect(result.data.canChangeType).toBe(false);
    expect(result.data.extractedValuesCount).toBe(3);
    expect(result.data.message).toBe(inUse(3, 0));
  });

  it('sums decisions and proposals; affected articles stay decision-derived', async () => {
    stubImpactQueries({
      decisions: [
        {id: 'd1', decision: 'accept', run: {article_id: 'a1'}},
        {id: 'd2', decision: 'accept', run: {article_id: 'a1'}},
      ],
      proposalCount: 1,
    });

    const result = await validateFieldImpact('f1', SAFE, inUse);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.canDelete).toBe(false);
    expect(result.data.extractedValuesCount).toBe(3);
    expect(result.data.affectedArticles).toEqual(['a1']);
    expect(result.data.message).toBe(inUse(3, 1));
  });

  it('ADVISORY gap: reject-only decisions + zero proposals count 0 — the probe allows what the DB may still RESTRICT (23503 is the invariant)', async () => {
    // Reject-only rows are filtered out server-side by .neq('decision',
    // 'reject'), and consensus/published rows are not probed at all: both
    // still hold RESTRICT FKs. The probe deliberately says "safe" here —
    // the deleteField 23503 mapping catches the refusal with friendly copy.
    stubImpactQueries({decisions: [], proposalCount: 0});

    const result = await validateFieldImpact('f1', SAFE, inUse);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.canDelete).toBe(true);
    expect(result.data.canChangeType).toBe(true);
    expect(result.data.extractedValuesCount).toBe(0);
    expect(result.data.message).toBe(SAFE);
  });

  it('propagates a proposals-query error as ok:false', async () => {
    stubImpactQueries({proposalsError: {message: 'boom'}});

    const result = await validateFieldImpact('f1', SAFE, inUse);

    expect(result.ok).toBe(false);
  });
});

describe('deleteField — SQLSTATE 23503 mapped to friendly PgError', () => {
  it('maps a foreign-key violation to PgError with the copy message — the raw FK text never escapes', async () => {
    stubDelete({
      code: '23503',
      message:
        'update or delete on table "extraction_fields" violates foreign key constraint "extraction_proposal_records_field_id_fkey"',
    });

    const result = await deleteField('f1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PgError);
    expect((result.error as PgError).code).toBe('23503');
    expect(result.error.message).toBe('extraction.errors_deleteFieldInUse');
    expect(result.error.message).not.toContain('foreign key');
  });

  it('passes a non-FK error through untouched (no PgError wrap)', async () => {
    stubDelete({code: '42501', message: 'permission denied for table'});

    const result = await deleteField('f1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toBeInstanceOf(PgError);
    expect(result.error.message).toContain('permission denied');
  });

  it('resolves ok on a delete with no FK refusal', async () => {
    stubDelete(null);

    const result = await deleteField('f1');

    expect(result.ok).toBe(true);
  });
});

/** Stub the reorder batch: each `from()` call yields a fresh
 * update/eq chain whose awaited result carries the error mapped to the
 * row id — RESOLVED, never rejected (the PostgREST contract under test).
 * Returns the collected payloads for shape assertions. */
function stubReorder(errorsById: Record<string, {message: string} | null>) {
  const updateCalls: Array<Record<string, unknown>> = [];
  const eqCalls: Array<[string, string]> = [];
  fromMock.mockImplementation(((table: string) => {
    if (table !== 'extraction_fields') throw new Error(`unexpected table: ${table}`);
    const chain: Record<string, unknown> = {};
    chain.update = vi.fn((payload: Record<string, unknown>) => {
      updateCalls.push(payload);
      return chain;
    });
    chain.eq = vi.fn((column: string, id: string) => {
      eqCalls.push([column, id]);
      return Promise.resolve({error: errorsById[id] ?? null});
    });
    return chain;
  }) as never);
  return {updateCalls, eqCalls};
}

function stubMove(result: {
  data?: unknown;
  error?: {message: string; code?: string} | null;
}) {
  const updateCalls: Array<Record<string, unknown>> = [];
  const eqCalls: Array<[string, string]> = [];
  fromMock.mockImplementation(((table: string) => {
    if (table !== 'extraction_fields') throw new Error(`unexpected table: ${table}`);
    const chain: Record<string, unknown> = {};
    chain.update = vi.fn((payload: Record<string, unknown>) => {
      updateCalls.push(payload);
      return chain;
    });
    chain.eq = vi.fn((column: string, id: string) => {
      eqCalls.push([column, id]);
      return chain;
    });
    chain.select = vi.fn(() => chain);
    chain.single = vi.fn(() =>
      Promise.resolve({data: result.data ?? null, error: result.error ?? null}),
    );
    return chain;
  }) as never);
  return {updateCalls, eqCalls};
}

describe('reorderFields — resolve-dont-reject inspection (B-6 T1)', () => {
  it('writes each sort_order keyed by row id and resolves ok when no builder reports an error', async () => {
    const {updateCalls, eqCalls} = stubReorder({f1: null, f2: null});

    const result = await reorderFields([
      {id: 'f1', sort_order: 1},
      {id: 'f2', sort_order: 2},
    ]);

    expect(result.ok).toBe(true);
    expect(updateCalls).toEqual([{sort_order: 1}, {sort_order: 2}]);
    expect(eqCalls).toEqual([
      ['id', 'f1'],
      ['id', 'f2'],
    ]);
  });

  it('aggregates RESOLVED {error} payloads into ok:false — a bare Promise.all throw-check would report silent success', async () => {
    // Both builders RESOLVE (nothing rejects): the RLS refusal on f2
    // only exists as an error field on a fulfilled promise.
    stubReorder({
      f1: null,
      f2: {message: 'permission denied for table extraction_fields'},
    });

    const result = await reorderFields([
      {id: 'f1', sort_order: 1},
      {id: 'f2', sort_order: 2},
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('1 field(s)');
    expect(result.error.message).toContain('permission denied');
  });
});

describe('moveField — one update carrying entity_type_id + sort_order (B-6 T1)', () => {
  it('writes {entity_type_id, sort_order} keyed by field id and returns the updated row', async () => {
    const row = {id: 'f1', entity_type_id: 'sec-2', sort_order: 5};
    const {updateCalls, eqCalls} = stubMove({data: row});

    const result = await moveField('f1', 'sec-2', 5);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(updateCalls).toEqual([{entity_type_id: 'sec-2', sort_order: 5}]);
    expect(eqCalls).toEqual([['id', 'f1']]);
    expect(result.data).toEqual(row);
  });

  it('propagates a refused write as ok:false', async () => {
    stubMove({error: {message: 'permission denied', code: '42501'}});

    const result = await moveField('f1', 'sec-2', 5);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('permission denied');
  });
});
