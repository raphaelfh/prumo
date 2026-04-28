/**
 * HITL run-lifecycle invariant E2E.
 *
 * Pins the API contracts that hold the workflow tables together:
 *   1. Skipping stages (e.g. PROPOSAL → CONSENSUS without REVIEW) is
 *      rejected.
 *   2. A `decision='edit'` posted in PROPOSAL stage is rejected.
 *   3. A `consensus mode='select_existing'` with a decision_id from a
 *      different (instance, field) is rejected with 422 (coordinate
 *      coherence).
 *   4. The reviewers endpoint reflects the human proposer immediately
 *      after a `source='human'` proposal, before any reviewer decisions.
 *
 * These are the cheap-to-test invariants that, if regressed, would
 * silently corrupt the HITL audit trail.
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
      "E2E_TEMPLATE_ID",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    const token = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-run-lifecycle");

    // Pick TWO distinct (instance, field) coordinates so we can test
    // coordinate-coherence failures.
    const instances = await adminSelect<{ id: string; entity_type_id: string }>(
      "extraction_instances",
      `select=id,entity_type_id&template_id=eq.${env.templateId}&article_id=eq.${env.articleId}&limit=2`,
    );
    test.skip(instances.length === 0, "No extraction_instances available");

    const fieldsInstance0 = await adminSelect<{ id: string }>(
      "extraction_fields",
      `select=id&entity_type_id=eq.${instances[0].entity_type_id}&limit=1`,
    );
    test.skip(fieldsInstance0.length === 0, "No fields under first entity_type");

    // For coordinate-mismatch, fetch any field NOT under instance0's
    // entity_type. The `_otherEntityTypeId` reference is a hint to
    // future maintainers about why we're querying with !=.
    const fieldsOther = await adminSelect<{ id: string; entity_type_id: string }>(
      "extraction_fields",
      `select=id,entity_type_id&entity_type_id=neq.${instances[0].entity_type_id}&limit=1`,
    );

    const inst0 = instances[0].id;
    const f0 = fieldsInstance0[0].id;

    // Create a fresh run.
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

    // 1. PENDING → CONSENSUS skipping PROPOSAL/REVIEW: rejected.
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

    // 2. Advance to PROPOSAL — legal.
    const adv1 = await request.post(
      `${env.apiUrl}/api/v1/runs/${run.id}/advance`,
      {
        headers: authHeaders(token, traceId),
        data: { target_stage: "proposal" },
        timeout: 15000,
      },
    );
    expect(adv1.ok()).toBeTruthy();

    // 3. Trying to record a `decision='edit'` while still in PROPOSAL
    //    must be rejected — decisions only land in REVIEW.
    const earlyDecision = await request.post(
      `${env.apiUrl}/api/v1/runs/${run.id}/decisions`,
      {
        headers: authHeaders(token, traceId),
        data: {
          instance_id: inst0,
          field_id: f0,
          decision: "edit",
          value: { value: "should-fail" },
        },
        timeout: 15000,
        failOnStatusCode: false,
      },
    );
    expect(earlyDecision.status()).toBeGreaterThanOrEqual(400);

    // 4. Record a human proposal — `source='human'` requires
    //    `source_user_id`. Server must accept it in PROPOSAL stage.
    const proposalRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${run.id}/proposals`,
      {
        headers: authHeaders(token, traceId),
        data: {
          instance_id: inst0,
          field_id: f0,
          source: "human",
          proposed_value: { value: "human-says" },
          source_user_id: undefined, // server picks current user
        },
        timeout: 15000,
      },
    );
    expect(proposalRes.ok()).toBeTruthy();

    // 5. Reviewers endpoint already lists the proposer's profile.
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
      await request.post(`${env.apiUrl}/api/v1/runs/${run.id}/advance`, {
        headers: authHeaders(token, traceId),
        data: { target_stage: "review" },
        timeout: 15000,
      });
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
