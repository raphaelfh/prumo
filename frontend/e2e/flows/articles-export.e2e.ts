import { APIRequestContext, expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

async function waitForExportCompletion(input: {
  apiUrl: string;
  token: string;
  jobId: string;
  traceId: string;
  request: APIRequestContext;
}) {
  const inflight = new Set(["pending", "running", "retry"]);
  for (let idx = 0; idx < 30; idx += 1) {
    const statusResponse = await input.request.get(`${input.apiUrl}/api/v1/articles-export/status/${input.jobId}`, {
      headers: authHeaders(input.token, input.traceId),
    });
    expect(statusResponse.ok()).toBeTruthy();
    const statusBody = await parseEnvelope<{ status: string; downloadUrl?: string }>(statusResponse);
    expect(statusBody.ok).toBeTruthy();
    if (!inflight.has(statusBody.data.status)) {
      return statusBody.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return { status: "timeout" };
}

test.describe("Articles export async lifecycle", () => {
  test("starts async export and allows cancel endpoint", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys(["E2E_AUTH_TOKEN", "E2E_PROJECT_ID", "E2E_ARTICLE_ID"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const traceId = createTraceId("e2e-export-async");
    const createResponse = await request.post(`${env.apiUrl}/api/v1/articles-export`, {
      headers: authHeaders(env.authToken!, traceId),
      data: {
        project_id: env.projectId,
        article_ids: [env.articleId],
        formats: ["csv", "ris"],
        file_scope: "all",
      },
    });

    if (createResponse.status() === 503) {
      test.skip(true, "Queue unavailable (Redis/Celery down) for async export test.");
    }

    expect([202, 200]).toContain(createResponse.status());
    if (createResponse.status() === 200) {
      return;
    }

    const createBody = await parseEnvelope<{ job_id: string }>(createResponse);
    expect(createBody.ok).toBeTruthy();
    const jobId = createBody.data.job_id;
    expect(jobId).toBeTruthy();

    const finalStatus = await waitForExportCompletion({
      apiUrl: env.apiUrl,
      token: env.authToken!,
      jobId,
      traceId,
      request: request,
    });
    expect(["completed", "failed", "cancelled"]).toContain(finalStatus.status);

    const cancelResponse = await request.post(
      `${env.apiUrl}/api/v1/articles-export/status/${jobId}/cancel`,
      {
        headers: authHeaders(env.authToken!, traceId),
      }
    );
    expect(cancelResponse.ok()).toBeTruthy();
    const cancelBody = await parseEnvelope<{ cancelled: boolean }>(cancelResponse);
    expect(cancelBody.ok).toBeTruthy();
    expect(typeof cancelBody.data.cancelled).toBe("boolean");
    expect(cancelBody.data.cancelled).toBe(false);

    const deleteResponse = await request.delete(`${env.apiUrl}/api/v1/articles-export/status/${jobId}`, {
      headers: authHeaders(env.authToken!, traceId),
    });
    expect(deleteResponse.ok()).toBeTruthy();
    const deleteBody = await parseEnvelope<{ cancelled: boolean }>(deleteResponse);
    expect(deleteBody.ok).toBeTruthy();
    expect(typeof deleteBody.data.cancelled).toBe("boolean");
  });
});
