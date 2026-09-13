import {beforeEach, describe, expect, it, vi} from 'vitest';

const {apiClientMock} = vi.hoisted(() => ({apiClientMock: vi.fn()}));
vi.mock('@/integrations/api/client', () => ({apiClient: apiClientMock}));

import {fetchMyConnections, fetchProjectConnections} from '@/services/llmConnectionsService';

beforeEach(() => vi.clearAllMocks());

describe('llmConnectionsService reads', () => {
  it('GETs the two routes and returns ErrorResult data', async () => {
    apiClientMock.mockResolvedValueOnce([{id: 'c1'}]);
    expect(await fetchMyConnections()).toEqual({ok: true, data: [{id: 'c1'}]});
    expect(apiClientMock).toHaveBeenLastCalledWith('/api/v1/me/connections');

    apiClientMock.mockResolvedValueOnce([]);
    await fetchProjectConnections('p1');
    expect(apiClientMock).toHaveBeenLastCalledWith('/api/v1/projects/p1/connections');
  });

  it('never throws across the boundary', async () => {
    apiClientMock.mockRejectedValueOnce(new Error('boom'));
    const result = await fetchMyConnections();
    expect(result.ok).toBe(false);
  });
});
