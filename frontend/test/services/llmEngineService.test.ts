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

import {toUpdateBody} from '@/lib/llmEngineUpdateBody';
import {fetchLlmEngine, setLlmEngine} from '@/services/llmEngineService';

import {makeEngineRead, makeEngineReadWire} from '../mocks/llmEngineRead';

/** Upstream of the service: the payload apiClient resolves with. */
const ENGINE_READ = makeEngineReadWire();

const ALTERNATE_READ = {
  provider: 'openai',
  model: 'gpt-4o',
  canonical: 'openai:gpt-4o',
  retired: false,
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

  it('flags hasAlternates when the wire payload carries the field', async () => {
    apiClientMock.mockResolvedValue({
      ...ENGINE_READ,
      alternates: [ALTERNATE_READ],
    });

    const result = await fetchLlmEngine('p1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.alternates).toEqual([ALTERNATE_READ]);
    expect(result.data.hasAlternates).toBe(true);
  });

  it('defaults alternates to [] with hasAlternates false when the wire omits the field (old backend)', async () => {
    const {alternates: _alternates, ...legacyPayload} = ENGINE_READ;
    apiClientMock.mockResolvedValue(legacyPayload);

    const result = await fetchLlmEngine('p1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.alternates).toEqual([]);
    expect(result.data.hasAlternates).toBe(false);
  });
});

describe('setLlmEngine', () => {
  it('PUTs the canonical pair with mode fast, passing alternates through verbatim', async () => {
    apiClientMock.mockResolvedValue(ENGINE_READ);

    const result = await setLlmEngine('p1', {
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      mode: 'fast',
      alternates: [{provider: 'openai', model: 'gpt-4o-mini'}],
    });

    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/p1/llm-engine',
      {
        method: 'PUT',
        body: {
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          mode: 'fast',
          alternates: [{provider: 'openai', model: 'gpt-4o-mini'}],
        },
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

describe('toUpdateBody', () => {
  const NORMALIZED = makeEngineRead({
    mode: 'verified',
    alternates: [{...ALTERNATE_READ, retired: true}],
  });

  it('includes stripped alternates and the explicit mode when the read carried the field', () => {
    const body = toUpdateBody(NORMALIZED);

    // toEqual is exact: canonical/retired stripped down to the pair.
    expect(body).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      mode: 'verified',
      alternates: [{provider: 'openai', model: 'gpt-4o'}],
    });
  });

  it('omits the alternates KEY entirely when the read lacked the field (old backend)', () => {
    const body = toUpdateBody({
      ...NORMALIZED,
      alternates: [],
      hasAlternates: false,
    });

    expect(body).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      mode: 'verified',
    });
    expect('alternates' in body).toBe(false);
  });

  it('spreads overrides over the read values, keeping the stored alternates', () => {
    const body = toUpdateBody(NORMALIZED, {model: 'gpt-4o', mode: 'fast'});

    expect(body).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
      mode: 'fast',
      alternates: [{provider: 'openai', model: 'gpt-4o'}],
    });
  });

  it('an explicit alternates override replaces the stored list', () => {
    const body = toUpdateBody(NORMALIZED, {alternates: []});

    expect(body).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      mode: 'verified',
      alternates: [],
    });
  });
});
