/**
 * Quality-Assessment end-to-end flow.
 *
 * Drives the full HITL pipeline through the UI for a single PROBAST/QUADAS-2
 * domain field:
 *   1. Open `POST /api/v1/hitl/sessions` with kind=quality_assessment (clones template + creates instances
 *      + parks Run in PROPOSAL).
 *   2. Visit /projects/{pid}/articles/{aid}/quality-assessment/{globalTemplateId}.
 *   3. Verify the form rendered and the Publish button is wired.
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
    await expect(page.getByTestId("qa-publish-button")).toBeVisible();
  });

  test("Publish assessment finalizes the run", async ({ page, request }) => {
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

    // Inject a single proposal so Publish has something to manual_override.
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

    // Visit the page, click Publish. The button is disabled when there's
    // nothing filled, so we need to type into a field first.
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

    const publishButton = page.getByTestId("qa-publish-button");
    await expect(publishButton).toBeEnabled({ timeout: 5000 });
    await publishButton.click();

    // Once finalized the badge appears and the button label changes.
    await expect(page.getByTestId("qa-finalized-badge")).toBeVisible({
      timeout: 30000,
    });

    // Reload — finalized state survives.
    await page.reload();
    await expect(page.getByTestId("qa-finalized-badge")).toBeVisible({
      timeout: 20000,
    });

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

    // And there's at least one PublishedState row from the manual_override
    // we just clicked through.
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
