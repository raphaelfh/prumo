import { expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

test.describe("Articles export validation flows", () => {
  test("rejects empty articleIds list", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys(["E2E_AUTH_TOKEN", "E2E_PROJECT_ID"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const response = await request.post(`${env.apiUrl}/api/v1/articles-export`, {
      headers: authHeaders(env.authToken!, createTraceId("e2e-articles-empty")),
      data: {
        project_id: env.projectId,
        article_ids: [],
        formats: ["csv"],
        file_scope: "none",
      },
    });

    expect([200, 400, 422]).toContain(response.status());
    const body = await parseEnvelope<unknown>(response);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBeTruthy();
  });

  test("rejects invalid file scope", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys(["E2E_AUTH_TOKEN", "E2E_PROJECT_ID", "E2E_ARTICLE_ID"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const response = await request.post(`${env.apiUrl}/api/v1/articles-export`, {
      headers: authHeaders(env.authToken!, createTraceId("e2e-articles-scope")),
      data: {
        project_id: env.projectId,
        article_ids: [env.articleId],
        formats: ["csv"],
        file_scope: "invalid_scope",
      },
    });

    expect([200, 400, 422]).toContain(response.status());
    const body = await parseEnvelope<unknown>(response);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBeTruthy();
  });

  test("runs sync metadata-only export for one article", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys(["E2E_AUTH_TOKEN", "E2E_PROJECT_ID", "E2E_ARTICLE_ID"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const response = await request.post(`${env.apiUrl}/api/v1/articles-export`, {
      headers: authHeaders(env.authToken!, createTraceId("e2e-articles-sync")),
      data: {
        project_id: env.projectId,
        article_ids: [env.articleId],
        formats: ["csv"],
        file_scope: "none",
      },
    });

    expect([200, 202]).toContain(response.status());
    if (response.status() === 202) {
      const body = await parseEnvelope<{ job_id: string }>(response);
      expect(body.ok).toBeTruthy();
      expect(body.data.job_id).toBeTruthy();
    } else {
      const contentType = response.headers()["content-type"] || "";
      expect(contentType.length).toBeGreaterThan(0);
    }
  });
});
