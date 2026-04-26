import { expect, test } from "@playwright/test";

type RequiredEnvKey =
  | "E2E_API_URL"
  | "E2E_AUTH_TOKEN"
  | "E2E_PROJECT_ID"
  | "E2E_SCHEMA_VERSION_ID"
  | "E2E_TARGET_ID"
  | "E2E_ITEM_ID";

const REQUIRED_ENV: RequiredEnvKey[] = [
  "E2E_API_URL",
  "E2E_AUTH_TOKEN",
  "E2E_PROJECT_ID",
  "E2E_SCHEMA_VERSION_ID",
  "E2E_TARGET_ID",
  "E2E_ITEM_ID",
];

function getMissingEnv(): RequiredEnvKey[] {
  return REQUIRED_ENV.filter((key) => !process.env[key]);
}

function authHeaders(traceId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.E2E_AUTH_TOKEN!}`,
    "X-Trace-Id": traceId,
    "Content-Type": "application/json",
  };
}

test.describe("Unified evaluation API flow", () => {
  test("run -> review -> consensus -> evidence", async ({ request }) => {
    const missingEnv = getMissingEnv();
    test.skip(missingEnv.length > 0, `Missing required env: ${missingEnv.join(", ")}`);

    const apiBase = process.env.E2E_API_URL!;
    const projectId = process.env.E2E_PROJECT_ID!;
    const schemaVersionId = process.env.E2E_SCHEMA_VERSION_ID!;
    const targetId = process.env.E2E_TARGET_ID!;
    const itemId = process.env.E2E_ITEM_ID!;
    const traceId = `e2e-unified-${Date.now()}`;

    const createRunResponse = await request.post(`${apiBase}/api/v1/evaluation-runs`, {
      headers: authHeaders(traceId),
      data: {
        project_id: projectId,
        schema_version_id: schemaVersionId,
        target_ids: [targetId],
        name: "E2E Unified Flow Run",
      },
    });
    expect(createRunResponse.ok(), `create run failed: ${createRunResponse.status()}`).toBeTruthy();
    const createRunBody = await createRunResponse.json();
    expect(createRunBody.ok).toBeTruthy();
    expect(createRunBody.trace_id).toBeTruthy();
    const runId = createRunBody.data.id as string;

    const kickoffResponse = await request.post(
      `${apiBase}/api/v1/evaluation-runs/${runId}/proposal-generation`,
      {
        headers: authHeaders(traceId),
      }
    );
    expect(kickoffResponse.ok(), `proposal kickoff failed: ${kickoffResponse.status()}`).toBeTruthy();
    const kickoffBody = await kickoffResponse.json();
    expect(kickoffBody.ok).toBeTruthy();

    const reviewQueueResponse = await request.get(`${apiBase}/api/v1/review-queue?runId=${runId}`, {
      headers: authHeaders(traceId),
    });
    expect(reviewQueueResponse.ok(), `review queue failed: ${reviewQueueResponse.status()}`).toBeTruthy();
    const reviewQueueBody = await reviewQueueResponse.json();
    expect(reviewQueueBody.ok).toBeTruthy();

    const reviewerDecisionResponse = await request.post(`${apiBase}/api/v1/reviewer-decisions`, {
      headers: authHeaders(traceId),
      data: {
        project_id: projectId,
        run_id: runId,
        target_id: targetId,
        item_id: itemId,
        schema_version_id: schemaVersionId,
        decision: "accept",
      },
    });
    expect(
      reviewerDecisionResponse.ok(),
      `reviewer decision failed: ${reviewerDecisionResponse.status()}`
    ).toBeTruthy();
    const reviewerDecisionBody = await reviewerDecisionResponse.json();
    expect(reviewerDecisionBody.ok).toBeTruthy();
    const reviewerDecisionId = reviewerDecisionBody.data.id as string;

    const consensusResponse = await request.post(`${apiBase}/api/v1/consensus-decisions`, {
      headers: authHeaders(traceId),
      data: {
        project_id: projectId,
        run_id: runId,
        target_id: targetId,
        item_id: itemId,
        schema_version_id: schemaVersionId,
        mode: "select_existing",
        selected_reviewer_decision_id: reviewerDecisionId,
      },
    });
    expect(consensusResponse.ok(), `consensus failed: ${consensusResponse.status()}`).toBeTruthy();
    const consensusBody = await consensusResponse.json();
    expect(consensusBody.ok).toBeTruthy();
    const publishedStateId = consensusBody.data.id as string;

    const evidenceResponse = await request.post(`${apiBase}/api/v1/evidence-attachments/presign`, {
      headers: authHeaders(traceId),
      data: {
        project_id: projectId,
        entity_type: "published_state",
        entity_id: publishedStateId,
        filename: "e2e-evidence.txt",
        mime_type: "text/plain",
        size_bytes: 128,
      },
    });
    expect(evidenceResponse.ok(), `evidence presign failed: ${evidenceResponse.status()}`).toBeTruthy();
    const evidenceBody = await evidenceResponse.json();
    expect(evidenceBody.ok).toBeTruthy();
    expect(evidenceBody.data.upload_url).toBeTruthy();
    expect(evidenceBody.data.storage_path).toContain("evidence/");
  });
});
