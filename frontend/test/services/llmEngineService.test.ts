import {beforeEach, describe, expect, it, vi} from 'vitest';

const {apiClientMock} = vi.hoisted(() => ({apiClientMock: vi.fn()}));
vi.mock('@/integrations/api/client', () => ({apiClient: apiClientMock}));

import {fetchLlmEngine, setMyEngine} from '@/services/llmEngineService';

beforeEach(() => vi.clearAllMocks());

describe('llmEngineService', () => {
  it('reads the project engine and writes the viewer row', async () => {
    apiClientMock.mockResolvedValueOnce({source: 'env_default'});
    expect((await fetchLlmEngine('p1')).ok).toBe(true);
    expect(apiClientMock).toHaveBeenLastCalledWith('/api/v1/projects/p1/llm-engine');

    apiClientMock.mockResolvedValueOnce({source: 'user'});
    await setMyEngine('p1', {provider: 'openai', model: 'gpt-4o-mini', mode: 'fast', connection_id: null});
    expect(apiClientMock).toHaveBeenLastCalledWith('/api/v1/projects/p1/llm-engine/me', {
      method: 'PUT',
      body: {provider: 'openai', model: 'gpt-4o-mini', mode: 'fast', connection_id: null},
    });
  });

  it('never throws across the boundary', async () => {
    apiClientMock.mockRejectedValueOnce(new Error('403'));
    expect((await setMyEngine('p1', {provider: 'openai', model: 'm', mode: 'fast', connection_id: null})).ok).toBe(false);
  });
});
