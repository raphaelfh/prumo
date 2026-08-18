/**
 * llmEndpointService — project custom-endpoint CRUD + verify (C2 C1).
 *
 * The load-bearing contracts:
 * - every call routes through the typed apiClient and returns
 *   `ErrorResult` (never throws across the boundary, never toasts);
 * - the five routes are pinned exactly (the manager-only surface is the
 *   ONLY caller, so a path typo has no second witness);
 * - the update body carries `api_key` VERBATIM — the tri-state (`null`
 *   keeps the stored key, `""` clears it, a string sets it) is the
 *   service's to transport, not to interpret;
 * - a refused write (409 "an engine points here", 404 on an old backend
 *   without the routes) surfaces as ok:false carrying the typed message.
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

import {
  createLlmEndpoint,
  deleteLlmEndpoint,
  fetchLlmEndpoints,
  updateLlmEndpoint,
  verifyLlmEndpoint,
} from '@/services/llmEndpointService';

import {makeEndpointRead} from '../mocks/llmEndpointRead';

const ENDPOINT = makeEndpointRead();
const ENDPOINT_ID = ENDPOINT.id;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchLlmEndpoints', () => {
  it('GETs /api/v1/projects/{id}/llm-endpoints and returns ok:true', async () => {
    apiClientMock.mockResolvedValue([ENDPOINT]);

    const result = await fetchLlmEndpoints('p1');

    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/p1/llm-endpoints',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([ENDPOINT]);
  });

  it('returns ok:false (does not throw) when the route 404s', async () => {
    apiClientMock.mockRejectedValue(
      new ApiError('HTTP_ERROR', 'Not Found', 404),
    );

    const result = await fetchLlmEndpoints('p1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Not Found');
  });
});

describe('createLlmEndpoint', () => {
  it('POSTs the explicit field set', async () => {
    apiClientMock.mockResolvedValue(ENDPOINT);

    const result = await createLlmEndpoint('p1', {
      label: 'Lab vLLM',
      base_url: 'https://llm.lab.example.org/v1',
      allowed_models: ['qwen3-30b'],
      api_key: 'sk-secret',
    });

    expect(apiClientMock).toHaveBeenCalledWith(
      '/api/v1/projects/p1/llm-endpoints',
      {
        method: 'POST',
        body: {
          label: 'Lab vLLM',
          base_url: 'https://llm.lab.example.org/v1',
          allowed_models: ['qwen3-30b'],
          api_key: 'sk-secret',
        },
      },
    );
    expect(result.ok).toBe(true);
  });

  it('surfaces a rejected create as ok:false', async () => {
    apiClientMock.mockRejectedValue(
      new ApiError('VALIDATION_ERROR', 'private address rejected', 400),
    );

    const result = await createLlmEndpoint('p1', {
      label: 'Local',
      base_url: 'http://localhost:11434/v1',
      allowed_models: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('private address rejected');
  });
});

describe('updateLlmEndpoint', () => {
  it('PUTs /{endpoint_id} carrying api_key: null (keep the stored key)', async () => {
    apiClientMock.mockResolvedValue(ENDPOINT);

    await updateLlmEndpoint('p1', ENDPOINT_ID, {
      label: 'Lab vLLM',
      base_url: 'https://llm.lab.example.org/v1',
      allowed_models: ['qwen3-30b'],
      api_key: null,
    });

    expect(apiClientMock).toHaveBeenCalledWith(
      `/api/v1/projects/p1/llm-endpoints/${ENDPOINT_ID}`,
      {
        method: 'PUT',
        body: {
          label: 'Lab vLLM',
          base_url: 'https://llm.lab.example.org/v1',
          allowed_models: ['qwen3-30b'],
          api_key: null,
        },
      },
    );
  });

  it('PUTs api_key: "" verbatim (clear the stored key)', async () => {
    apiClientMock.mockResolvedValue({...ENDPOINT, has_api_key: false});

    const result = await updateLlmEndpoint('p1', ENDPOINT_ID, {
      label: 'Lab vLLM',
      base_url: 'https://llm.lab.example.org/v1',
      allowed_models: ['qwen3-30b'],
      api_key: '',
    });

    const body = apiClientMock.mock.calls[0][1].body as Record<string, unknown>;
    // Empty string, not stripped to undefined: "" is the CLEAR signal and
    // the service must not collapse it into "keep".
    expect(body.api_key).toBe('');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.has_api_key).toBe(false);
  });
});

describe('deleteLlmEndpoint', () => {
  it('DELETEs /{endpoint_id} and returns the delete result', async () => {
    apiClientMock.mockResolvedValue({deleted: true, id: ENDPOINT_ID});

    const result = await deleteLlmEndpoint('p1', ENDPOINT_ID);

    expect(apiClientMock).toHaveBeenCalledWith(
      `/api/v1/projects/p1/llm-endpoints/${ENDPOINT_ID}`,
      {method: 'DELETE'},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({deleted: true, id: ENDPOINT_ID});
  });

  it('surfaces the typed 409 (an engine points at this endpoint)', async () => {
    apiClientMock.mockRejectedValue(
      new ApiError(
        'ENDPOINT_IN_USE',
        'The project engine runs on this endpoint. Point it elsewhere first.',
        409,
      ),
    );

    const result = await deleteLlmEndpoint('p1', ENDPOINT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('The project engine runs on this');
  });
});

describe('verifyLlmEndpoint', () => {
  it('POSTs /{endpoint_id}/verify and returns the probe result', async () => {
    apiClientMock.mockResolvedValue({
      validation_status: 'ok',
      output_mode: 'tool',
      models_seen: ['qwen3-30b'],
      error: null,
    });

    const result = await verifyLlmEndpoint('p1', ENDPOINT_ID);

    expect(apiClientMock).toHaveBeenCalledWith(
      `/api/v1/projects/p1/llm-endpoints/${ENDPOINT_ID}/verify`,
      {method: 'POST'},
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.output_mode).toBe('tool');
  });

  it('a FAILED probe is still ok:true — the sanitized reason rides the payload', async () => {
    // The probe answering "this endpoint is broken" is a successful call;
    // only a transport/authorization failure is an ErrorResult.
    apiClientMock.mockResolvedValue({
      validation_status: 'failed',
      output_mode: null,
      models_seen: [],
      error: 'connection refused',
    });

    const result = await verifyLlmEndpoint('p1', ENDPOINT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.validation_status).toBe('failed');
    expect(result.data.error).toBe('connection refused');
  });
});
