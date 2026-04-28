/**
 * Extraction reopen UI E2E (HITL Option C, mirror of qa-reopen).
 *
 * Same Option C mechanic as `qa-reopen.ui.e2e.ts`, but on the extraction
 * page (data-extraction template, not Quality Assessment). Drives:
 *   1. A run advanced through PROPOSAL → REVIEW → CONSENSUS → FINALIZED.
 *   2. The extraction page renders the "Published" badge + the
 *      "Reopen for revision" button (because no active run remains).
 *   3. Clicking the button calls `/runs/{id}/reopen`, the new run
 *      lands in REVIEW, and the page now shows the "Revision" badge
 *      keyed off `run.parameters.parent_run_id`.
 *
 * Skips when env doesn't include an article+template ready for
 * extraction.
 */

import { expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { loginViaUi, resolveAuthToken } from "../_fixtures/auth";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";
import { adminSelect } from "../_fixtures/supabase-admin";

interface RunSummaryResponse {
  id: string;
  stage: string;
}

test.describe("Extraction reopen UI flow", () => {
  test("finalize → Published badge + Reopen button → Revision badge", async ({
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
    const traceId = createTraceId("e2e-extraction-reopen");

    // Resolve a (instance, field) coordinate.
    const instances = await adminSelect<{ id: string; entity_type_id: string }>(
      "extraction_instances",
      `select=id,entity_type_id&template_id=eq.${env.templateId}&article_id=eq.${env.articleId}&limit=1`,
    );
    test.skip(
      instances.length === 0,
      "No extraction_instances seeded — needs an article with extraction set up",
    );
    const instance = instances[0];

    const fields = await adminSelect<{ id: string; name: string }>(
      "extraction_fields",
      `select=id,name&entity_type_id=eq.${instance.entity_type_id}&limit=1`,
    );
    test.skip(fields.length === 0, "No fields under entity_type");
    const field = fields[0];

    // Build a run, drive it to FINALIZED so the page lands in the
    // "no active run, but a finalized one exists" state.
    const createRes = await request.post(`${env.apiUrl}/api/v1/runs`, {
      headers: authHeaders(token, traceId),
      data: {
        project_id: env.projectId,
        article_id: env.articleId,
        project_template_id: env.templateId,
      },
      timeout: 15000,
    });
    expect(createRes.ok()).toBeTruthy();
    const run = (await parseEnvelope<RunSummaryResponse>(createRes)).data;

    for (const stage of ["proposal", "review", "consensus"] as const) {
      const adv = await request.post(
        `${env.apiUrl}/api/v1/runs/${run.id}/advance`,
        {
          headers: authHeaders(token, traceId),
          data: { target_stage: stage },
          timeout: 15000,
        },
      );
      expect(adv.ok()).toBeTruthy();
    }

    // Publish via manual_override so PublishedState gets a row.
    const consensusRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${run.id}/consensus`,
      {
        headers: authHeaders(token, traceId),
        data: {
          instance_id: instance.id,
          field_id: field.id,
          mode: "manual_override",
          value: { value: "extraction-reopen-seed" },
          rationale: "E2E reopen seed",
        },
        timeout: 15000,
      },
    );
    expect(consensusRes.ok()).toBeTruthy();

    await request.post(`${env.apiUrl}/api/v1/runs/${run.id}/advance`, {
      headers: authHeaders(token, traceId),
      data: { target_stage: "finalized" },
      timeout: 15000,
    });

    // Visit the extraction page. The HITL banner should render the
    // Published badge + the Reopen button.
    await page.goto(
      `${env.frontendUrl}/projects/${env.projectId}/extraction/${env.articleId}`,
    );
    await expect(page.getByTestId("extraction-hitl-banner")).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByTestId("extraction-finalized-badge")).toBeVisible();
    const reopenButton = page.getByTestId("extraction-reopen-button");
    await expect(reopenButton).toBeVisible();
    await expect(reopenButton).toBeEnabled();

    // Click reopen — banner re-renders with Revision badge once the
    // useExtractedValues + useFinalizedExtractionRun refetches land.
    await reopenButton.click();

    await expect(page.getByTestId("extraction-revision-badge")).toBeVisible({
      timeout: 20000,
    });

    // Sanity via API: the latest non-terminal run for this triple has
    // parent_run_id pointing at the original.
    const newRuns = await adminSelect<{
      id: string;
      stage: string;
      parameters: Record<string, unknown> | null;
    }>(
      "extraction_runs",
      `select=id,stage,parameters&article_id=eq.${env.articleId}&template_id=eq.${env.templateId}` +
        `&stage=in.(pending,proposal,review,consensus)&order=created_at.desc&limit=1`,
    );
    expect(newRuns.length).toBe(1);
    expect(newRuns[0].id).not.toBe(run.id);
    expect(newRuns[0].stage).toBe("review");
    expect(
      (newRuns[0].parameters as Record<string, unknown>).parent_run_id,
    ).toBe(run.id);
  });
});
