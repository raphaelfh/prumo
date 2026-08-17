/**
 * llmEngineService — per-project LLM engine read + write (C1b T5).
 *
 * The load-bearing contracts:
 * - fetchLlmEngine GETs the typed route and returns ErrorResult (never
 *   throws across the boundary — this is NOT parserSettingsService's
 *   pre-rules throwing style).
 * - setLlmEngine PUTs the catalogue pair with mode 'fast'.
 * - A rejected transport call surfaces as ok:false, so the chip can
 *   render nothing on the deploy-race 404 window.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {apiClientMock, ApiError} = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
      public traceId?: string,
      public details?: Record<string, unknown>,
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

import {fetchLlmEngine, setLlmEngine} from '@/services/llmEngineService';

const ENGINE_READ = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  mode: 'fast' as const,
  source: 'default' as const,
  retired: false,
  updated_by_name: null,
  updated_at: null,
  previous_model: null,
  catalog: [],
  availability: {openai: true, anthropic: false},
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchLlmEngine', () => {
  it('GETs /api/v1/projects/{id}/llm-engine and returns ok:true', async () => {
    apiClientMock.mockResolvedValue(ENGINE_READ);

    const result = await fetchLlmEngine('p1');

    expect(apiClientMock).toHaveBeenCalledWith('/api/v1/projects/p1/llm-engine');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.model).toBe('gpt-4o-mini');
  });

  it('returns ok:false (does not throw) when the route 404s', async () => {
    apiClientMock.mockRejectedValue(
      new ApiError('HTTP_ERROR', 'Not Found', 404),
    );

    const result = await fetchLlmEngine('p1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Not Found');
  });
});

describe('setLlmEngine', () => {
  it('PUTs the canonical pair with mode fast', async () => {
    apiClientMock.mockResolvedValue(ENGINE_READ);

    const result = await setLlmEngine('p1', {
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      mode: 'fast',
    });

    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/p1/llm-engine',
      {
        method: 'PUT',
        body: {provider: 'anthropic', model: 'claude-haiku-4-5', mode: 'fast'},
      },
    );
    expect(result.ok).toBe(true);
  });

  it('surfaces a refused write as ok:false', async () => {
    apiClientMock.mockRejectedValue(
      new ApiError('HTTP_ERROR', 'unknown model', 400),
    );

    const result = await setLlmEngine('p1', {
      provider: 'openai',
      model: 'nope',
      mode: 'fast',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('unknown model');
  });
});
