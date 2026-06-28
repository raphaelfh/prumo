import { APIRequestContext, expect, test } from "@playwright/test";

import { loginViaUi, resolveAuthToken } from "../_fixtures/auth";
import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";
import {
  resolveActiveExtractionTemplateId,
  resolveStudySectionEntityTypeId,
} from "../_fixtures/supabase-admin";

// Section extraction is async: POST returns 202 + { job_id }; the result is
// fetched by polling GET /extraction/sections/status/{job_id}. Mirrors the
// extraction-export poll helper (flows/extraction-export.e2e.ts).
type SectionJobStatus = {
  status: string;
  result?: { extractionRunId?: string } | null;
  error?: string | null;
};

async function pollSectionJob(input: {
  request: APIRequestContext;
  apiUrl: string;
  jobId: string;
  token: string;
  traceId: string;
}): Promise<SectionJobStatus> {
  const inflight = new Set(["pending", "running"]);
  const maxIters = 90; // ~180s at 2s intervals — matches the old sync timeout budget
  for (let idx = 0; idx < maxIters; idx += 1) {
    const res = await input.request.get(
      `${input.apiUrl}/api/v1/extraction/sections/status/${input.jobId}`,
      { headers: authHeaders(input.token, input.traceId) },
    );
    expect(res.ok()).toBeTruthy();
    const body = await parseEnvelope<SectionJobStatus>(res);
    expect(body.ok).toBeTruthy();
    if (!inflight.has(body.data.status)) {
      return body.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return { status: "timeout" };
}

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
    test.skip(!process.env.E2E_RUN_LLM_TESTS, "LLM extraction is opt-in: set E2E_RUN_LLM_TESTS=1 (and OPENAI_API_KEY) to run.");
    const env = loadE2EEnv();
    const required = missingEnvKeys(["E2E_PROJECT_ID", "E2E_ARTICLE_ID"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const token = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-extraction");
    const templateId = await resolveActiveExtractionTemplateId(env.projectId!);
    const entityTypeId = await resolveStudySectionEntityTypeId(templateId);

    const modelResponse = await request.post(`${env.apiUrl}/api/v1/extraction/models`, {
      headers: authHeaders(token, traceId),
      data: {
        projectId: env.projectId,
        articleId: env.articleId,
        templateId,
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
        templateId,
        entityTypeId,
        extractAllSections: false,
        model: process.env.E2E_MODEL_NAME || "gpt-4o-mini",
      },
    });
    expect(sectionResponse.status()).toBe(202);
    const sectionDispatch = await parseEnvelope<{ job_id: string }>(sectionResponse);
    expect(sectionDispatch.ok).toBeTruthy();
    expect(sectionDispatch.data.job_id).toBeTruthy();

    const sectionJob = await pollSectionJob({
      request,
      apiUrl: env.apiUrl,
      jobId: sectionDispatch.data.job_id,
      token,
      traceId,
    });
    expect(
      sectionJob.status,
      `section job did not complete: ${sectionJob.error ?? "n/a"}`,
    ).toBe("completed");
    expect(sectionJob.result?.extractionRunId).toBeTruthy();
  });

  test("section extraction enqueues an async job (202) or 503 when the queue is down", async ({
    request,
    page,
  }) => {
    // Section extraction is async now: the endpoint validates + authorises, then
    // enqueues a Celery job and returns 202 + { job_id }. Article-existence is
    // resolved inside the job (surfaced via the status poll), not synchronously
    // at the endpoint — so a non-existent article id is accepted here and fails
    // later in the worker. A well-formed, authorised request therefore yields
    // 202 (queue up) or 503 (queue down) — mirrors the extraction-export e2e.
    const env = loadE2EEnv();
    const required = missingEnvKeys(["E2E_PROJECT_ID"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const token = await resolveAuthToken(page);
    const templateId = await resolveActiveExtractionTemplateId(env.projectId!);
    const entityTypeId = await resolveStudySectionEntityTypeId(templateId);
    const response = await request.post(`${env.apiUrl}/api/v1/extraction/sections`, {
      headers: authHeaders(token, createTraceId("e2e-extraction-dispatch")),
      data: {
        projectId: env.projectId,
        articleId: "00000000-0000-0000-0000-000000000000",
        templateId,
        entityTypeId,
        extractAllSections: false,
      },
    });

    expect([202, 503]).toContain(response.status());
    if (response.status() === 202) {
      const body = await parseEnvelope<{ job_id: string }>(response);
      expect(body.ok).toBeTruthy();
      expect(body.data.job_id).toBeTruthy();
    }
  });
});
