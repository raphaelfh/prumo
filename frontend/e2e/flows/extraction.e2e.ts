import { expect, test } from "@playwright/test";

import { loginViaUi, resolveAuthToken } from "../_fixtures/auth";
import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

test.describe("Extraction flow (UI + API)", () => {
  test("opens extraction fullscreen route", async ({ page }) => {
    const required = missingEnvKeys([
      "E2E_USER_EMAIL",
      "E2E_USER_PASSWORD",
      "E2E_PROJECT_ID",
      "E2E_ARTICLE_ID",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/projects/${env.projectId}/extraction/${env.articleId}`);
    await expect(page).toHaveURL(new RegExp(`/projects/${env.projectId}/extraction/${env.articleId}`));
  });

  test("runs model and section extraction through API", async ({ request, page }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys([
      "E2E_PROJECT_ID",
      "E2E_ARTICLE_ID",
      "E2E_TEMPLATE_ID",
      "E2E_ENTITY_TYPE_ID",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const token = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-extraction");

    const modelResponse = await request.post(`${env.apiUrl}/api/v1/extraction/models`, {
      headers: authHeaders(token, traceId),
      data: {
        projectId: env.projectId,
        articleId: env.articleId,
        templateId: env.templateId,
        model: process.env.E2E_MODEL_NAME || "gpt-4o-mini",
      },
      timeout: 180000,
    });
    expect(modelResponse.ok()).toBeTruthy();
    const modelBody = await parseEnvelope<{ extractionRunId: string }>(modelResponse);
    expect(modelBody.ok).toBeTruthy();
    expect(modelBody.data.extractionRunId).toBeTruthy();

    const sectionResponse = await request.post(`${env.apiUrl}/api/v1/extraction/sections`, {
      headers: authHeaders(token, traceId),
      data: {
        projectId: env.projectId,
        articleId: env.articleId,
        templateId: env.templateId,
        entityTypeId: env.entityTypeId,
        extractAllSections: false,
        model: process.env.E2E_MODEL_NAME || "gpt-4o-mini",
      },
      timeout: 180000,
    });
    expect(sectionResponse.ok()).toBeTruthy();
    const sectionBody = await parseEnvelope<{ extractionRunId: string }>(sectionResponse);
    expect(sectionBody.ok).toBeTruthy();
    expect(sectionBody.data.extractionRunId).toBeTruthy();
  });

  test("rejects section extraction when article id is invalid", async ({ request, page }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys(["E2E_PROJECT_ID", "E2E_TEMPLATE_ID", "E2E_ENTITY_TYPE_ID"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const token = await resolveAuthToken(page);
    const response = await request.post(`${env.apiUrl}/api/v1/extraction/sections`, {
      headers: authHeaders(token, createTraceId("e2e-extraction-invalid")),
      data: {
        projectId: env.projectId,
        articleId: "00000000-0000-0000-0000-000000000000",
        templateId: env.templateId,
        entityTypeId: env.entityTypeId,
        extractAllSections: false,
      },
    });

    expect([400, 404, 500]).toContain(response.status());
  });
});
