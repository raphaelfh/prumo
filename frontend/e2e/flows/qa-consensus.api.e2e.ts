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
 * configured. Uses `prepareCleanQaRun` so the test is deterministic
 * across reruns of the seeded DB.
 */

import { expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { loginViaUi, resolveAuthToken } from "../_fixtures/auth";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";
import { prepareCleanQaRun } from "../_fixtures/hitl";

interface RunDetailResponse {
  run: { id: string; stage: string; status: string };
  decisions: Array<{
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

    const fixture = await prepareCleanQaRun({
      request,
      apiUrl: env.apiUrl,
      token: userAToken,
      projectId: env.projectId!,
      articleId: env.articleId!,
      qaTemplateId,
      traceId,
    });
    const { runId, firstInstanceId, firstField } = fixture;

    // 1. User A records decision = "Y".
    const decisionA = await request.post(
      `${env.apiUrl}/api/v1/runs/${runId}/decisions`,
      {
        headers: authHeaders(userAToken, traceId),
        data: {
          instance_id: firstInstanceId,
          field_id: firstField.id,
          decision: "edit",
          value: { value: "Y" },
        },
        timeout: 15000,
      },
    );
    expect(decisionA.ok()).toBeTruthy();
    const decisionABody = (await parseEnvelope<{ id: string }>(decisionA)).data;

    // 2. User B records decision = "N" (divergent).
    const decisionB = await request.post(
      `${env.apiUrl}/api/v1/runs/${runId}/decisions`,
      {
        headers: authHeaders(userBToken, traceId),
        data: {
          instance_id: firstInstanceId,
          field_id: firstField.id,
          decision: "edit",
          value: { value: "N" },
        },
        timeout: 15000,
      },
    );
    expect(decisionB.ok()).toBeTruthy();

    // 3. Advance to consensus.
    await request.post(`${env.apiUrl}/api/v1/runs/${runId}/advance`, {
      headers: authHeaders(userAToken, traceId),
      data: { target_stage: "consensus" },
      timeout: 15000,
    });

    // 4. Verify divergence is visible in the run detail.
    const detailRes = await request.get(`${env.apiUrl}/api/v1/runs/${runId}`, {
      headers: authHeaders(userAToken, traceId),
      timeout: 15000,
    });
    const detail = (await parseEnvelope<RunDetailResponse>(detailRes)).data;
    expect(detail.run.stage).toBe("consensus");
    const decisionsForCoord = detail.decisions.filter(
      (d) => d.instance_id === firstInstanceId && d.field_id === firstField.id,
    );
    expect(decisionsForCoord.length).toBeGreaterThanOrEqual(2);
    const distinctValues = new Set(
      decisionsForCoord.map((d) => JSON.stringify(d.value?.value ?? null)),
    );
    expect(distinctValues.size).toBeGreaterThanOrEqual(2);

    // 5. Resolve via select_existing (pick User A's "Y").
    const consensusRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${runId}/consensus`,
      {
        headers: authHeaders(userAToken, traceId),
        data: {
          instance_id: firstInstanceId,
          field_id: firstField.id,
          mode: "select_existing",
          selected_decision_id: decisionABody.id,
        },
        timeout: 15000,
      },
    );
    expect(consensusRes.ok()).toBeTruthy();

    // 6. Finalize.
    const finalizeRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${runId}/advance`,
      {
        headers: authHeaders(userAToken, traceId),
        data: { target_stage: "finalized" },
        timeout: 15000,
      },
    );
    expect(finalizeRes.ok()).toBeTruthy();

    // 7. Final assertion: published value matches User A's "Y".
    const finalRes = await request.get(`${env.apiUrl}/api/v1/runs/${runId}`, {
      headers: authHeaders(userAToken, traceId),
      timeout: 15000,
    });
    const final = (await parseEnvelope<RunDetailResponse>(finalRes)).data;
    expect(final.run.stage).toBe("finalized");
    const published = final.published_states.find(
      (p) => p.instance_id === firstInstanceId && p.field_id === firstField.id,
    );
    expect(published).toBeTruthy();
    const publishedValue =
      typeof published!.value === "object" &&
      published!.value !== null &&
      "value" in (published!.value as Record<string, unknown>)
        ? (published!.value as { value: unknown }).value
        : published!.value;
    expect(publishedValue).toBe("Y");

    // 8. Reviewers endpoint exposes both reviewers.
    const reviewersRes = await request.get(
      `${env.apiUrl}/api/v1/runs/${runId}/reviewers`,
      { headers: authHeaders(userAToken, traceId), timeout: 15000 },
    );
    expect(reviewersRes.ok()).toBeTruthy();
    const reviewersBody = (
      await parseEnvelope<{
        reviewers: Array<{ id: string; full_name: string | null }>;
      }>(reviewersRes)
    ).data;
    expect(reviewersBody.reviewers.length).toBeGreaterThanOrEqual(2);
  });
});
