import {describe, expect, it, vi} from 'vitest';
import {ApiError} from '@/integrations/api/client';

const {apiClientMock} = vi.hoisted(() => ({apiClientMock: vi.fn()}));
vi.mock('@/integrations/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/integrations/api/client')>()),
  apiClient: apiClientMock,
}));

import {fetchMyConnections, revokeMyConnection} from '@/services/oauthConnectionsService';

const ID = '11111111-1111-4111-8111-111111111111';

describe('oauthConnectionsService', () => {
  it('fetchMyConnections GETs the OAuth connections list and returns ok', async () => {
    const data = [{id: ID, client_name: 'Claude'}];
    apiClientMock.mockResolvedValue(data);

    const result = await fetchMyConnections();

    expect(apiClientMock).toHaveBeenCalledWith('/api/v1/me/oauth-connections');
    expect(result).toEqual({ok: true, data});
  });

  it('revokeMyConnection DELETEs the connection and returns ok with undefined data', async () => {
    apiClientMock.mockResolvedValue({revoked: true});

    const result = await revokeMyConnection(ID);

    expect(apiClientMock).toHaveBeenCalledWith(`/api/v1/me/oauth-connections/${ID}`, {method: 'DELETE'});
    expect(result).toEqual({ok: true, data: undefined});
  });

  it('an ApiError becomes {ok: false} with that error', async () => {
    const error = new ApiError('NOT_FOUND', 'Connection not found', 404);
    apiClientMock.mockRejectedValue(error);

    const result = await revokeMyConnection(ID);

    expect(result).toEqual({ok: false, error});
  });
});
