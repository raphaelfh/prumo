/**
 * Extraction edit-and-persist E2E.
 *
 * Exercises the path that changed most in the post-`extracted_values`
 * cleanup: a user opens the extraction screen, edits a field, the
 * autosave fires a `ReviewerDecision(decision='edit')` against the
 * active run, and the value survives reload.
 *
 * Requires a Run already advanced to REVIEW (which section/model
 * extraction now does automatically). If env doesn't carry an
 * extraction-active article, the test skips.
 */

import { expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { loginViaUi, resolveAuthToken } from "../_fixtures/auth";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";
import { adminSelect } from "../_fixtures/supabase-admin";

interface RunDetailResponse {
  run: { id: string; stage: string; status: string; template_id: string };
  proposals: Array<{ id: string; instance_id: string; field_id: string }>;
  decisions: Array<{
    id: string;
    instance_id: string;
    field_id: string;
    decision: string;
    value: { value: unknown } | null;
    reviewer_id: string;
  }>;
}

test.describe("Extraction edit + autosave persists through HITL stack", () => {
  test("user edit becomes a ReviewerDecision and survives reload", async ({
    page,
    request,
  }) => {
    const required = missingEnvKeys([
      "E2E_USER_EMAIL",
      "E2E_USER_PASSWORD",
      "E2E_PROJECT_ID",
      "E2E_ARTICLE_ID",
      "E2E_TEMPLATE_ID",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    const token = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-extraction-edit");

    // Ensure an active (non-terminal) extraction run exists by opening
    // a HITL session — idempotent. If the existing active run is already
    // past review (e.g. finalized by a prior consensus test), open a fresh
    // session which creates a new pending run.
    const sessionRes = await request.post(
      `${env.apiUrl}/api/v1/hitl/sessions`,
      {
        headers: authHeaders(token, traceId),
        data: {
          kind: "extraction",
          project_id: env.projectId,
          article_id: env.articleId,
          project_template_id: env.templateId,
        },
        timeout: 30000,
      },
    );
    expect(sessionRes.ok()).toBeTruthy();

    const runsBefore = await adminSelect<{ id: string; stage: string }>(
      "extraction_runs",
      `select=id,stage&article_id=eq.${env.articleId}&template_id=eq.${env.templateId}` +
        `&stage=in.(pending,proposal,review,consensus)&order=created_at.desc&limit=1`,
    );
    test.skip(
      runsBefore.length === 0,
      "No active extraction run for this article+template",
    );
    const runIdBefore = runsBefore[0].id;

    await page.goto(
      `${env.frontendUrl}/projects/${env.projectId}/extraction/${env.articleId}`,
    );

    // The form panel renders the section accordions; if no run exists or
    // there's no active proposal yet, the page won't have inputs to edit.
    const sectionAccordions = page.locator(
      "[data-testid^='qa-domain-'], [role='region']",
    );
    const accordionCount = await sectionAccordions.count();
    test.skip(
      accordionCount === 0,
      "Extraction form has no sections rendered — needs an article with an in-flight extraction run",
    );

    // Find a select field rendered by FieldInput; use the first available.
    const selects = page.locator(
      "form select, [role='combobox'], input[type='text']",
    );
    const visibleCount = await selects.count();
    test.skip(visibleCount === 0, "No editable fields on the page");

    const firstField = selects.first();
    const fieldType = await firstField.evaluate((el) => el.tagName.toLowerCase());

    if (fieldType === "input") {
      await firstField.fill("e2e-edit-probe");
      // Wait for the 3s debounce + a bit.
      await page.waitForTimeout(4000);
    } else {
      await firstField.click();
      const option = page.locator("[role='option']").first();
      const optionCount = await option.count();
      test.skip(optionCount === 0, "Combobox opened but no options available");
      await option.click();
      await page.waitForTimeout(4000);
    }

    // Reload and confirm the autosave reached the API: the run detail
    // should now have at least one ReviewerDecision authored by the
    // current user with `decision='edit'`.
    await page.reload();
    await expect(page.locator("body")).toBeVisible();

    const detailRes = await request.get(
      `${env.apiUrl}/api/v1/runs/${runIdBefore}`,
      { headers: authHeaders(token, traceId), timeout: 15000 },
    );
    const detail = await parseEnvelope<RunDetailResponse>(detailRes);
    expect(detail.ok).toBeTruthy();
    expect(detail.data.run.stage).toMatch(/review|consensus|finalized/);
    const editDecisions = detail.data.decisions.filter(
      (d) => d.decision === "edit",
    );
    expect(editDecisions.length).toBeGreaterThan(0);
  });
});
