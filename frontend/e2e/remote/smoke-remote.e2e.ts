import { expect, test } from "@playwright/test";

import { loginViaUi, resolveAuthToken } from "../_fixtures/auth";
import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

test.describe("Remote smoke", () => {
  test("auth + extraction + unified queue smoke", async ({ page, request }) => {
    const required = missingEnvKeys([
      "E2E_FRONTEND_URL",
      "E2E_API_URL",
      "E2E_USER_EMAIL",
      "E2E_USER_PASSWORD",
      "E2E_PROJECT_ID",
      "E2E_ARTICLE_ID",
      "E2E_TEMPLATE_ID",
      "E2E_ENTITY_TYPE_ID",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    const token = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-remote-smoke");

    const extractionResponse = await request.post(`${env.apiUrl}/api/v1/extraction/sections`, {
      headers: authHeaders(token, traceId),
      data: {
        projectId: env.projectId,
        articleId: env.articleId,
        templateId: env.templateId,
        entityTypeId: env.entityTypeId,
        extractAllSections: false,
      },
      timeout: 180000,
    });
    expect(extractionResponse.ok()).toBeTruthy();
    const extractionBody = await parseEnvelope<{ extractionRunId: string }>(extractionResponse);
    expect(extractionBody.ok).toBeTruthy();

    // /api/v1/review-queue was 008-only and was deleted along with the
    // evaluation_* endpoints. The new HITL flow exposes per-Run state via
    // /api/v1/runs/{id}; smoke can re-introduce a queue check once a
    // Run-aggregation endpoint exists. For now, just confirm the new
    // route returns the expected 404 envelope for a known-bad id.
    const probeResponse = await request.get(
      `${env.apiUrl}/api/v1/runs/00000000-0000-0000-0000-000000000000`,
      { headers: authHeaders(token, traceId) },
    );
    expect([404, 422]).toContain(probeResponse.status());
    const probeBody = await parseEnvelope<unknown>(probeResponse);
    expect(probeBody.ok).toBe(false);
    expect(probeBody.trace_id).toBeTruthy();
  });
});
