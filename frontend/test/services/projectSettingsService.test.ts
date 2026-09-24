// frontend/test/services/projectSettingsService.test.ts
/**
 * The Settings writes go through the API (`apiClient`), never PostgREST:
 * the browser role has no INSERT/UPDATE/DELETE on `projects`.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

const apiClientMock = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/integrations/api/client')>()),
  apiClient: apiClientMock,
}));

import {ApiError} from '@/integrations/api/client';
import {deleteProject, saveProjectSettings, staleValuesOf, toDetailsFields} from '@/services/projectSettingsService';
import type {Project} from '@/types/project';

beforeEach(() => apiClientMock.mockReset());

describe('saveProjectSettings', () => {
  it('PATCHes the details route with fields and expected', async () => {
    const data = {name: 'n', updated_at: '2026-09-24T00:00:00Z'};
    apiClientMock.mockResolvedValueOnce(data);

    const result = await saveProjectSettings('p1', {fields: {name: 'n'}, expected: {name: 'o'}});

    expect(apiClientMock).toHaveBeenCalledWith('/api/v1/projects/p1/details', {
      method: 'PATCH',
      body: {fields: {name: 'n'}, expected: {name: 'o'}},
    });
    expect(result).toEqual({ok: true, data});
  });

  it('returns ok:false on a rejection', async () => {
    apiClientMock.mockRejectedValueOnce(new ApiError('FORBIDDEN', 'no', 403));
    const result = await saveProjectSettings('p1', {fields: {name: 'n'}, expected: {name: 'o'}});
    expect(result.ok).toBe(false);
  });
});

describe('staleValuesOf', () => {
  it('returns the server values of a 409 STALE_VALUE', () => {
    const error = new ApiError('STALE_VALUE', 'm', 409, 't', {current: {name: 'x'}});
    expect(staleValuesOf(error)).toEqual({name: 'x'});
  });

  it.each([
    ['a 403', new ApiError('FORBIDDEN', 'm', 403, 't', {current: {name: 'x'}})],
    ['a 409 with another code', new ApiError('CONFLICT', 'm', 409, 't', {current: {name: 'x'}})],
    ['a plain Error', new Error('m')],
  ])('returns null for %s', (_label, error) => {
    expect(staleValuesOf(error)).toBeNull();
  });
});

describe('toDetailsFields', () => {
  it('keeps well-shaped values', () => {
    const values = {name: 'n', eligibility_criteria: {inclusion: []}, review_keywords: ['k']};
    expect(toDetailsFields(values)).toEqual(values);
  });

  it.each([
    [{eligibility_criteria: ['x']}],
    [{study_design: 'x'}],
    [{review_keywords: [1]}],
    [{review_keywords: 'x'}],
  ])('refuses a JSONB value of the wrong shape: %j', (values) => {
    expect(toDetailsFields(values as Partial<Project>)).toBeNull();
  });
});

describe('deleteProject', () => {
  it('DELETEs the project route and returns the deleted id', async () => {
    apiClientMock.mockResolvedValueOnce({id: 'p1'});

    const result = await deleteProject('p1');

    expect(apiClientMock).toHaveBeenCalledWith('/api/v1/projects/p1', {method: 'DELETE'});
    expect(result).toEqual({ok: true, data: {id: 'p1'}});
  });

  it('returns ok:false on a rejection (a 403 arrives as an error, not an empty result)', async () => {
    apiClientMock.mockRejectedValueOnce(new ApiError('FORBIDDEN', 'Manager role required', 403));
    const result = await deleteProject('p1');
    expect(result.ok).toBe(false);
  });
});
