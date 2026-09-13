import {expect, test} from '@playwright/test';

import {authHeaders, parseEnvelope} from '../_fixtures/api';
import {loginViaUi, resolveAuthToken} from '../_fixtures/auth';
import {createTraceId, loadE2EEnv, missingEnvKeys} from '../_fixtures/env';

test.describe('Settings and AI connection flows', () => {
  test('opens the Integrations tab with the AI connections section', async ({page}) => {
    const required = missingEnvKeys(['E2E_USER_EMAIL', 'E2E_USER_PASSWORD']);
    test.skip(required.length > 0, `Missing required env: ${required.join(', ')}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/settings?tab=integrations`);
    await expect(page.getByRole('heading', {name: 'AI connections'})).toBeVisible();
  });

  test('lists providers and runs the connection lifecycle', async ({request, page}) => {
    const env = loadE2EEnv();
    const token = await resolveAuthToken(page);
    const traceId = createTraceId('e2e-connections');
    const headers = authHeaders(token, traceId);

    const providers = await request.get(`${env.apiUrl}/api/v1/me/providers`, {headers});
    expect(providers.ok()).toBeTruthy();
    const providersBody = await parseEnvelope<Array<{id: string; scopes: string[]}>>(providers);
    expect(providersBody.data.some((p) => p.id === 'openai')).toBeTruthy();

    const created = await request.post(`${env.apiUrl}/api/v1/me/connections`, {
      headers,
      data: {provider: 'openai', label: `E2E ${traceId}`, api_key: 'sk-e2e-fake-key-value-1234567890'},
    });
    expect(created.status()).toBe(201);
    const {data: row} = await parseEnvelope<{id: string; has_api_key: boolean}>(created);
    expect(row.has_api_key).toBe(true);

    const list = await request.get(`${env.apiUrl}/api/v1/me/connections`, {headers});
    const listBody = await parseEnvelope<Array<{id: string}>>(list);
    expect(listBody.data.some((c) => c.id === row.id)).toBeTruthy();

    // A failed probe is a typed `failed` result, never an error status.
    const verify = await request.post(`${env.apiUrl}/api/v1/me/connections/${row.id}/verify`, {headers});
    expect(verify.status()).toBe(200);

    const deleted = await request.delete(`${env.apiUrl}/api/v1/me/connections/${row.id}`, {headers});
    expect(deleted.ok()).toBeTruthy();
  });
});
