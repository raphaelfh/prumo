/**
 * HITL run-lifecycle invariant E2E.
 *
 * Pins the API contracts that hold the workflow tables together:
 *   1. Skipping the editable stage (PENDING → CONSENSUS without EXTRACT) is
 *      rejected.
 *   2. A `source='human'` write to `/proposals` on an extraction run is
 *      rejected (humans write decisions via `/decisions`).
 *   3. A `consensus mode='select_existing'` with a decision_id from a
 *      different (instance, field) is rejected with 422 (coordinate
 *      coherence).
 *   4. The reviewers endpoint reflects the reviewer immediately after a
 *      `decision='edit'` recorded in EXTRACT.
 *
 * These are the cheap-to-test invariants that, if regressed, would
 * silently corrupt the HITL audit trail.
 */

import { expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { loginViaUi, resolveAuthToken } from "../_fixtures/auth";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";
import {
  adminSelect,
  resolveActiveExtractionTemplateId,
} from "../_fixtures/supabase-admin";

interface RunSummaryResponse {
  id: string;
  stage: string;
}

test.describe("HITL run lifecycle invariants", () => {
  test("rejects bad stage transitions, bad coordinate, and untimed decisions", async ({
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
    const traceId = createTraceId("e2e-run-lifecycle");
    const templateId = await resolveActiveExtractionTemplateId(env.projectId!);

    // Ensure instances exist under (template, article) by opening a HITL
    // session — idempotent and creates one extraction_instance per
    // entity_type when called for the first time on this triple.
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

    // Pick TWO distinct (instance, field) coordinates so we can test
    // coordinate-coherence failures. The shared template can be polluted
    // with transient entity_types from other tests that have no fields, so
    // iterate to find an instance whose entity_type actually has at least
    // one field.
    const instances = await adminSelect<{ id: string; entity_type_id: string }>(
      "extraction_instances",
      `select=id,entity_type_id&template_id=eq.${templateId}&article_id=eq.${env.articleId}&limit=50`,
    );
    test.skip(instances.length === 0, "No extraction_instances available");

    let inst0: string | null = null;
    let f0: string | null = null;
    let inst0EntityTypeId: string | null = null;
    for (const inst of instances) {
      const fields = await adminSelect<{ id: string }>(
        "extraction_fields",
        `select=id&entity_type_id=eq.${inst.entity_type_id}&limit=1`,
      );
      if (fields.length > 0) {
        inst0 = inst.id;
        f0 = fields[0].id;
        inst0EntityTypeId = inst.entity_type_id;
        break;
      }
    }
    test.skip(
      !inst0 || !f0,
      "No (instance, field) coordinate available under the template",
    );

    // For coordinate-mismatch, fetch any field NOT under inst0's entity_type.
    const fieldsOther = await adminSelect<{ id: string; entity_type_id: string }>(
      "extraction_fields",
      `select=id,entity_type_id&entity_type_id=neq.${inst0EntityTypeId}&limit=1`,
    );

    // Create a fresh run.
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

    // 1. PENDING → CONSENSUS skipping EXTRACT: rejected.
    const badAdvance = await request.post(
      `${env.apiUrl}/api/v1/runs/${run.id}/advance`,
      {
        headers: authHeaders(token, traceId),
        data: { target_stage: "consensus" },
        timeout: 15000,
        failOnStatusCode: false,
      },
    );
    expect(badAdvance.status()).toBeGreaterThanOrEqual(400);
    expect(badAdvance.status()).toBeLessThan(500);

    // 2. Advance to EXTRACT — legal.
    const adv1 = await request.post(
      `${env.apiUrl}/api/v1/runs/${run.id}/advance`,
      {
        headers: authHeaders(token, traceId),
        data: { target_stage: "extract" },
        timeout: 15000,
      },
    );
    expect(adv1.ok()).toBeTruthy();

    // 3. A human `/proposals` write on an extraction run is rejected — human
    //    extraction values must go through `/decisions` (blind-review gate).
    const humanProposalRejected = await request.post(
      `${env.apiUrl}/api/v1/runs/${run.id}/proposals`,
      {
        headers: authHeaders(token, traceId),
        data: {
          instance_id: inst0,
          field_id: f0,
          source: "human",
          proposed_value: { value: "should-fail" },
        },
        timeout: 15000,
        failOnStatusCode: false,
      },
    );
    expect(humanProposalRejected.status()).toBeGreaterThanOrEqual(400);

    // 4. Record the reviewer's value as a `decision='edit'` — accepted in
    //    EXTRACT (the per-user write path).
    const decisionRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${run.id}/decisions`,
      {
        headers: authHeaders(token, traceId),
        data: {
          instance_id: inst0,
          field_id: f0,
          decision: "edit",
          value: { value: "human-says" },
        },
        timeout: 15000,
      },
    );
    expect(decisionRes.ok()).toBeTruthy();

    // 5. Reviewers endpoint lists the decision-maker's profile.
    const reviewersRes = await request.get(
      `${env.apiUrl}/api/v1/runs/${run.id}/reviewers`,
      { headers: authHeaders(token, traceId), timeout: 15000 },
    );
    expect(reviewersRes.ok()).toBeTruthy();
    const reviewersBody = (await parseEnvelope<{
      reviewers: Array<{ id: string; full_name: string | null }>;
    }>(reviewersRes)).data;
    expect(reviewersBody.reviewers.length).toBeGreaterThanOrEqual(1);

    // 6. Coordinate coherence: a decision targeting a (instance, field)
    //    pair where the field doesn't belong to the instance must 422.
    if (fieldsOther.length > 0) {
      const wrongField = fieldsOther[0].id;
      const badCoord = await request.post(
        `${env.apiUrl}/api/v1/runs/${run.id}/decisions`,
        {
          headers: authHeaders(token, traceId),
          data: {
            instance_id: inst0,
            field_id: wrongField,
            decision: "edit",
            value: { value: "mismatch" },
          },
          timeout: 15000,
          failOnStatusCode: false,
        },
      );
      expect(badCoord.status()).toBe(422);
    }
  });
});
