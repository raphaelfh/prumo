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

import {setLlmEngine} from '@/services/llmEngineService';
import {t} from '@/lib/copy';

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
