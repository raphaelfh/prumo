/**
 * Quality-Assessment end-to-end flow.
 *
 * Drives the full HITL pipeline through the UI for a single PROBAST/QUADAS-2
 * domain field:
 *   1. Open `POST /api/v1/hitl/sessions` with kind=quality_assessment (clones template + creates instances
 *      + parks Run in EXTRACT).
 *   2. Visit /projects/{pid}/articles/{aid}/quality-assessment/{globalTemplateId}.
 *   3. Verify the form rendered and the staged header action is wired
 *      (Start consensus → Approve & finalize; extraction-HITL parity).
 *   4. Reload the page and verify the run + project_template_id are reused
 *      (idempotent session).
 *
 * Skips when the env doesn't carry the credentials + IDs needed to hit a
 * live stack. Pure read+write of state we own — does not call the LLM.
 */

import { expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { loginViaUi, resolveAuthToken } from "../_fixtures/auth";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

interface OpenSessionResponse {
  run_id: string;
  project_template_id: string;
  instances_by_entity_type: Record<string, string>;
}

test.describe("Quality Assessment HITL flow", () => {
  test("opens (and resumes) a QA session for an article + global QA template", async ({
    page,
    request,
  }) => {
    const required = missingEnvKeys([
      "E2E_USER_EMAIL",
      "E2E_USER_PASSWORD",
      "E2E_PROJECT_ID",
      "E2E_ARTICLE_ID",
      "E2E_QA_GLOBAL_TEMPLATE_ID",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    const qaTemplateId = process.env.E2E_QA_GLOBAL_TEMPLATE_ID!;

    await loginViaUi(page);
    const token = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-qa-flow");

    // 1. Open or resume the session via API. Idempotent on (project,
    //    article, global_template) — first call creates, second reuses.
    const sessionPayload = {
      kind: "quality_assessment",
      project_id: env.projectId,
      article_id: env.articleId,
      global_template_id: qaTemplateId,
    };
    const first = await request.post(`${env.apiUrl}/api/v1/hitl/sessions`, {
      headers: authHeaders(token, traceId),
      data: sessionPayload,
      timeout: 30000,
    });
    expect(first.ok()).toBeTruthy();
    const firstBody = await parseEnvelope<OpenSessionResponse>(first);
    expect(firstBody.ok).toBeTruthy();
    expect(firstBody.data.run_id).toBeTruthy();
    expect(firstBody.data.project_template_id).toBeTruthy();
    expect(Object.keys(firstBody.data.instances_by_entity_type).length).toBeGreaterThan(0);
    const runId = firstBody.data.run_id;

    const second = await request.post(`${env.apiUrl}/api/v1/hitl/sessions`, {
      headers: authHeaders(token, traceId),
      data: sessionPayload,
      timeout: 30000,
    });
    expect(second.ok()).toBeTruthy();
    const secondBody = await parseEnvelope<OpenSessionResponse>(second);
    expect(secondBody.data.run_id).toBe(runId);
    expect(secondBody.data.project_template_id).toBe(
      firstBody.data.project_template_id,
    );

    // 2. Visit the QA page and verify the form rendered.
    await page.goto(
      `${env.frontendUrl}/projects/${env.projectId}/articles/${env.articleId}/quality-assessment/${qaTemplateId}`,
    );
    await expect(page.getByTestId("qa-kind-badge")).toContainText("Quality Assessment");
    await expect(page.getByTestId("qa-form-panel")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("qa-domains")).toBeVisible({ timeout: 15000 });
    // The staged action lives in RunHeader.PrimaryAction — label depends on
    // role: "Start consensus" (manager) or "Finish assessment" (reviewer).
    await expect(
      page.getByRole("button", { name: /start consensus|finish assessment/i }).first(),
    ).toBeVisible();
  });

  test("Staged publish: Start consensus, then Approve & finalize", async ({ page, request }) => {
    const required = missingEnvKeys([
      "E2E_USER_EMAIL",
      "E2E_USER_PASSWORD",
      "E2E_PROJECT_ID",
      "E2E_ARTICLE_ID",
      "E2E_QA_GLOBAL_TEMPLATE_ID",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    const qaTemplateId = process.env.E2E_QA_GLOBAL_TEMPLATE_ID!;

    await loginViaUi(page);
    const token = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-qa-publish");

    // Set up a fresh session (or resume).
    const sessionRes = await request.post(`${env.apiUrl}/api/v1/hitl/sessions`, {
      headers: authHeaders(token, traceId),
      data: {
        kind: "quality_assessment",
        project_id: env.projectId,
        article_id: env.articleId,
        global_template_id: qaTemplateId,
      },
      timeout: 30000,
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = (await parseEnvelope<OpenSessionResponse>(sessionRes)).data;

    // A filled field autosaves as a reviewer decision — the agreed value
    // approve-finalize will publish.
    const [firstEntityTypeId, firstInstanceId] = Object.entries(
      session.instances_by_entity_type,
    )[0];

    // Pick a field belonging to that entity_type so coordinate_coherence
    // is satisfied.
    const fieldsRes = await request.get(
      `${env.apiUrl}/api/v1/runs/${session.run_id}`,
      { headers: authHeaders(token, traceId), timeout: 15000 },
    );
    expect(fieldsRes.ok()).toBeTruthy();

    // Visit the page and fill a field first — approve-finalize rejects a
    // run with zero decisions (EmptyFinalizeError), so publish something.
    await page.goto(
      `${env.frontendUrl}/projects/${env.projectId}/articles/${env.articleId}/quality-assessment/${qaTemplateId}`,
    );
    await expect(page.getByTestId("qa-form-panel")).toBeVisible({ timeout: 20000 });

    // Try to fill any visible select field; pick the first one. Different
    // QA templates have different field sets, so we don't hard-code a value.
    const selectTriggers = page.locator("[data-testid^='qa-domain-'] [role='combobox']");
    const visible = await selectTriggers.count();
    test.skip(visible === 0, "No select fields rendered for this template");
    await selectTriggers.first().click();
    await page
      .locator("[role='option']")
      .first()
      .click();

    // Staged flow (extraction parity): the manager opens consensus first —
    // the run must LAND on the consensus stage, never skip it.
    const startConsensus = page.getByRole("button", { name: /start consensus/i });
    await expect(startConsensus).toBeEnabled({ timeout: 5000 });
    await startConsensus.click();
    await expect(
      page.getByTestId("run-stage-current").filter({ hasText: /consensus/i }),
    ).toBeVisible({ timeout: 30000 });

    // Then Approve & finalize publishes the agreed value and finalizes
    // (single reviewer → no divergence → the gate is open).
    const qaRunUrl =
      `${env.frontendUrl}/projects/${env.projectId}/articles/${env.articleId}`
      + `/quality-assessment/${qaTemplateId}`;
    const approveButton = page.getByRole("button", { name: /approve & finalize/i });
    await expect(approveButton).toBeEnabled({ timeout: 5000 });
    await approveButton.click();

    // The article is done, so the screen leaves it: the next article in the
    // worklist, or the project's quality tab at end-of-queue (2026-08-22).
    await expect(page).not.toHaveURL(qaRunUrl, { timeout: 30000 });
    await expect(page).toHaveURL(
      new RegExp(`/projects/${env.projectId}(/articles/[^/]+/quality-assessment/|\\?tab=quality)`),
    );

    // Re-open the finalized run: the RunHeader RunStatus chip
    // (data-testid="run-stage-current") reads "Finalized", and survives a reload.
    await page.goto(qaRunUrl);
    await expect(
      page.getByTestId("run-stage-current").filter({ hasText: /finalized/i }),
    ).toBeVisible({ timeout: 30000 });

    await page.reload();
    await expect(
      page.getByTestId("run-stage-current").filter({ hasText: /finalized/i }),
    ).toBeVisible({ timeout: 20000 });

    // Confirm via API: run is in stage=finalized.
    const runRes = await request.get(`${env.apiUrl}/api/v1/runs/${session.run_id}`, {
      headers: authHeaders(token, traceId),
      timeout: 15000,
    });
    expect(runRes.ok()).toBeTruthy();
    const runBody = await parseEnvelope<{ run: { stage: string; status: string } }>(
      runRes,
    );
    expect(runBody.data.run.stage).toBe("finalized");
    expect(runBody.data.run.status).toBe("completed");

    // And there's at least one PublishedState row from the agreed value
    // approve-finalize just published.
    const detailRes = await request.get(`${env.apiUrl}/api/v1/runs/${session.run_id}`, {
      headers: authHeaders(token, traceId),
      timeout: 15000,
    });
    const detail = await parseEnvelope<{ published_states: Array<unknown> }>(detailRes);
    expect(detail.data.published_states.length).toBeGreaterThan(0);

    // Sanity: the run was created against the cloned project_template_id.
    expect(session.project_template_id).toBeTruthy();
    expect(firstEntityTypeId).toBeTruthy();
    expect(firstInstanceId).toBeTruthy();
  });
});
