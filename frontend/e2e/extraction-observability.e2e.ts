import { APIRequestContext, expect, test } from "@playwright/test";

type RequiredEnvKey =
  | "E2E_USER_EMAIL"
  | "E2E_USER_PASSWORD"
  | "E2E_PROJECT_ID"
  | "E2E_ARTICLE_ID"
  | "E2E_TEMPLATE_ID"
  | "E2E_ENTITY_TYPE_ID";

const REQUIRED_ENV: RequiredEnvKey[] = [
  "E2E_USER_EMAIL",
  "E2E_USER_PASSWORD",
  "E2E_PROJECT_ID",
  "E2E_ARTICLE_ID",
  "E2E_TEMPLATE_ID",
  "E2E_ENTITY_TYPE_ID",
];

function getMissingEnv(): RequiredEnvKey[] {
  return REQUIRED_ENV.filter((key) => !process.env[key]);
}

function createTraceId(): string {
  return `e2e-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

async function fetchRunFromSupabase(runId: string) {
  const supabaseUrl = process.env.E2E_SUPABASE_URL;
  const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  const url = `${supabaseUrl}/rest/v1/extraction_runs?id=eq.${runId}&select=id,status,results,error_message`;
  const response = await fetch(url, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase REST query failed (${response.status})`);
  }

  const rows = (await response.json()) as Array<{
    id: string;
    status: string;
    results: Record<string, unknown> | null;
    error_message: string | null;
  }>;
  return rows[0] ?? null;
}

type SectionJobStatus = {
  status: string;
  result?: { extractionRunId?: string } | null;
  error?: string | null;
};

// Section extraction is async: POST returns 202 + { job_id }; poll
// GET /extraction/sections/status/{job_id} until the job reaches a terminal
// state. Mirrors the extraction-export poll helper.
async function pollSectionJob(
  request: APIRequestContext,
  apiBase: string,
  jobId: string,
  authToken: string,
  traceId: string
): Promise<SectionJobStatus> {
  const inflight = new Set(["pending", "running"]);
  const maxIters = 90; // ~180s at 2s intervals — matches the old sync timeout budget
  for (let idx = 0; idx < maxIters; idx += 1) {
    const res = await request.get(
      `${apiBase}/api/v1/extraction/sections/status/${jobId}`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "X-Trace-Id": traceId,
        },
      }
    );
    const body = (await res.json()) as {
      ok?: boolean;
      data?: SectionJobStatus;
    };
    const data = body.data;
    if (data?.status && !inflight.has(data.status)) {
      return data;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return { status: "timeout" };
}

test.describe("Extraction E2E Observability", () => {
  test("logs in via browser and executes model/section extraction", async ({
    page,
    request,
  }) => {
    const missingEnv = getMissingEnv();
    test.skip(
      missingEnv.length > 0,
      `Missing required env: ${missingEnv.join(", ")}`
    );

    await page.goto("/auth");
    await page.fill("#login-email", process.env.E2E_USER_EMAIL!);
    await page.fill("#login-password", process.env.E2E_USER_PASSWORD!);
    await page.locator("form button[type='submit']").click();
    await page.waitForURL(/\/$/, { timeout: 30000 });

    const authToken = await page.evaluate(() => {
      const storageEntries = Object.entries(localStorage);
      for (const [key, value] of storageEntries) {
        if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) {
          continue;
        }
        const parsed = JSON.parse(value) as unknown;
        if (
          parsed &&
          typeof parsed === "object" &&
          "currentSession" in parsed &&
          parsed.currentSession &&
          typeof parsed.currentSession === "object" &&
          "access_token" in parsed.currentSession &&
          typeof parsed.currentSession.access_token === "string"
        ) {
          return parsed.currentSession.access_token;
        }
        if (
          parsed &&
          typeof parsed === "object" &&
          "access_token" in parsed &&
          typeof parsed.access_token === "string"
        ) {
          return parsed.access_token;
        }
      }
      return null;
    });

    expect(authToken, "Supabase access token not found after login").toBeTruthy();

    const traceId = createTraceId();
    const apiBase = process.env.E2E_API_URL || "http://127.0.0.1:8000";

    const modelPayload = {
      projectId: process.env.E2E_PROJECT_ID!,
      articleId: process.env.E2E_ARTICLE_ID!,
      templateId: process.env.E2E_TEMPLATE_ID!,
      model: process.env.E2E_MODEL_NAME || "gpt-4o-mini",
    };

    const modelStart = Date.now();
    const modelResponse = await request.post(`${apiBase}/api/v1/extraction/models`, {
      data: modelPayload,
      headers: {
        Authorization: `Bearer ${authToken}`,
        "X-Trace-Id": traceId,
        "Content-Type": "application/json",
      },
      timeout: 180000,
    });
    const modelDurationMs = Date.now() - modelStart;

    const modelBody = (await modelResponse.json()) as {
      ok?: boolean;
      data?: { extractionRunId?: string };
      detail?: string;
      error?: { message?: string };
    };
    const modelRunId = modelBody.data?.extractionRunId;

    const sectionPayload = {
      projectId: process.env.E2E_PROJECT_ID!,
      articleId: process.env.E2E_ARTICLE_ID!,
      templateId: process.env.E2E_TEMPLATE_ID!,
      entityTypeId: process.env.E2E_ENTITY_TYPE_ID!,
      extractAllSections: false,
      model: process.env.E2E_MODEL_NAME || "gpt-4o-mini",
    };

    // Section extraction is async: POST dispatches a Celery job (202 + job_id);
    // the run id is read from the completed job status, not the POST response.
    const sectionStart = Date.now();
    const sectionResponse = await request.post(
      `${apiBase}/api/v1/extraction/sections`,
      {
        data: sectionPayload,
        headers: {
          Authorization: `Bearer ${authToken}`,
          "X-Trace-Id": traceId,
          "Content-Type": "application/json",
        },
      }
    );
    const sectionDispatchMs = Date.now() - sectionStart;

    const sectionDispatchBody = (await sectionResponse.json()) as {
      ok?: boolean;
      data?: { job_id?: string };
      detail?: string;
      error?: { message?: string };
    };
    const sectionJobId = sectionDispatchBody.data?.job_id;

    expect(
      sectionResponse.status(),
      `section dispatch failed: status=${sectionResponse.status()} detail=${sectionDispatchBody.detail || sectionDispatchBody.error?.message || "n/a"}`
    ).toBe(202);
    expect(sectionDispatchBody.ok).toBeTruthy();
    expect(sectionJobId).toBeTruthy();

    const pollStart = Date.now();
    const sectionJob: SectionJobStatus = sectionJobId
      ? await pollSectionJob(request, apiBase, sectionJobId, authToken!, traceId)
      : { status: "no-job" };
    const sectionPollMs = Date.now() - pollStart;

    expect(
      sectionJob.status,
      `section job did not complete: ${sectionJob.error ?? "n/a"}`
    ).toBe("completed");
    const sectionRunId = sectionJob.result?.extractionRunId;
    expect(sectionRunId).toBeTruthy();

    const modelRun = modelRunId ? await fetchRunFromSupabase(modelRunId) : null;
    const sectionRun = sectionRunId ? await fetchRunFromSupabase(sectionRunId) : null;

    if (modelRun) {
      expect(modelRun.status).toBe("completed");
      expect(modelRun.results).toBeTruthy();
    }
    if (sectionRun) {
      expect(sectionRun.status).toBe("completed");
      expect(sectionRun.results).toBeTruthy();
    }

    expect(
      modelResponse.ok(),
      `model extraction failed: status=${modelResponse.status()} detail=${modelBody.detail || modelBody.error?.message || "n/a"}`
    ).toBeTruthy();
    expect(modelBody.ok).toBeTruthy();
    expect(modelRunId).toBeTruthy();

    test.info().annotations.push({
      type: "timing",
      description: `model_api_ms=${modelDurationMs}, model_status=${modelResponse.status()}, section_dispatch_ms=${sectionDispatchMs}, section_poll_ms=${sectionPollMs}, section_status=${sectionResponse.status()}, trace_id=${traceId}`,
    });

    console.warn(
      `[E2E extraction baseline] trace_id=${traceId} model_status=${modelResponse.status()} model_api_ms=${modelDurationMs} section_status=${sectionResponse.status()} section_dispatch_ms=${sectionDispatchMs} section_poll_ms=${sectionPollMs}`
    );
  });
});
