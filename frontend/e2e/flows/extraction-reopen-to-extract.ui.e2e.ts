/**
 * Extraction reopen-to-extract UI E2E (ADR-0017).
 *
 * The arbitrator-only BACKWARD transition (distinct from the finalized "Reopen
 * for revision" fork in extraction-reopen.ui.e2e.ts): a run in CONSENSUS with
 * resolved consensus work is sent back to EXTRACT, in place, via the "Reopen
 * extraction" header menu item + a destructive confirm, discarding the run's
 * ExtractionConsensusDecision + ExtractionPublishedState rows. Drives:
 *   1. A run advanced EXTRACT → CONSENSUS with one published (manual_override)
 *      coordinate, so consensus_decisions + published_states rows exist.
 *   2. The extraction page renders the Consensus stage node; the overflow Menu
 *      exposes "Reopen extraction" (arbitrator + consensus only).
 *   3. Confirming the destructive dialog calls POST /runs/{id}/reopen-extraction;
 *      the SAME run returns to EXTRACT and its consensus rows are cleared.
 *
 * Skips when env doesn't include an article+template ready for extraction.
 */

import { expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { loginViaUi, resolveAuthToken } from "../_fixtures/auth";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";
import {
  adminDelete,
  adminSelect,
  resolveActiveExtractionTemplateId,
} from "../_fixtures/supabase-admin";

interface RunSummaryResponse {
  id: string;
  stage: string;
}

test.describe("Extraction reopen-to-extract UI flow", () => {
  test("consensus + resolved coord → Reopen extraction → back in EXTRACT, consensus cleared", async ({
    page,
    request,
  }) => {
    const required = missingEnvKeys([
      "E2E_USER_EMAIL",
      "E2E_USER_PASSWORD",
      "E2E_PROJECT_ID",
      "E2E_ARTICLE_ID",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    const token = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-reopen-to-extract");
    const templateId = await resolveActiveExtractionTemplateId(env.projectId!);

    // Reset extraction runs for the triple, seed instances via a session, then
    // reset again so the run we build below is the only one the page latches onto.
    const resetRuns = () =>
      adminDelete(
        "extraction_runs",
        `project_id=eq.${env.projectId}&article_id=eq.${env.articleId}&kind=eq.extraction`,
      );
    await resetRuns();
    await request.post(`${env.apiUrl}/api/v1/hitl/sessions`, {
      headers: authHeaders(token, traceId),
      data: {
        kind: "extraction",
        project_id: env.projectId,
        article_id: env.articleId,
        project_template_id: templateId,
      },
      timeout: 30000,
    });
    await resetRuns();

    // Resolve a (instance, field) coordinate that actually has fields.
    const instances = await adminSelect<{ id: string; entity_type_id: string }>(
      "extraction_instances",
      `select=id,entity_type_id&template_id=eq.${templateId}&article_id=eq.${env.articleId}&limit=50`,
    );
    test.skip(instances.length === 0, "No extraction_instances seeded");

    let instance: { id: string; entity_type_id: string } | null = null;
    let field: { id: string; name: string } | null = null;
    for (const inst of instances) {
      const fs = await adminSelect<{ id: string; name: string }>(
        "extraction_fields",
        `select=id,name&entity_type_id=eq.${inst.entity_type_id}&limit=1`,
      );
      if (fs.length > 0) {
        instance = inst;
        field = fs[0];
        break;
      }
    }
    test.skip(!instance || !field, "No (instance, field) coordinate available");
    if (!instance || !field) throw new Error("unreachable: test.skip guards above");

    // Build a run, advance EXTRACT → CONSENSUS, publish one coordinate so a
    // ConsensusDecision + PublishedState exist (the "resolved" work to discard).
    const createRes = await request.post(`${env.apiUrl}/api/v1/runs`, {
      headers: authHeaders(token, traceId),
      data: {
        project_id: env.projectId,
        article_id: env.articleId,
        project_template_id: templateId,
      },
      timeout: 15000,
    });
    expect(createRes.ok()).toBeTruthy();
    const run = (await parseEnvelope<RunSummaryResponse>(createRes)).data;

    for (const stage of ["extract", "consensus"] as const) {
      const adv = await request.post(`${env.apiUrl}/api/v1/runs/${run.id}/advance`, {
        headers: authHeaders(token, traceId),
        data: { target_stage: stage },
        timeout: 15000,
      });
      expect(adv.ok()).toBeTruthy();
    }

    const consensusRes = await request.post(`${env.apiUrl}/api/v1/runs/${run.id}/consensus`, {
      headers: authHeaders(token, traceId),
      data: {
        instance_id: instance.id,
        field_id: field.id,
        mode: "manual_override",
        value: { value: "reopen-to-extract-seed" },
        rationale: "E2E reopen-to-extract seed",
      },
      timeout: 15000,
    });
    expect(consensusRes.ok()).toBeTruthy();

    // Precondition: the consensus decision exists before the reopen.
    const before = await adminSelect<{ id: string }>(
      "extraction_consensus_decisions",
      `select=id&run_id=eq.${run.id}`,
    );
    expect(before.length).toBe(1);

    // Visit the extraction page — the run is in CONSENSUS.
    await page.goto(
      `${env.frontendUrl}/projects/${env.projectId}/extraction/${env.articleId}`,
    );
    await expect(
      page.getByRole("button", { name: /^back$/i }).first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByTestId("run-stage-current").filter({ hasText: /consensus/i }),
    ).toBeVisible({ timeout: 20000 });

    // Overflow Menu (MoreHorizontal, aria-label "More options") → "Reopen extraction".
    const moreMenu = page.getByRole("button", { name: /more options/i });
    await expect(moreMenu).toBeVisible({ timeout: 10000 });
    await moreMenu.click();
    const reopenItem = page.getByRole("menuitem", { name: /reopen extraction/i });
    await expect(reopenItem).toBeVisible();
    await reopenItem.click();

    // Destructive AlertDialog: one resolved coord → "Reopen & discard".
    const confirm = page.getByRole("button", { name: /reopen.*discard/i });
    await expect(confirm).toBeVisible({ timeout: 10000 });
    await confirm.click();

    // The SAME run returns to EXTRACT; the stage node updates to Extraction.
    await expect(
      page.getByTestId("run-stage-current").filter({ hasText: /extract/i }),
    ).toBeVisible({ timeout: 20000 });

    // API sanity: same run id, stage=extract, consensus + published rows cleared.
    const after = await adminSelect<{ id: string; stage: string }>(
      "extraction_runs",
      `select=id,stage&id=eq.${run.id}`,
    );
    expect(after.length).toBe(1);
    expect(after[0].stage).toBe("extract");
    expect(
      (
        await adminSelect<{ id: string }>(
          "extraction_consensus_decisions",
          `select=id&run_id=eq.${run.id}`,
        )
      ).length,
    ).toBe(0);
    expect(
      (
        await adminSelect<{ id: string }>(
          "extraction_published_states",
          `select=id&run_id=eq.${run.id}`,
        )
      ).length,
    ).toBe(0);
  });
});
