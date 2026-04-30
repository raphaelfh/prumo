import { expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

test.describe("Zotero integration endpoints", () => {
  test("returns 400 when sync-collection payload is invalid", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys(["E2E_AUTH_TOKEN"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const response = await request.post(`${env.apiUrl}/api/v1/zotero/sync-collection`, {
      headers: authHeaders(env.authToken!, createTraceId("e2e-zotero-invalid")),
      data: {},
    });
    expect([400, 422]).toContain(response.status());
  });

  test("returns 404 for non-existing sync status id", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys(["E2E_AUTH_TOKEN"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const response = await request.post(`${env.apiUrl}/api/v1/zotero/sync-status`, {
      headers: authHeaders(env.authToken!, createTraceId("e2e-zotero-status-404")),
      data: {
        syncRunId: "00000000-0000-0000-0000-000000000000",
      },
    });
    expect([404, 400]).toContain(response.status());
  });

  test("runs credential + connection flow when Zotero env is configured", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys([
      "E2E_AUTH_TOKEN",
      "E2E_ZOTERO_USER_ID",
      "E2E_ZOTERO_API_KEY",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const saveResponse = await request.post(`${env.apiUrl}/api/v1/zotero/save-credentials`, {
      headers: authHeaders(env.authToken!, createTraceId("e2e-zotero-save")),
      data: {
        zoteroUserId: process.env.E2E_ZOTERO_USER_ID,
        apiKey: process.env.E2E_ZOTERO_API_KEY,
        libraryType: process.env.E2E_ZOTERO_LIBRARY_TYPE || "user",
      },
    });
    expect(saveResponse.ok()).toBeTruthy();
    const saveBody = await parseEnvelope<Record<string, unknown>>(saveResponse);
    expect(saveBody.ok).toBeTruthy();

    const testConnection = await request.post(`${env.apiUrl}/api/v1/zotero/test-connection`, {
      headers: authHeaders(env.authToken!, createTraceId("e2e-zotero-connection")),
      data: {},
    });
    expect(testConnection.ok()).toBeTruthy();
    const connectionBody = await parseEnvelope<Record<string, unknown>>(testConnection);
    expect(connectionBody.ok).toBeTruthy();
  });
});
