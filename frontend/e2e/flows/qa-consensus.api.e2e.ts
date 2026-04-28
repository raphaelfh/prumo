/**
 * Multi-reviewer consensus E2E flow.
 *
 * Drives a divergent (instance, field) decision pair across two users,
 * then resolves it via `mode='select_existing'`:
 *   1. User A and User B both record a `ReviewerDecision` for the same
 *      coordinate, but with different values.
 *   2. Run advances `review → consensus`.
 *   3. The consensus call (mode=select_existing) picks one of the two
 *      decisions; the resulting `PublishedState` matches that decision.
 *   4. Advance `consensus → finalized`. Verify final state.
 *
 * Skips when the rate-limit user (used here as "User B") is not
 * configured. The pattern mirrors `cross-cutting.e2e.ts` so we don't
 * require new env variables.
 */

import { expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { loginViaUi, resolveAuthToken } from "../_fixtures/auth";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";
import { adminSelect } from "../_fixtures/supabase-admin";

interface OpenSessionResponse {
  run_id: string;
  project_template_id: string;
  instances_by_entity_type: Record<string, string>;
}

interface RunDetailResponse {
  run: { id: string; stage: string; status: string };
  reviewer_decisions: Array<{
    id: string;
    reviewer_id: string;
    instance_id: string;
    field_id: string;
    decision: string;
    value: { value: unknown } | null;
  }>;
  consensus_decisions: Array<{
    id: string;
    instance_id: string;
    field_id: string;
    selected_decision_id: string | null;
  }>;
  published_states: Array<{
    instance_id: string;
    field_id: string;
    value: unknown;
    version: number;
  }>;
}

test.describe("HITL multi-reviewer consensus", () => {
  test("two divergent decisions resolve via select_existing → finalized", async ({
    page,
    request,
  }) => {
    const required = missingEnvKeys([
      "E2E_USER_EMAIL",
      "E2E_USER_PASSWORD",
      "E2E_PROJECT_ID",
      "E2E_ARTICLE_ID",
      "E2E_QA_GLOBAL_TEMPLATE_ID",
      "E2E_RATE_LIMIT_TOKEN",
    ]);
    test.skip(
      required.length > 0,
      `Missing required env: ${required.join(", ")}`,
    );

    const env = loadE2EEnv();
    const qaTemplateId = process.env.E2E_QA_GLOBAL_TEMPLATE_ID!;
    const userBToken = process.env.E2E_RATE_LIMIT_TOKEN!;

    await loginViaUi(page);
    const userAToken = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-qa-consensus");

    // 1. Open the QA session as User A.
    const sessionRes = await request.post(
      `${env.apiUrl}/api/v1/qa-assessments`,
      {
        headers: authHeaders(userAToken, traceId),
        data: {
          project_id: env.projectId,
          article_id: env.articleId,
          global_template_id: qaTemplateId,
        },
        timeout: 30000,
      },
    );
    expect(sessionRes.ok()).toBeTruthy();
    const session = (await parseEnvelope<OpenSessionResponse>(sessionRes)).data;

    // 2. Resolve a (instance, field) coordinate for the divergent
    //    decisions. We use the admin client to fetch one field for the
    //    first entity_type — the run detail endpoint doesn't include the
    //    template tree.
    const [firstEntityTypeId, firstInstanceId] = Object.entries(
      session.instances_by_entity_type,
    )[0];
    const fields = await adminSelect<{ id: string; name: string }>(
      "extraction_fields",
      `select=id,name&entity_type_id=eq.${firstEntityTypeId}&limit=1`,
    );
    test.skip(
      fields.length === 0,
      "QA template has no fields for the first entity_type",
    );
    const field = fields[0];

    // 3. Advance run to review (decisions only accepted in review).
    await request.post(
      `${env.apiUrl}/api/v1/runs/${session.run_id}/advance`,
      {
        headers: authHeaders(userAToken, traceId),
        data: { target_stage: "review" },
        timeout: 15000,
      },
    );

    // 4. User A records decision = "Y".
    const decisionA = await request.post(
      `${env.apiUrl}/api/v1/runs/${session.run_id}/decisions`,
      {
        headers: authHeaders(userAToken, traceId),
        data: {
          instance_id: firstInstanceId,
          field_id: field.id,
          decision: "edit",
          value: { value: "Y" },
        },
        timeout: 15000,
      },
    );
    expect(decisionA.ok()).toBeTruthy();
    const decisionABody = (await parseEnvelope<{ id: string }>(decisionA)).data;

    // 5. User B records decision = "N" (divergent).
    const decisionB = await request.post(
      `${env.apiUrl}/api/v1/runs/${session.run_id}/decisions`,
      {
        headers: authHeaders(userBToken, traceId),
        data: {
          instance_id: firstInstanceId,
          field_id: field.id,
          decision: "edit",
          value: { value: "N" },
        },
        timeout: 15000,
      },
    );
    expect(decisionB.ok()).toBeTruthy();

    // 6. Advance to consensus.
    await request.post(
      `${env.apiUrl}/api/v1/runs/${session.run_id}/advance`,
      {
        headers: authHeaders(userAToken, traceId),
        data: { target_stage: "consensus" },
        timeout: 15000,
      },
    );

    // 7. Verify divergence is visible in the run detail.
    const detailRes = await request.get(
      `${env.apiUrl}/api/v1/runs/${session.run_id}`,
      { headers: authHeaders(userAToken, traceId), timeout: 15000 },
    );
    const detail = (await parseEnvelope<RunDetailResponse>(detailRes)).data;
    expect(detail.run.stage).toBe("consensus");
    const decisionsForCoord = detail.reviewer_decisions.filter(
      (d) =>
        d.instance_id === firstInstanceId && d.field_id === field.id,
    );
    expect(decisionsForCoord.length).toBeGreaterThanOrEqual(2);
    const distinctValues = new Set(
      decisionsForCoord.map((d) =>
        JSON.stringify(d.value?.value ?? null),
      ),
    );
    expect(distinctValues.size).toBeGreaterThanOrEqual(2);

    // 8. Resolve via select_existing (pick User A's "Y").
    const consensusRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${session.run_id}/consensus`,
      {
        headers: authHeaders(userAToken, traceId),
        data: {
          instance_id: firstInstanceId,
          field_id: field.id,
          mode: "select_existing",
          selected_decision_id: decisionABody.id,
        },
        timeout: 15000,
      },
    );
    expect(consensusRes.ok()).toBeTruthy();

    // 9. Finalize.
    const finalizeRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${session.run_id}/advance`,
      {
        headers: authHeaders(userAToken, traceId),
        data: { target_stage: "finalized" },
        timeout: 15000,
      },
    );
    expect(finalizeRes.ok()).toBeTruthy();

    // 10. Final assertion: published value matches User A's "Y".
    const finalRes = await request.get(
      `${env.apiUrl}/api/v1/runs/${session.run_id}`,
      { headers: authHeaders(userAToken, traceId), timeout: 15000 },
    );
    const final = (await parseEnvelope<RunDetailResponse>(finalRes)).data;
    expect(final.run.stage).toBe("finalized");
    const published = final.published_states.find(
      (p) =>
        p.instance_id === firstInstanceId && p.field_id === field.id,
    );
    expect(published).toBeTruthy();
    const publishedValue =
      typeof published!.value === "object" &&
      published!.value !== null &&
      "value" in (published!.value as Record<string, unknown>)
        ? (published!.value as { value: unknown }).value
        : published!.value;
    expect(publishedValue).toBe("Y");

    // 11. Reviewers endpoint exposes both reviewers + the consensus user.
    const reviewersRes = await request.get(
      `${env.apiUrl}/api/v1/runs/${session.run_id}/reviewers`,
      { headers: authHeaders(userAToken, traceId), timeout: 15000 },
    );
    expect(reviewersRes.ok()).toBeTruthy();
    const reviewersBody = (await parseEnvelope<{
      reviewers: Array<{ id: string; full_name: string | null }>;
    }>(reviewersRes)).data;
    expect(reviewersBody.reviewers.length).toBeGreaterThanOrEqual(2);
  });
});
