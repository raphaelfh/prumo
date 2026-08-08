/**
 * templateService — section writes on the typed B-7 endpoints.
 *
 * create/rename/delete route through apiClient (the reads — entity-type
 * loading, impact analysis — stay PostgREST until the read-path
 * consolidation follow-up). The load-bearing contracts:
 *
 * - createSection sends NO sort_order (the server computes max+1,
 *   killing the old read-then-write race) and names its role explicitly
 *   (the old service hard-coded study_section).
 * - deleteSection translates the backend 409 section-in-use refusal
 *   into PgError('23503') carrying friendly copy — RemoveSectionDialog
 *   branches on exactly this to toast it verbatim (panel 17).
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

import {PgError} from '@/lib/error-utils';
import {
  createSection,
  deleteSection,
  updateEntityTypeLabel,
} from '@/services/templateService';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('updateEntityTypeLabel — rename endpoint', () => {
  it('PATCHes {label} to the section rename endpoint', async () => {
    apiClientMock.mockResolvedValue({id: 'sec1', label: 'Renamed'});

    const result = await updateEntityTypeLabel('p1', 't1', 'sec1', 'Renamed');

    expect(result.ok).toBe(true);
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/p1/templates/t1/sections/sec1',
      {method: 'PATCH', body: {label: 'Renamed'}},
    );
  });

  it('surfaces a refused rename as ok:false', async () => {
    apiClientMock.mockRejectedValue(new ApiError('HTTP_ERROR', 'Section not found', 404));

    const result = await updateEntityTypeLabel('p1', 't1', 'sec1', 'Renamed');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Section not found');
  });
});

describe('createSection — typed create endpoint', () => {
  const PARAMS = {
    projectId: 'p1',
    templateId: 't1',
    name: 'outcomes',
    label: 'Outcomes',
    description: 'Outcome measures',
    cardinality: 'many',
    role: 'study_section',
    isRequired: true,
  } as const;

  it('POSTs the section body with an explicit role and NO sort_order (server computes it)', async () => {
    apiClientMock.mockResolvedValue({id: 'sec-new', name: 'outcomes'});

    const result = await createSection(PARAMS);

    expect(result.ok).toBe(true);
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/p1/templates/t1/sections',
      {
        method: 'POST',
        body: {
          name: 'outcomes',
          label: 'Outcomes',
          description: 'Outcome measures',
          cardinality: 'many',
          role: 'study_section',
          is_required: true,
        },
      },
    );
    const body = (apiClientMock.mock.calls[0][1] as {body: Record<string, unknown>})
      .body;
    expect(body).not.toHaveProperty('sort_order');
  });

  it('normalizes a missing description to null and surfaces failures as ok:false', async () => {
    apiClientMock.mockResolvedValue({id: 'sec-new'});
    await createSection({...PARAMS, description: undefined});
    expect(
      (apiClientMock.mock.calls[0][1] as {body: Record<string, unknown>}).body
        .description,
    ).toBeNull();

    apiClientMock.mockRejectedValue(
      new ApiError('HTTP_ERROR', 'template already has a model_container', 409),
    );
    const result = await createSection(PARAMS);
    expect(result.ok).toBe(false);
  });
});

describe('deleteSection — 409 section-in-use mapped to friendly PgError (panel 17)', () => {
  it('DELETEs via the typed endpoint and resolves ok', async () => {
    apiClientMock.mockResolvedValue({id: 'sec1', deleted: true});

    const result = await deleteSection('p1', 't1', 'sec1');

    expect(result.ok).toBe(true);
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/p1/templates/t1/sections/sec1',
      {method: 'DELETE'},
    );
  });

  it("maps the backend 409 to PgError('23503') with the copy message — RemoveSectionDialog toasts it verbatim", async () => {
    apiClientMock.mockRejectedValue(
      new ApiError(
        'HTTP_ERROR',
        'section holds recorded extraction work (RESTRICT)',
        409,
      ),
    );

    const result = await deleteSection('p1', 't1', 'sec1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(PgError);
    expect((result.error as PgError).code).toBe('23503');
    expect(result.error.message).toBe('templateConfig.errors_deleteSectionInUse');
    expect(result.error.message).not.toContain('RESTRICT');
  });

  it('passes a non-409 error through untouched (no PgError wrap)', async () => {
    apiClientMock.mockRejectedValue(new ApiError('HTTP_ERROR', 'Section not found', 404));

    const result = await deleteSection('p1', 't1', 'sec1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toBeInstanceOf(PgError);
    expect(result.error.message).toContain('Section not found');
  });
});
