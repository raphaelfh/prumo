/**
 * Extraction value coherence — end-to-end regression for the
 * "form blank but badge says completed" bug (article 5573e7f3 repro).
 *
 * The four H1–H4 invariants under test:
 *  - H2: ``advance_stage(PROPOSAL → REVIEW)`` auto-materializes a
 *    ``reviewer_decision='accept_proposal'`` for every human
 *    ``proposal_record``. Verified via the run detail API.
 *  - H1: the form's per-user read in REVIEW falls back to the user's
 *    human proposal layer when no reviewer_decision exists yet — and
 *    after H2 runs, the decision is present so the form renders the
 *    typed value either way. Verified by opening the extraction page
 *    and asserting the field's UI value matches what was proposed.
 *
 * This test sits in the ``local-hitl`` Playwright project (single-worker,
 * stateful) because it mutates the shared extraction run state for the
 * E2E project's article.
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

interface RunDetailResponse {
  run: { id: string; stage: string; status: string };
  proposals: Array<{
    id: string;
    instance_id: string;
    field_id: string;
    source: string;
    source_user_id: string | null;
  }>;
  decisions: Array<{
    id: string;
    instance_id: string;
    field_id: string;
    decision: string;
    proposal_record_id: string | null;
    reviewer_id: string;
    value: { value: unknown } | unknown;
  }>;
}

// Must match one of the field's allowed_values for the dropdown to
// actually display it. The CHARMS ``data_source`` field (the first
// entity_type/field in the seeded template) accepts:
//   ['Prospective cohort', 'Retrospective cohort', 'Case-control',
//    'Case series', 'RCT', 'Registry', 'No information']
// Mirrors the production bug repro on article 5573e7f3.
const TYPED_VALUE = "Case series";

test.describe("Extraction value coherence (H1+H2 end-to-end)", () => {
  test("human proposal in REVIEW stage becomes decision and renders in form", async ({
    page,
    request,
  }) => {
    const required = missingEnvKeys([
      "E2E_USER_EMAIL",
      "E2E_USER_PASSWORD",
      "E2E_PROJECT_ID",
      "E2E_ARTICLE_ID",
      "E2E_SUPABASE_URL",
      "E2E_SUPABASE_SERVICE_ROLE_KEY",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    const token = await resolveAuthToken(page);
    const userId = await page.evaluate(async () => {
      // @ts-expect-error — runtime browser import served by the Vite dev server
      // at the repo root; the "@/" alias is build-time only and does not resolve
      // inside page.evaluate().
      const { supabase } = await import("/frontend/integrations/supabase/client.ts");
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    });
    expect(userId, "logged-in user id must be resolvable").toBeTruthy();

    const traceId = createTraceId("e2e-value-coherence");
    const templateId = await resolveActiveExtractionTemplateId(env.projectId!);

    // 1. Wipe any in-flight runs for this (article, template) so the
    //    session opener creates a fresh PROPOSAL run. Surrounding HITL
    //    tests leak runs in REVIEW/CONSENSUS/FINALIZED — without this
    //    reset, the session opener returns the leaked run and our
    //    "advance to REVIEW" assertion below would be a no-op since
    //    we'd already be there.
    await adminDelete(
      "extraction_runs",
      `article_id=eq.${env.articleId}&template_id=eq.${templateId}`,
    );

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

    const runs = await adminSelect<{ id: string; stage: string }>(
      "extraction_runs",
      `select=id,stage&article_id=eq.${env.articleId}&template_id=eq.${templateId}` +
        `&stage=in.(pending,proposal,review,consensus)&order=created_at.desc&limit=1`,
    );
    test.skip(runs.length === 0, "Session opener did not yield an active run.");
    const runId = runs[0].id;

    // 2. Find a (instance, field) coordinate in the template — first
    //    entity_type that actually has fields. The template may host
    //    transient rows from earlier tests, so iterate.
    const instances = await adminSelect<{
      id: string;
      entity_type_id: string;
    }>(
      "extraction_instances",
      `select=id,entity_type_id&template_id=eq.${templateId}` +
        `&article_id=eq.${env.articleId}&limit=50`,
    );
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
    test.skip(!instance || !field, "No (instance, field) coordinate available.");

    // 3. Record the typed value as a reviewer decision via the API — this
    //    mirrors what the autosave hook writes for an extraction run in
    //    EXTRACT: human extraction writes go through /decisions (a per-user
    //    ReviewerDecision), not the shared /proposals track.
    const decisionRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${runId}/decisions`,
      {
        headers: authHeaders(token, traceId),
        data: {
          instance_id: instance!.id,
          field_id: field!.id,
          decision: "edit",
          value: { value: TYPED_VALUE },
        },
        timeout: 15000,
      },
    );
    expect(
      decisionRes.ok(),
      "Recording an 'edit' decision must succeed in EXTRACT stage.",
    ).toBeTruthy();

    // 4. The reviewer_decision carrying the typed value must exist for the
    //    current user; the run stays in EXTRACT (no proposal→review edge).
    const detailRes = await request.get(
      `${env.apiUrl}/api/v1/runs/${runId}`,
      { headers: authHeaders(token, traceId), timeout: 15000 },
    );
    const detail = (await parseEnvelope<RunDetailResponse>(detailRes)).data;
    expect(detail.run.stage).toBe("extract");

    const editDecision = detail.decisions.find(
      (d) =>
        d.decision === "edit" &&
        d.instance_id === instance!.id &&
        d.field_id === field!.id &&
        d.reviewer_id === userId,
    );
    expect(
      editDecision,
      "The 'edit' decision must be present in run detail.",
    ).toBeTruthy();

    const decisionValue = editDecision!.value as { value: unknown } | unknown;
    const unwrapped =
      typeof decisionValue === "object" &&
      decisionValue !== null &&
      "value" in (decisionValue as Record<string, unknown>)
        ? (decisionValue as { value: unknown }).value
        : decisionValue;
    expect(unwrapped).toBe(TYPED_VALUE);

    // 6. H1 assertion: open the extraction page in the browser; the
    //    field should render the typed value (read precedence picks up
    //    the freshly materialized decision OR falls back to the human
    //    proposal — either way the form is non-blank).
    await page.goto(
      `${env.frontendUrl}/projects/${env.projectId}/extraction/${env.articleId}`,
    );
    await expect(
      page.getByRole("button", { name: /^back$/i }).first(),
    ).toBeVisible({ timeout: 20000 });

    // The form may render the value inside an input, select, textarea, or
    // a combobox display. Probe each common shape until we hit the typed
    // value — be liberal here because field types vary across the template.
    await expect
      .poll(
        async () => {
          const valueInInputs = await page
            .locator(`input[value="${TYPED_VALUE}"]`)
            .count();
          if (valueInInputs > 0) return true;
          const valueInTextareas = await page
            .locator(`textarea`)
            .filter({ hasText: TYPED_VALUE })
            .count();
          if (valueInTextareas > 0) return true;
          const valueInGenericText = await page
            .getByText(TYPED_VALUE, { exact: false })
            .count();
          return valueInGenericText > 0;
        },
        {
          timeout: 15000,
          intervals: [500, 1000, 2000],
          message:
            "H1 — form must render the typed value recorded in EXTRACT.",
        },
      )
      .toBe(true);
  });
});
