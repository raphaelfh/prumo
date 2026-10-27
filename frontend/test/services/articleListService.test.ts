// frontend/test/services/articleListService.test.ts
/**
 * Article deletion goes through the API (`apiClient`): the server deletes the
 * rows before the PDFs and answers with how many of each it removed.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

const apiClientMock = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/integrations/api/client')>()),
  apiClient: apiClientMock,
}));

import {ApiError} from '@/integrations/api/client';
import {deleteArticles} from '@/services/articleListService';

beforeEach(() => apiClientMock.mockReset());

describe('deleteArticles', () => {
  it('POSTs the selection to the delete route and returns the counts', async () => {
    apiClientMock.mockResolvedValueOnce({deleted: 2, storage_failures: 0});

    const result = await deleteArticles('p1', {mode: 'ids', ids: ['a1', 'a2']});

    expect(apiClientMock).toHaveBeenCalledWith('/api/v1/projects/p1/articles/delete', {
      method: 'POST',
      body: {selection: {mode: 'ids', ids: ['a1', 'a2']}},
    });
    expect(result).toEqual({ok: true, data: {deleted: 2, storage_failures: 0}});
  });

  it('returns ok:false and keeps the message when the server refuses (403)', async () => {
    apiClientMock.mockRejectedValueOnce(new ApiError('FORBIDDEN', 'Manager role required', 403));

    const result = await deleteArticles('p1', {mode: 'ids', ids: ['a1']});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('Manager role required');
  });
});
