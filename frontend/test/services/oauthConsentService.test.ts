import {describe, expect, it, vi} from 'vitest';
import {ApiError} from '@/integrations/api/client';

const {apiClientMock} = vi.hoisted(() => ({apiClientMock: vi.fn()}));
vi.mock('@/integrations/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/integrations/api/client')>()),
  apiClient: apiClientMock,
}));

import {
  decideConsentRequest,
  fetchConsentRequest,
  isAlreadyDecidedError,
  isRateLimitedError,
  isRequestGoneError,
} from '@/services/oauthConsentService';

const ID = '11111111-1111-4111-8111-111111111111';

describe('oauthConsentService', () => {
  it('fetchConsentRequest GETs the request endpoint and returns ok', async () => {
    const data = {client_name: 'Claude', redirect_host: 'claude.ai', offers_write: true};
    apiClientMock.mockResolvedValue(data);

    const result = await fetchConsentRequest(ID);

    expect(apiClientMock).toHaveBeenCalledWith(`/api/v1/oauth/requests/${ID}`);
    expect(result).toEqual({ok: true, data});
  });

  it('decideConsentRequest POSTs the decision body to the decision endpoint', async () => {
    const data = {redirect_url: 'https://claude.ai/cb?code=c&state=s'};
    apiClientMock.mockResolvedValue(data);

    const result = await decideConsentRequest(ID, {approve: true, write: false, ai_run: false});

    expect(apiClientMock).toHaveBeenCalledWith(`/api/v1/oauth/requests/${ID}/decision`, {
      method: 'POST',
      body: {approve: true, write: false, ai_run: false},
    });
    expect(result).toEqual({ok: true, data});
  });

  it('never throws: a rejection becomes {ok: false}', async () => {
    apiClientMock.mockRejectedValue(new ApiError('NOT_FOUND', 'm', 404));

    const result = await fetchConsentRequest(ID);

    expect(result.ok).toBe(false);
  });

  it('isRequestGoneError is true only for a 404 ApiError', () => {
    expect(isRequestGoneError(new ApiError('NOT_FOUND', 'm', 404))).toBe(true);
    expect(isRequestGoneError(new ApiError('REQUEST_ALREADY_DECIDED', 'm', 409))).toBe(false);
    expect(isRequestGoneError(new Error('m'))).toBe(false);
  });

  it('isAlreadyDecidedError is true only for the REQUEST_ALREADY_DECIDED ApiError', () => {
    expect(isAlreadyDecidedError(new ApiError('REQUEST_ALREADY_DECIDED', 'm', 409))).toBe(true);
    expect(isAlreadyDecidedError(new ApiError('CONFLICT', 'm', 409))).toBe(false);
    expect(isAlreadyDecidedError(new Error('m'))).toBe(false);
  });

  it('isRateLimitedError is true only for a 429 ApiError', () => {
    expect(isRateLimitedError(new ApiError('UNKNOWN_ERROR', 'm', 429))).toBe(true);
    expect(isRateLimitedError(new ApiError('INTERNAL', 'm', 500))).toBe(false);
    expect(isRateLimitedError(new Error('m'))).toBe(false);
  });
});
