/**
 * republishTemplateVersion — the real wire shape, through the REAL apiClient.
 *
 * Every other suite mocks one layer too high for this bug to exist: the
 * service tests mock `apiClient`, the sheet tests mock the service. Between
 * them sits the seam that shipped broken in B-9b2b (#597): the service
 * pre-stringified the contract and `apiClient` stringified it again, so the
 * body FastAPI received was a JSON *string literal* — a guaranteed 422
 * (`model_attributes_type`) on every real publish, invisible to both mocked
 * layers. This suite intercepts at the fetch boundary (MSW) so the assertion
 * is on what actually crosses the wire: a JSON object, never a quoted string.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {http, HttpResponse} from 'msw';
import {server} from '../mocks/server';

// The real apiClient asks Supabase for the session token before every
// authenticated call — stub the session, not the client.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {session: {access_token: 'test-token'}},
      }),
    },
  },
}));

import {republishTemplateVersion} from '@/services/templateService';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const TEMPLATE_ID = '22222222-2222-2222-2222-222222222222';
const FINGERPRINT = 'a'.repeat(64);

describe('republishTemplateVersion — wire body (regression: #597 double-stringify)', () => {
  let received: unknown;

  beforeEach(() => {
    received = undefined;
    server.use(
      http.post(
        `*/api/v1/projects/${PROJECT_ID}/templates/${TEMPLATE_ID}/republish-version`,
        async ({request}) => {
          received = await request.json();
          return HttpResponse.json({
            ok: true,
            data: {
              version_id: '33333333-3333-3333-3333-333333333333',
              version: 2,
              changed: true,
              repinned_run_count: 0,
            },
          });
        },
      ),
    );
  });

  it('sends the contract as a JSON object, not a double-encoded string', async () => {
    const result = await republishTemplateVersion(PROJECT_ID, TEMPLATE_ID, {
      expected_fingerprint: FINGERPRINT,
      acknowledged: [{id: 'row:1', tier: 'destructive'}],
      note: null,
    });

    // A double-stringified body parses to a string — exactly what Pydantic
    // refuses with 422 model_attributes_type. The wire body must be the
    // object itself.
    expect(typeof received).toBe('object');
    expect(received).toEqual({
      expected_fingerprint: FINGERPRINT,
      acknowledged: [{id: 'row:1', tier: 'destructive'}],
      note: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.version).toBe(2);
  });
});
