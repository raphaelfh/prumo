/**
 * Multi-reviewer consensus flows: 2-way + 3-way divergence resolved via
 * `select_existing`, 3-way agreement, `manual_override` arbitration, and
 * the auth check on `/runs/{id}/decisions`.
 *
 * `prepareCleanQaRun` resets the run between cases so they can interleave
 * deterministically against the shared seed.
 */

import { expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { loginViaUi, resolveAuthToken } from "../_fixtures/auth";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";
import { prepareCleanQaRun } from "../_fixtures/hitl";

interface DecisionResponse {
  id: string;
  reviewer_id: string;
  value: { value: unknown } | null;
}

interface RunDetailResponse {
  run: { id: string; stage: string; status: string };
  decisions: Array<DecisionResponse & {
    instance_id: string;
    field_id: string;
    decision: string;
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

function publishedScalar(value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    "value" in (value as Record<string, unknown>)
  ) {
    return (value as { value: unknown }).value;
  }
  return value;
}

const REQUIRED_BASE = [
  "E2E_USER_EMAIL",
  "E2E_USER_PASSWORD",
  "E2E_PROJECT_ID",
  "E2E_ARTICLE_ID",
  "E2E_QA_GLOBAL_TEMPLATE_ID",
  "E2E_RATE_LIMIT_TOKEN",
  "E2E_REVIEWER_C_TOKEN",
];

test.describe.configure({ mode: "serial" });

test.describe("HITL multi-reviewer consensus", () => {
  test("2-way divergence: A=Y, B=N → arbitrator picks A's Y", async ({
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
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    const qaTemplateId = process.env.E2E_QA_GLOBAL_TEMPLATE_ID!;
    const userBToken = process.env.E2E_RATE_LIMIT_TOKEN!;

    await loginViaUi(page);
    const userAToken = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-qa-2way-divergence");

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
    const decisionAId = (await parseEnvelope<{ id: string }>(decisionA)).data.id;

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

    await request.post(`${env.apiUrl}/api/v1/runs/${runId}/advance`, {
      headers: authHeaders(userAToken, traceId),
      data: { target_stage: "consensus" },
      timeout: 15000,
    });

    const consensusRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${runId}/consensus`,
      {
        headers: authHeaders(userAToken, traceId),
        data: {
          instance_id: firstInstanceId,
          field_id: firstField.id,
          mode: "select_existing",
          selected_decision_id: decisionAId,
        },
        timeout: 15000,
      },
    );
    expect(consensusRes.ok()).toBeTruthy();

    await request.post(`${env.apiUrl}/api/v1/runs/${runId}/advance`, {
      headers: authHeaders(userAToken, traceId),
      data: { target_stage: "finalized" },
      timeout: 15000,
    });

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
    expect(publishedScalar(published!.value)).toBe("Y");
  });


  test("3-way divergence: A=Y, B=N, C=PN → arbitrator picks A's Y", async ({
    page,
    request,
  }) => {
    const required = missingEnvKeys(REQUIRED_BASE);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    const qaTemplateId = process.env.E2E_QA_GLOBAL_TEMPLATE_ID!;
    const userBToken = process.env.E2E_RATE_LIMIT_TOKEN!;
    const userCToken = process.env.E2E_REVIEWER_C_TOKEN!;

    await loginViaUi(page);
    const userAToken = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-qa-3way-divergence");

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

    const recordDecision = async (
      token: string,
      value: string,
    ): Promise<string> => {
      const res = await request.post(
        `${env.apiUrl}/api/v1/runs/${runId}/decisions`,
        {
          headers: authHeaders(token, traceId),
          data: {
            instance_id: firstInstanceId,
            field_id: firstField.id,
            decision: "edit",
            value: { value },
          },
          timeout: 15000,
        },
      );
      expect(res.ok(), `record decision (${value})`).toBeTruthy();
      return (await parseEnvelope<{ id: string }>(res)).data.id;
    };

    const decisionAId = await recordDecision(userAToken, "Y");
    await recordDecision(userBToken, "N");
    await recordDecision(userCToken, "PN");

    await request.post(`${env.apiUrl}/api/v1/runs/${runId}/advance`, {
      headers: authHeaders(userAToken, traceId),
      data: { target_stage: "consensus" },
      timeout: 15000,
    });

    const detailRes = await request.get(`${env.apiUrl}/api/v1/runs/${runId}`, {
      headers: authHeaders(userAToken, traceId),
      timeout: 15000,
    });
    const detail = (await parseEnvelope<RunDetailResponse>(detailRes)).data;
    expect(detail.run.stage).toBe("consensus");
    const coord = detail.decisions.filter(
      (d) => d.instance_id === firstInstanceId && d.field_id === firstField.id,
    );
    expect(coord.length).toBe(3);
    const reviewers = new Set(coord.map((d) => d.reviewer_id));
    expect(reviewers.size).toBe(3);

    const consensusRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${runId}/consensus`,
      {
        headers: authHeaders(userAToken, traceId),
        data: {
          instance_id: firstInstanceId,
          field_id: firstField.id,
          mode: "select_existing",
          selected_decision_id: decisionAId,
        },
        timeout: 15000,
      },
    );
    expect(consensusRes.ok()).toBeTruthy();

    await request.post(`${env.apiUrl}/api/v1/runs/${runId}/advance`, {
      headers: authHeaders(userAToken, traceId),
      data: { target_stage: "finalized" },
      timeout: 15000,
    });

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
    expect(publishedScalar(published!.value)).toBe("Y");

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
    expect(reviewersBody.reviewers.length).toBeGreaterThanOrEqual(3);
  });

  test("3-way agreement: A=B=C=Y publishes Y without arbitration", async ({
    page,
    request,
  }) => {
    const required = missingEnvKeys(REQUIRED_BASE);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    const qaTemplateId = process.env.E2E_QA_GLOBAL_TEMPLATE_ID!;
    const userBToken = process.env.E2E_RATE_LIMIT_TOKEN!;
    const userCToken = process.env.E2E_REVIEWER_C_TOKEN!;

    await loginViaUi(page);
    const userAToken = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-qa-3way-agreement");

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

    const recordDecision = async (token: string): Promise<string> => {
      const res = await request.post(
        `${env.apiUrl}/api/v1/runs/${runId}/decisions`,
        {
          headers: authHeaders(token, traceId),
          data: {
            instance_id: firstInstanceId,
            field_id: firstField.id,
            decision: "edit",
            value: { value: "Y" },
          },
          timeout: 15000,
        },
      );
      expect(res.ok()).toBeTruthy();
      return (await parseEnvelope<{ id: string }>(res)).data.id;
    };

    const aId = await recordDecision(userAToken);
    await recordDecision(userBToken);
    await recordDecision(userCToken);

    await request.post(`${env.apiUrl}/api/v1/runs/${runId}/advance`, {
      headers: authHeaders(userAToken, traceId),
      data: { target_stage: "consensus" },
      timeout: 15000,
    });

    // All decisions agree, but the consensus call is still required by the
    // current API to materialize a ConsensusDecision row before finalize.
    const consensusRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${runId}/consensus`,
      {
        headers: authHeaders(userAToken, traceId),
        data: {
          instance_id: firstInstanceId,
          field_id: firstField.id,
          mode: "select_existing",
          selected_decision_id: aId,
        },
        timeout: 15000,
      },
    );
    expect(consensusRes.ok()).toBeTruthy();

    await request.post(`${env.apiUrl}/api/v1/runs/${runId}/advance`, {
      headers: authHeaders(userAToken, traceId),
      data: { target_stage: "finalized" },
      timeout: 15000,
    });

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
    expect(publishedScalar(published!.value)).toBe("Y");
    // Three reviewer rows but only one consensus row.
    const consensusForCoord = final.consensus_decisions.filter(
      (c) => c.instance_id === firstInstanceId && c.field_id === firstField.id,
    );
    expect(consensusForCoord.length).toBe(1);
  });

  test("manual_override: arbitrator publishes a brand-new value with rationale", async ({
    page,
    request,
  }) => {
    const required = missingEnvKeys(REQUIRED_BASE);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    const qaTemplateId = process.env.E2E_QA_GLOBAL_TEMPLATE_ID!;
    const userBToken = process.env.E2E_RATE_LIMIT_TOKEN!;

    await loginViaUi(page);
    const userAToken = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-qa-manual-override");

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

    // Two reviewers disagree on Y vs N…
    for (const [token, value] of [
      [userAToken, "Y"],
      [userBToken, "N"],
    ] as const) {
      const res = await request.post(
        `${env.apiUrl}/api/v1/runs/${runId}/decisions`,
        {
          headers: authHeaders(token, traceId),
          data: {
            instance_id: firstInstanceId,
            field_id: firstField.id,
            decision: "edit",
            value: { value },
          },
          timeout: 15000,
        },
      );
      expect(res.ok()).toBeTruthy();
    }

    await request.post(`${env.apiUrl}/api/v1/runs/${runId}/advance`, {
      headers: authHeaders(userAToken, traceId),
      data: { target_stage: "consensus" },
      timeout: 15000,
    });

    // …and the arbitrator picks PN, which neither reviewer voted for.
    const overrideRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${runId}/consensus`,
      {
        headers: authHeaders(userAToken, traceId),
        data: {
          instance_id: firstInstanceId,
          field_id: firstField.id,
          mode: "manual_override",
          value: { value: "PN" },
          rationale: "Insufficient evidence either way (E2E manual_override).",
        },
        timeout: 15000,
      },
    );
    expect(overrideRes.ok()).toBeTruthy();

    await request.post(`${env.apiUrl}/api/v1/runs/${runId}/advance`, {
      headers: authHeaders(userAToken, traceId),
      data: { target_stage: "finalized" },
      timeout: 15000,
    });

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
    expect(publishedScalar(published!.value)).toBe("PN");
    const consensusForCoord = final.consensus_decisions.find(
      (c) => c.instance_id === firstInstanceId && c.field_id === firstField.id,
    );
    expect(consensusForCoord).toBeTruthy();
    // selected_decision_id is null for manual_override (no winning reviewer).
    expect(consensusForCoord!.selected_decision_id).toBeNull();
  });

  test("missing or invalid bearer cannot record a reviewer decision", async ({
    page,
    request,
  }) => {
    // True non-member RLS is covered by the cross-cutting suite via direct
    // REST; here we only verify the endpoint refuses an unauthenticated
    // request and a malformed bearer.
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
    const userAToken = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-qa-non-member");

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

    // No bearer token at all — must be 401.
    const noAuthRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${runId}/decisions`,
      {
        headers: { "Content-Type": "application/json" },
        data: {
          instance_id: firstInstanceId,
          field_id: firstField.id,
          decision: "edit",
          value: { value: "Y" },
        },
        timeout: 15000,
      },
    );
    expect(noAuthRes.status()).toBe(401);

    // Garbage bearer — still rejected (401, since signature is invalid).
    const badAuthRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${runId}/decisions`,
      {
        headers: authHeaders("not-a-real-jwt", traceId),
        data: {
          instance_id: firstInstanceId,
          field_id: firstField.id,
          decision: "edit",
          value: { value: "Y" },
        },
        timeout: 15000,
      },
    );
    expect([401, 403]).toContain(badAuthRes.status());
  });
});
