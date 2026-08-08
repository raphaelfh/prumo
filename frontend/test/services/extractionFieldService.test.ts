/**
 * extractionFieldService — delete-safety contract (B-5 Task 7).
 *
 * The impact probe is ADVISORY: it explains the common in-use cases up
 * front, but reject-only reviewer decisions and consensus/published rows
 * RESTRICT at the DB while counting 0 here. The real invariant is the
 * SQLSTATE 23503 mapping in `deleteField` — a foreign-key refusal must
 * surface as a typed PgError carrying FRIENDLY copy, never the raw
 * Postgres message.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({supabase: {from: vi.fn()}}));
vi.mock('@/lib/copy', () => ({t: (ns: string, key: string) => `${ns}.${key}`}));

import {supabase} from '@/integrations/supabase/client';
import {PgError} from '@/lib/error-utils';
import {deleteField, validateFieldImpact} from '@/services/extractionFieldService';

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
