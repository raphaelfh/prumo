/**
 * llmEngineService — deploy-window contract (§5 Verified, panel B3).
 *
 * A PUT against an OLD backend (pre-widening) rejects `mode: "verified"`
 * with FastAPI's raw 422 `{"detail": [...]}` body — a shape the client's
 * `error.message` chain deliberately misses (the app envelope carries
 * `error.message`, never `detail`). The service must surface the GENERIC
 * error, never leak the detail chain, and never throw across the boundary.
 *
 * Separate from llmEngineService.test.ts on purpose: that file mocks
 * `@/integrations/api/client` file-wide, while this one runs the REAL
 * client against MSW so the actual 422 parse path is exercised.
 */
import {describe, expect, it, vi} from 'vitest';
import {http, HttpResponse} from 'msw';

import {server} from '../mocks/server';

// apiClient reads the Supabase session at module scope; the real client
// would crash jsdom without env and hit the MSW auth gate.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: {session: {access_token: 'test-token'}},
      })),
    },
  },
}));

import {
  fetchLlmEngine,
  setLlmEngine,
  toUpdateBody,
} from '@/services/llmEngineService';
import {t} from '@/lib/copy';

/** Old-backend read payload: pre-C2, no `alternates` key on the wire. */
const LEGACY_READ = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  mode: 'fast' as const,
  source: 'default' as const,
  retired: false,
  updated_by_name: null,
  updated_at: null,
  previous_model: null,
  catalog: [],
  availability: {openai: true},
};

describe('setLlmEngine — old-backend 422 detail body (panel B3)', () => {
  it('returns the generic error, never leaking the FastAPI detail chain', async () => {
    server.use(
      http.put('*/api/v1/projects/p1/llm-engine', () =>
        HttpResponse.json(
          {
            detail: [
              {
                type: 'literal_error',
                loc: ['body', 'mode'],
                msg: "Input should be 'fast'",
              },
            ],
          },
          {status: 422},
        ),
      ),
    );

    const result = await setLlmEngine('p1', {
      provider: 'openai',
      model: 'gpt-4o-mini',
      mode: 'verified',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.message).toBe(t('common', 'errors_unknownError'));
    expect(result.error.message).not.toMatch(/literal_error|Input should be/);
  });
});

describe('alternates — old-backend read without the field (C2 A4)', () => {
  it('normalizes the read and the follow-up PUT body omits the alternates KEY', async () => {
    // An old backend with extra="forbid" 422s any unknown key, so a plain
    // model/mode change during the promotion window must not smuggle
    // `alternates` into the body — key ABSENT, not `alternates: undefined`.
    let capturedBody: unknown = null;
    server.use(
      http.get('*/api/v1/projects/p1/llm-engine', () =>
        HttpResponse.json({ok: true, data: LEGACY_READ}),
      ),
      http.put('*/api/v1/projects/p1/llm-engine', async ({request}) => {
        capturedBody = await request.json();
        return HttpResponse.json({ok: true, data: LEGACY_READ});
      }),
    );

    const read = await fetchLlmEngine('p1');
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error('unreachable');
    expect(read.data.alternates).toEqual([]);
    expect(read.data.hasAlternates).toBe(false);

    const result = await setLlmEngine(
      'p1',
      toUpdateBody(read.data, {model: 'gpt-4o'}),
    );

    expect(result.ok).toBe(true);
    const body = capturedBody as Record<string, unknown>;
    expect(body).toEqual({provider: 'openai', model: 'gpt-4o', mode: 'fast'});
    expect('alternates' in body).toBe(false);
  });
});
