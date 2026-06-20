/**
 * E2E coverage for the extraction Excel export feature
 * (009-extraction-excel-export).
 *
 * The spec is split into two suites:
 *
 *   1. **API surface** — calls the three new routes directly with a
 *      pre-seeded JWT. Verifies the OpenAPI contract is honoured end
 *      to end (envelopes, status codes, auth gates, sync inline path,
 *      async dispatch path). Runs even without UI seeding because it
 *      uses the existing `E2E_*` env vars.
 *
 *   2. **UI flow** — drives the actual dialog on the Data Extraction
 *      page in three modes (Consensus / Single user / All users) plus
 *      the optional AI metadata sheet. Skips automatically if the
 *      required seeded resource ids are missing.
 *
 * Required env (see `frontend/e2e/_fixtures/env.ts`):
 *   * E2E_AUTH_TOKEN  — pre-seeded JWT for the manager user
 *   * E2E_USER_EMAIL  + E2E_USER_PASSWORD  — login creds (UI mode)
 *   * E2E_PROJECT_ID, E2E_TEMPLATE_ID  — seeded resources
 *   * E2E_ARTICLE_ID  — at least one finalized article
 */

import { APIRequestContext, Locator, Page, expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { loginViaUi } from "../_fixtures/auth";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

/**
 * Log in, open the Data Extraction tab, and return the (visible) export toolbar
 * button. The cold first load must resolve the project's active template before
 * the toolbar — and this button — renders; on the ephemeral CI stack that can
 * exceed Playwright's default 5s actionability timeout, so wait generously here
 * instead of letting each case race it. (The describe is already `serial` to
 * dodge the parallel-login auth rate limit.)
 */
async function openExportTab(
  page: Page,
  env: ReturnType<typeof loadE2EEnv>,
): Promise<Locator> {
  await loginViaUi(page);
  await page.goto(`${env.frontendUrl}/projects/${env.projectId}?tab=extraction`);
  const exportBtn = page.getByTestId("extraction-export-button");
  await expect(exportBtn).toBeVisible({ timeout: 20000 });
  return exportBtn;
}

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function pollUntilTerminal(input: {
  apiUrl: string;
  projectId: string;
  jobId: string;
  token: string;
  traceId: string;
  request: APIRequestContext;
}) {
  const inflight = new Set(["pending", "running", "retry"]);
  const maxIters = 15;
  for (let idx = 0; idx < maxIters; idx += 1) {
    const res = await input.request.get(
      `${input.apiUrl}/api/v1/projects/${input.projectId}/extraction-export/status/${input.jobId}`,
      { headers: authHeaders(input.token, input.traceId) },
    );
    expect(res.ok()).toBeTruthy();
    const body = await parseEnvelope<{ status: string; download_url?: string }>(res);
    expect(body.ok).toBeTruthy();
    if (!inflight.has(body.data.status)) {
      return body.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return { status: "timeout" };
}

// ---------------------------------------------------------------------
// 1. API surface — pure HTTP, no UI
// ---------------------------------------------------------------------

test.describe("Extraction export — API surface", () => {
  test("OpenAPI exposes the four extraction-export routes", async ({ request }) => {
    const env = loadE2EEnv();
    const res = await request.get(`${env.apiUrl}/api/v1/openapi.json`);
    expect(res.ok()).toBeTruthy();
    const schema = await res.json();
    const paths = Object.keys(schema.paths ?? {});
    expect(paths).toContain(
      "/api/v1/projects/{project_id}/extraction-export",
    );
    expect(paths).toContain(
      "/api/v1/projects/{project_id}/extraction-export/status/{job_id}",
    );
    expect(paths).toContain(
      "/api/v1/projects/{project_id}/extraction-export/status/{job_id}/cancel",
    );
    expect(paths).toContain(
      "/api/v1/projects/{project_id}/extraction-export/reviewers",
    );
  });

  test("non-member call returns 403 with the envelope error.message", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys(["E2E_AUTH_TOKEN", "E2E_TEMPLATE_ID"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const stranger = "00000000-0000-0000-0000-deadbeef0000"; // not a project we belong to
    const traceId = createTraceId("e2e-export-403");
    const res = await request.post(
      `${env.apiUrl}/api/v1/projects/${stranger}/extraction-export`,
      {
        headers: authHeaders(env.authToken!, traceId),
        data: {
          template_id: env.templateId,
          mode: "consensus",
          article_scope: "current_list",
          article_ids: ["00000000-0000-0000-0000-000000000001"],
        },
      },
    );
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("FORBIDDEN");
    // Constitution §VIII — frontend reads `error.message`, never `detail`.
    expect(typeof body.error?.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  test("single_user mode without reviewer_id returns 400 VALIDATION_ERROR", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys([
      "E2E_AUTH_TOKEN",
      "E2E_PROJECT_ID",
      "E2E_TEMPLATE_ID",
      "E2E_ARTICLE_ID",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const res = await request.post(
      `${env.apiUrl}/api/v1/projects/${env.projectId}/extraction-export`,
      {
        headers: authHeaders(env.authToken!, createTraceId("e2e-export-400")),
        data: {
          template_id: env.templateId,
          mode: "single_user",
          // reviewer_id intentionally omitted
          article_scope: "current_list",
          article_ids: [env.articleId],
        },
      },
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });

  test("consensus sync export returns 200 .xlsx OR 422 when no finalized articles", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys([
      "E2E_AUTH_TOKEN",
      "E2E_PROJECT_ID",
      "E2E_TEMPLATE_ID",
      "E2E_ARTICLE_ID",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const traceId = createTraceId("e2e-export-consensus");
    const res = await request.post(
      `${env.apiUrl}/api/v1/projects/${env.projectId}/extraction-export`,
      {
        headers: authHeaders(env.authToken!, traceId),
        data: {
          template_id: env.templateId,
          mode: "consensus",
          article_scope: "current_list",
          article_ids: [env.articleId],
          include_ai_metadata: false,
          anonymize_reviewer_names: false,
        },
      },
    );

    // The seed may not include a finalized Run; in that case the
    // endpoint returns 422 EMPTY_ELIGIBLE_ARTICLES which is correct
    // and documented behaviour.
    if (res.status() === 422) {
      const body = await res.json();
      expect(body.error?.code).toBe("EMPTY_ELIGIBLE_ARTICLES");
      return;
    }

    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain(XLSX_MIME);
    expect(res.headers()["content-disposition"]).toMatch(
      /attachment; filename=".+\.xlsx"/,
    );
    const buf = await res.body();
    expect(buf.length).toBeGreaterThan(100);
    // Bytes start with the ZIP magic number.
    expect(buf.slice(0, 4).toString("hex")).toBe("504b0304");
  });

  test("reviewers picker endpoint returns an array", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys([
      "E2E_AUTH_TOKEN",
      "E2E_PROJECT_ID",
      "E2E_TEMPLATE_ID",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const res = await request.get(
      `${env.apiUrl}/api/v1/projects/${env.projectId}/extraction-export/reviewers?template_id=${env.templateId}`,
      { headers: authHeaders(env.authToken!, createTraceId("e2e-export-rev")) },
    );
    expect(res.ok()).toBeTruthy();
    const body = await parseEnvelope<Array<{ id: string; name: string }>>(res);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("AI metadata toggle dispatches an async job (202) or skips when queue is down", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys([
      "E2E_AUTH_TOKEN",
      "E2E_PROJECT_ID",
      "E2E_TEMPLATE_ID",
      "E2E_ARTICLE_ID",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const traceId = createTraceId("e2e-export-ai");
    const res = await request.post(
      `${env.apiUrl}/api/v1/projects/${env.projectId}/extraction-export`,
      {
        headers: authHeaders(env.authToken!, traceId),
        data: {
          template_id: env.templateId,
          mode: "consensus",
          article_scope: "current_list",
          article_ids: [env.articleId],
          include_ai_metadata: true,
        },
      },
    );

    if (res.status() === 503) {
      test.skip(true, "Queue unavailable (Redis/Celery down) for async test.");
    }
    if (res.status() === 422) {
      // No finalized runs — endpoint correctly refuses. Test passes.
      return;
    }
    expect(res.status()).toBe(202);
    const body = await parseEnvelope<{ job_id: string }>(res);
    expect(body.ok).toBe(true);
    expect(typeof body.data.job_id).toBe("string");

    const finalStatus = await pollUntilTerminal({
      apiUrl: env.apiUrl,
      projectId: env.projectId!,
      jobId: body.data.job_id,
      token: env.authToken!,
      traceId,
      request,
    });
    test.skip(
      finalStatus.status === "timeout",
      "Async export did not progress — Celery worker likely not running.",
    );
    expect(["completed", "failed", "cancelled"]).toContain(finalStatus.status);
  });
});

// ---------------------------------------------------------------------
// 2. UI flow — drives the dialog
// ---------------------------------------------------------------------

test.describe("Extraction export — UI flow", () => {
  // Serial: every case logs the same owner in via the UI. Run in parallel and
  // the concurrent password-grant logins trip Supabase's local auth rate limit,
  // leaving a blank page where the export toolbar should be (matches the serial
  // guard on extraction-navigation for the same reason).
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async () => {
    const required = missingEnvKeys([
      "E2E_USER_EMAIL",
      "E2E_USER_PASSWORD",
      "E2E_PROJECT_ID",
    ]);
    test.skip(
      required.length > 0,
      `Missing required env for UI flow: ${required.join(", ")}`,
    );
  });

  test("the legacy Export Data entry is gone; the dialog is the single entry point", async ({
    page,
  }) => {
    const env = loadE2EEnv();
    // The consolidated entry point is the toolbar export button (the legacy
    // "Export Data" More-menu item was removed; that source-level guard lives
    // in the HeaderMoreMenu component test).
    const exportBtn = await openExportTab(page, env);
    // No legacy "Export Data" affordance is reachable on this view.
    await expect(
      page.getByRole("menuitem", { name: /Export Data/i }),
    ).toHaveCount(0);

    // The single dialog opens from the toolbar button.
    await exportBtn.click();
    await expect(page.getByText(/Export extraction data/i)).toBeVisible();
  });

  test("dialog opens with defaults and shows live preview", async ({ page }) => {
    const env = loadE2EEnv();
    const exportBtn = await openExportTab(page, env);
    await exportBtn.click();

    // Dialog opens.
    await expect(page.getByText(/Export extraction data/i)).toBeVisible();
    // Defaults: Consensus + Current list selected; AI off; anonymize hidden.
    await expect(page.getByLabel("Consensus")).toBeChecked();
    await expect(page.getByLabel(/Current list/i)).toBeChecked();
    await expect(
      page.getByLabel(/Include AI metadata sheet/i),
    ).not.toBeChecked();
    await expect(
      page.getByLabel(/Anonymize reviewer names/i),
    ).not.toBeVisible();
    // Live preview line is visible whenever the article count > 0.
    await expect(
      page.getByTestId("extraction-export-preview"),
    ).toBeVisible();
  });

  test("Single-user mode reveals the reviewer control", async ({ page }) => {
    const env = loadE2EEnv();
    const exportBtn = await openExportTab(page, env);
    await exportBtn.click();
    await page.getByLabel(/Single user/i).check();

    // Single-user mode resolves to exactly one of three mutually exclusive
    // states: a manager's reviewer picker, a reviewer's locked-to-self label,
    // or the empty state when no reviewer has eligible data yet (the ephemeral
    // seed has none — empty state added in #302). `.or()` auto-retries and
    // never races on a non-retrying isVisible() (the old Promise.race resolved
    // to whichever check settled first, flaking to null when the rendered
    // element's check lost the race).
    const reviewerControl = page
      .getByTestId("extraction-export-reviewer-picker")
      .or(page.getByTestId("extraction-export-reviewer-locked"))
      .or(page.getByTestId("extraction-export-reviewer-empty"));
    await expect(reviewerControl).toBeVisible();
  });

  test("All-users mode reveals the anonymize-reviewer toggle for managers", async ({ page }) => {
    const env = loadE2EEnv();
    const exportBtn = await openExportTab(page, env);
    await exportBtn.click();
    const allUsers = page.getByLabel(/All users/i);
    // Non-managers see it disabled; managers can tick it.
    const disabled = await allUsers.isDisabled();
    if (disabled) {
      test.info().annotations.push({
        type: "skip-reason",
        description: "Current user is not a manager — All-users disabled.",
      });
      return;
    }
    await allUsers.check();
    await expect(
      page.getByLabel(/Anonymize reviewer names/i),
    ).toBeVisible();
  });

  test("Cancel button closes the dialog without dispatching", async ({ page }) => {
    const env = loadE2EEnv();
    const exportBtn = await openExportTab(page, env);
    await exportBtn.click();
    await expect(page.getByText(/Export extraction data/i)).toBeVisible();
    await page.getByRole("button", { name: /Cancel/i }).click();
    await expect(page.getByText(/Export extraction data/i)).not.toBeVisible();
  });

  test("Empty-scope guard: Selected only is disabled when nothing is ticked", async ({ page }) => {
    const env = loadE2EEnv();
    const exportBtn = await openExportTab(page, env);
    await exportBtn.click();
    const selected = page.getByLabel(/Selected only/i);
    // When no articles ticked, the radio is disabled per FR-005.
    await expect(selected).toBeDisabled();
  });
});
