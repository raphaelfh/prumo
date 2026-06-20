import {afterEach, describe, expect, it, vi} from 'vitest';

// Mock the typed client; the service must route every call through it.
const {apiClientMock} = vi.hoisted(() => ({apiClientMock: vi.fn()}));
vi.mock('@/integrations/api/client', () => ({apiClient: apiClientMock}));

import {
  apiKeysService,
  createApiKey,
  deleteApiKey,
  loadKeysAndProviders,
} from './apiKeysService';

afterEach(() => {
  apiClientMock.mockReset();
});

describe('apiKeysService (typed client migration)', () => {
  it('listKeys routes through the typed client (no token arg) and unwraps data.keys', async () => {
    apiClientMock.mockResolvedValueOnce({keys: [{id: '1'}]});
    const keys = await apiKeysService.listKeys(false);
    expect(keys).toHaveLength(1);
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/user-api-keys?active_only=false',
      {method: 'GET'},
    );
  });

  it('createApiKey surfaces error.message from the envelope (never FastAPI detail)', async () => {
    apiClientMock.mockRejectedValueOnce(new Error('Provider already configured'));
    const result = await createApiKey({provider: 'openai', apiKey: 'sk-x'});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Provider already configured');
    }
  });

  it('deleteApiKey issues DELETE to the keyed path', async () => {
    apiClientMock.mockResolvedValueOnce(null);
    const result = await deleteApiKey('key-123');
    expect(result.ok).toBe(true);
    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/user-api-keys/key-123',
      {method: 'DELETE'},
    );
  });

  it('loadKeysAndProviders fans out to listKeys + listProviders', async () => {
    apiClientMock
      .mockResolvedValueOnce({keys: []})
      .mockResolvedValueOnce({providers: []});
    const result = await loadKeysAndProviders();
    expect(result.ok).toBe(true);
    expect(apiClientMock).toHaveBeenCalledTimes(2);
  });
});
