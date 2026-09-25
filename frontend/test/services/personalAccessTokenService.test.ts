import {describe, expect, it, vi} from 'vitest';
import {ApiError} from '@/integrations/api/client';

const {apiClientMock} = vi.hoisted(() => ({apiClientMock: vi.fn()}));
vi.mock('@/integrations/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/integrations/api/client')>()),
  apiClient: apiClientMock,
}));

import {
  createMyToken,
  fetchMyTokens,
  isTokenLimitError,
  revokeMyToken,
} from '@/services/personalAccessTokenService';

describe('personalAccessTokenService', () => {
  it('fetchMyTokens calls apiClient with the list endpoint and returns ok', async () => {
    const data = [{id: 't1'}];
    apiClientMock.mockResolvedValue(data);

    const result = await fetchMyTokens();

    expect(apiClientMock).toHaveBeenCalledWith('/api/v1/me/tokens');
    expect(result).toEqual({ok: true, data});
  });

  it('createMyToken posts the body to the list endpoint', async () => {
    const created = {token: {id: 't1'}, secret: 'prumo_pat_x'};
    apiClientMock.mockResolvedValue(created);

    const result = await createMyToken({name: 'cli', scope: 'read', expires_in_days: 90});

    expect(apiClientMock).toHaveBeenCalledWith('/api/v1/me/tokens', {
      method: 'POST',
      body: {name: 'cli', scope: 'read', expires_in_days: 90},
    });
    expect(result).toEqual({ok: true, data: created});
  });

  it('revokeMyToken DELETEs the id endpoint and returns ok with undefined data', async () => {
    apiClientMock.mockResolvedValue(undefined);

    const result = await revokeMyToken('t1');

    expect(apiClientMock).toHaveBeenCalledWith('/api/v1/me/tokens/t1', {method: 'DELETE'});
    expect(result).toEqual({ok: true, data: undefined});
  });

  it('never throws: a rejection becomes {ok: false}', async () => {
    apiClientMock.mockRejectedValue(new Error('boom'));

    const result = await fetchMyTokens();

    expect(result.ok).toBe(false);
  });

  it('isTokenLimitError is true only for the TOKEN_LIMIT_REACHED ApiError', () => {
    expect(isTokenLimitError(new ApiError('TOKEN_LIMIT_REACHED', 'm', 409))).toBe(true);
    expect(isTokenLimitError(new ApiError('VALIDATION_ERROR', 'm', 422))).toBe(false);
    expect(isTokenLimitError(new Error('m'))).toBe(false);
  });
});
