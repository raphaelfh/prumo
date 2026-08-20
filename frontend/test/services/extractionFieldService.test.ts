/**
 * extractionFieldService — typed-endpoint write layer (B-7 Task 5) plus
 * the ADVISORY impact probe (still a PostgREST read).
 *
 * The impact probe explains the common in-use cases up front, but
 * reject-only reviewer decisions and consensus/published rows RESTRICT
 * at the DB while counting 0 here. The real invariant is the 409 →
 * PgError('23503') translation in `deleteField` — a foreign-key refusal
 * must surface as a typed PgError carrying FRIENDLY copy (the
 * useDeleteTemplateField branch `instanceof PgError && code === '23503'`
 * mocks the SERVICE, so only THIS suite catches losing the remap).
 *
 * Every write goes through apiClient onto the B-7 endpoints — these
 * tests mock apiClient (never supabase) and assert URL + body shapes
 * plus the ApiError→PgError translations.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {apiClientMock, ApiError} = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return {apiClientMock: vi.fn(), ApiError};
});

vi.mock('@/integrations/api/client', () => ({
  apiClient: apiClientMock,
  ApiError,
}));
vi.mock('@/integrations/supabase/client', () => ({supabase: {from: vi.fn()}}));
vi.mock('@/lib/copy', () => ({t: (ns: string, key: string) => `${ns}.${key}`}));

import {supabase} from '@/integrations/supabase/client';
import {PgError} from '@/lib/error-utils';
import {
  deleteField,
  insertField,
  moveField,
  reorderFields,
  updateField,
  validateFieldImpact,
} from '@/services/extractionFieldService';
import type {ExtractionFieldInsert} from '@/types/extraction';

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

const SAFE = 'safe-to-modify';
const inUse = (count: number, articles: number) => `in-use ${count}/${articles}`;

const FIELD_ROW = {
  id: 'f1',
  entity_type_id: 'sec',
  name: 'peso',
  label: 'Peso',
  description: null,
  field_type: 'text',
  is_required: false,
  validation_schema: {},
  allowed_values: null,
  unit: null,
  allowed_units: null,
  llm_description: null,
  sort_order: 1,
  created_at: '2026-08-08T00:00:00Z',
};

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

  it('ADVISORY gap: reject-only decisions + zero proposals count 0 — the probe allows what the DB may still RESTRICT (the 409 remap is the invariant)', async () => {
    // Reject-only rows are filtered out server-side by .neq('decision',
    // 'reject'), and consensus/published rows are not probed at all: both
    // still hold RESTRICT FKs. The probe deliberately says "safe" here —
    // the deleteField 409 → PgError('23503') translation catches the
    // refusal with friendly copy.
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

describe('insertField — POST onto the typed create endpoint', () => {
  const NEW_FIELD: ExtractionFieldInsert = {
    entity_type_id: 'sec',
    name: 'peso',
    label: 'Peso',
    description: null,
    field_type: 'text',
    is_required: false,
    validation_schema: {},
    allowed_values: null,
    unit: null,
    allowed_units: null,
    sort_order: 1,
  };

  it('POSTs the field body to the template-scoped endpoint and returns the created row', async () => {
    apiClientMock.mockResolvedValue(FIELD_ROW);

    const result = await insertField('p1', 't1', NEW_FIELD);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/p1/templates/t1/fields',
      {method: 'POST', body: NEW_FIELD},
    );
    expect(result.data).toEqual(FIELD_ROW);
  });

  it('translates the 409 duplicate-name refusal into a friendly PgError', async () => {
    apiClientMock.mockRejectedValue(
      new ApiError('HTTP_ERROR', "field name 'peso' already exists in section", 409),
    );

    const result = await insertField('p1', 't1', NEW_FIELD);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PgError);
    expect((result.error as PgError).code).toBe('23505');
    expect(result.error.message).toBe('templateConfig.errors_duplicateFieldName');
  });
});

describe('updateField — PATCH onto the typed update endpoint', () => {
  it('PATCHes only the given updates and returns the updated row', async () => {
    apiClientMock.mockResolvedValue({...FIELD_ROW, label: 'Peso corporal'});

    const result = await updateField('p1', 't1', 'f1', {label: 'Peso corporal'});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/p1/templates/t1/fields/f1',
      {method: 'PATCH', body: {label: 'Peso corporal'}},
    );
    expect(result.data.label).toBe('Peso corporal');
  });

  it('translates the 409 duplicate-name refusal into a friendly PgError', async () => {
    apiClientMock.mockRejectedValue(new ApiError('HTTP_ERROR', 'duplicate', 409));

    const result = await updateField('p1', 't1', 'f1', {name: 'peso'});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PgError);
    expect((result.error as PgError).code).toBe('23505');
    expect(result.error.message).toBe('templateConfig.errors_duplicateFieldName');
  });
});

describe('deleteField — 409 field-in-use mapped to friendly PgError (panel 11)', () => {
  it('DELETEs via the typed endpoint and resolves ok', async () => {
    apiClientMock.mockResolvedValue({id: 'f1', deleted: true});

    const result = await deleteField('p1', 't1', 'f1');

    expect(result.ok).toBe(true);
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/p1/templates/t1/fields/f1',
      {method: 'DELETE'},
    );
  });

  it("maps the backend 409 to PgError('23503') with the copy message — useDeleteTemplateField branches on exactly this", async () => {
    apiClientMock.mockRejectedValue(
      new ApiError(
        'HTTP_ERROR',
        'field is referenced by recorded extraction work (RESTRICT)',
        409,
      ),
    );

    const result = await deleteField('p1', 't1', 'f1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PgError);
    expect((result.error as PgError).code).toBe('23503');
    expect(result.error.message).toBe('extraction.errors_deleteFieldInUse');
    expect(result.error.message).not.toContain('RESTRICT');
  });

  it('passes a non-409 error through untouched (no PgError wrap)', async () => {
    apiClientMock.mockRejectedValue(new ApiError('HTTP_ERROR', 'Field not found', 404));

    const result = await deleteField('p1', 't1', 'f1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toBeInstanceOf(PgError);
    expect(result.error.message).toContain('Field not found');
  });
});

describe('reorderFields — ONE atomic batch call (replaces the N-UPDATEs loop)', () => {
  const BATCH = [
    {id: 'f1', sort_order: 1},
    {id: 'f2', sort_order: 2},
  ];

  it('POSTs the whole batch to the reorder endpoint in a single call', async () => {
    apiClientMock.mockResolvedValue({updated_count: 2});

    const result = await reorderFields('p1', 't1', BATCH);

    expect(result.ok).toBe(true);
    expect(apiClientMock).toHaveBeenCalledTimes(1);
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/p1/templates/t1/fields/reorder',
      {method: 'POST', body: {updates: BATCH}},
    );
  });

  it('surfaces a refused batch as ok:false with the backend message (all-or-nothing, no partial success)', async () => {
    apiClientMock.mockRejectedValue(
      new ApiError('HTTP_ERROR', 'One or more fields not found in template', 404),
    );

    const result = await reorderFields('p1', 't1', BATCH);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('not found');
  });
});

describe('moveField — typed move endpoint (destination + landing position)', () => {
  it('POSTs {entity_type_id, sort_order} to the move endpoint and returns the updated row', async () => {
    const row = {...FIELD_ROW, entity_type_id: 'sec-2', sort_order: 5};
    apiClientMock.mockResolvedValue(row);

    const result = await moveField('p1', 't1', 'f1', 'sec-2', 5);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/p1/templates/t1/fields/f1/move',
      {method: 'POST', body: {entity_type_id: 'sec-2', sort_order: 5}},
    );
    expect(result.data).toEqual(row);
  });

  it('translates the 409 duplicate-name refusal into a friendly PgError', async () => {
    apiClientMock.mockRejectedValue(new ApiError('HTTP_ERROR', 'duplicate', 409));

    const result = await moveField('p1', 't1', 'f1', 'sec-2', 5);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PgError);
    expect((result.error as PgError).code).toBe('23505');
  });

  it('passes the 422 cross-template refusal through untranslated (generic fallback, panel 17)', async () => {
    apiClientMock.mockRejectedValue(
      new ApiError('HTTP_ERROR', 'Destination section does not belong to template', 422),
    );

    const result = await moveField('p1', 't1', 'f1', 'other-template-sec', 0);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toBeInstanceOf(PgError);
    expect(result.error.message).toContain('does not belong');
  });
});
