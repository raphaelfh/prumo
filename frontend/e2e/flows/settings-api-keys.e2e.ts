import { expect, test } from "@playwright/test";

import { loginViaUi, resolveAuthToken } from "../_fixtures/auth";
import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

test.describe("Settings and API key flows", () => {
  test("opens settings page from authenticated route", async ({ page }) => {
    const required = missingEnvKeys(["E2E_USER_EMAIL", "E2E_USER_PASSWORD"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/settings`);
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("lists providers and runs API key CRUD lifecycle", async ({ request, page }) => {
    const env = loadE2EEnv();
    const token = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-api-keys");

    const providersResponse = await request.get(`${env.apiUrl}/api/v1/user-api-keys/providers`);
    expect(providersResponse.ok()).toBeTruthy();
    const providersBody = await parseEnvelope<{ providers: Array<{ id: string }> }>(providersResponse);
    expect(providersBody.ok).toBeTruthy();
    expect(providersBody.data.providers.length).toBeGreaterThan(0);

    const createResponse = await request.post(`${env.apiUrl}/api/v1/user-api-keys`, {
      headers: authHeaders(token, traceId),
      data: {
        provider: "openai",
        apiKey: "sk-e2e-fake-key-value-1234567890",
        keyName: "E2E temporary key",
        isDefault: false,
        validateKey: false,
      },
    });
    expect(createResponse.ok()).toBeTruthy();
    const createBody = await parseEnvelope<{ id: string }>(createResponse);
    expect(createBody.ok).toBeTruthy();
    const keyId = createBody.data.id;

    const listResponse = await request.get(`${env.apiUrl}/api/v1/user-api-keys`, {
      headers: authHeaders(token, traceId),
    });
    expect(listResponse.ok()).toBeTruthy();
    const listBody = await parseEnvelope<{ keys: Array<{ id: string }> }>(listResponse);
    expect(listBody.ok).toBeTruthy();
    expect(listBody.data.keys.some((key) => key.id === keyId)).toBeTruthy();

    const updateResponse = await request.patch(`${env.apiUrl}/api/v1/user-api-keys/${keyId}`, {
      headers: authHeaders(token, traceId),
      data: {
        isActive: false,
      },
    });
    expect(updateResponse.ok()).toBeTruthy();

    const validateResponse = await request.post(`${env.apiUrl}/api/v1/user-api-keys/${keyId}/validate`, {
      headers: authHeaders(token, traceId),
    });
    expect([200, 400, 401, 422]).toContain(validateResponse.status());

    const deleteResponse = await request.delete(`${env.apiUrl}/api/v1/user-api-keys/${keyId}`, {
      headers: authHeaders(token, traceId),
    });
    expect(deleteResponse.ok()).toBeTruthy();
  });
});
