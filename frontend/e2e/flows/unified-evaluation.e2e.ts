import { APIRequestContext, expect, test } from "@playwright/test";

import { resolveAuthToken } from "../_fixtures/auth";
import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";
import {
  createAndPublishSchemaVersion,
  createEvaluationRun,
  kickoffProposalGeneration,
  seedProposalRecordViaServiceRole,
} from "../_fixtures/seed";
import { uploadToPresignedUrl } from "../_fixtures/storage";

type ReviewerDecisionResponse = { id: string };
type PublishedStateResponse = { id: string };

async function bootstrapRunContext(input: {
  token: string;
  request: APIRequestContext;
}) {
  const env = loadE2EEnv();
  const schemaVersionId =
    env.schemaVersionId ||
    (env.schemaId
      ? await createAndPublishSchemaVersion(input.request, input.token, env.schemaId)
      : undefined);

  if (!schemaVersionId || !env.projectId || !env.targetId || !env.itemId) {
    test.skip(
      true,
      "Missing schema/version/project/target/item env for unified evaluation bootstrap."
    );
    throw new Error("unreachable");
  }

  const runId = await createEvaluationRun(input.request, input.token, {
    projectId: env.projectId,
    schemaVersionId,
    targetId: env.targetId,
    name: "E2E unified run",
  });
  await kickoffProposalGeneration(input.request, input.token, runId);

  return { runId, schemaVersionId };
}

test.describe("Unified evaluation API flow", () => {
  test("full happy path with proposal seed, review, consensus and evidence upload", async ({ request, page }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys([
      "E2E_PROJECT_ID",
      "E2E_TARGET_ID",
      "E2E_ITEM_ID",
      "E2E_SCHEMA_VERSION_ID",
      "E2E_SUPABASE_URL",
      "E2E_SUPABASE_SERVICE_ROLE_KEY",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const token = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-unified-happy");
    const { runId, schemaVersionId } = await bootstrapRunContext({ token, request: request });

    await seedProposalRecordViaServiceRole({
      projectId: env.projectId!,
      runId,
      targetId: env.targetId!,
      itemId: env.itemId!,
      schemaVersionId,
      value: { extracted: "baseline-value" },
    });

    const queueResponse = await request.get(`${env.apiUrl}/api/v1/review-queue?runId=${runId}`, {
      headers: authHeaders(token, traceId),
    });
    expect(queueResponse.ok()).toBeTruthy();
    const queueBody = await parseEnvelope<{
      items: Array<{
        target_id: string;
        item_id: string;
        latest_proposal_id: string | null;
      }>;
    }>(queueResponse);
    expect(queueBody.ok).toBeTruthy();
    expect(Array.isArray(queueBody.data.items)).toBeTruthy();
    const seededItem = queueBody.data.items.find(
      (entry) => entry.target_id === env.targetId && entry.item_id === env.itemId
    );
    expect(
      seededItem,
      `Expected seeded proposal for target ${env.targetId} / item ${env.itemId} in review queue`
    ).toBeDefined();
    expect(seededItem!.latest_proposal_id).toBeTruthy();

    const decisionResponse = await request.post(`${env.apiUrl}/api/v1/reviewer-decisions`, {
      headers: authHeaders(token, traceId),
      data: {
        project_id: env.projectId,
        run_id: runId,
        target_id: env.targetId,
        item_id: env.itemId,
        schema_version_id: schemaVersionId,
        decision: "accept",
      },
    });
    expect(decisionResponse.status()).toBe(201);
    const decisionBody = await parseEnvelope<ReviewerDecisionResponse>(decisionResponse);
    expect(decisionBody.ok).toBeTruthy();
    expect(decisionBody.data.id).toBeTruthy();

    const consensusResponse = await request.post(`${env.apiUrl}/api/v1/consensus-decisions`, {
      headers: authHeaders(token, traceId),
      data: {
        project_id: env.projectId,
        run_id: runId,
        target_id: env.targetId,
        item_id: env.itemId,
        schema_version_id: schemaVersionId,
        mode: "select_existing",
        selected_reviewer_decision_id: decisionBody.data.id,
      },
    });
    expect(consensusResponse.status()).toBe(201);
    const consensusBody = await parseEnvelope<PublishedStateResponse>(consensusResponse);
    expect(consensusBody.ok).toBeTruthy();
    expect(consensusBody.data.id).toBeTruthy();

    const evidenceResponse = await request.post(`${env.apiUrl}/api/v1/evidence-attachments/presign`, {
      headers: authHeaders(token, traceId),
      data: {
        project_id: env.projectId,
        entity_type: "published_state",
        entity_id: consensusBody.data.id,
        filename: "e2e-evidence.txt",
        mime_type: "text/plain",
        size_bytes: 128,
      },
    });
    expect(evidenceResponse.ok()).toBeTruthy();
    const evidenceBody = await parseEnvelope<{ upload_url: string; storage_path: string }>(evidenceResponse);
    expect(evidenceBody.ok).toBeTruthy();
    expect(evidenceBody.data.storage_path).toContain("evidence/");
    await uploadToPresignedUrl(evidenceBody.data.upload_url, "e2e-evidence-content", "text/plain");
  });

  test("rejects edit decision without edited_value", async ({ request, page }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys([
      "E2E_PROJECT_ID",
      "E2E_TARGET_ID",
      "E2E_ITEM_ID",
      "E2E_SCHEMA_VERSION_ID",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const token = await resolveAuthToken(page);
    const { runId, schemaVersionId } = await bootstrapRunContext({ token, request: request });

    const response = await request.post(`${env.apiUrl}/api/v1/reviewer-decisions`, {
      headers: authHeaders(token, createTraceId("e2e-unified-edit-invalid")),
      data: {
        project_id: env.projectId,
        run_id: runId,
        target_id: env.targetId,
        item_id: env.itemId,
        schema_version_id: schemaVersionId,
        decision: "edit",
      },
    });

    expect(response.status()).toBe(422);
  });

  test("rejects manual override without justification", async ({ request, page }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys([
      "E2E_PROJECT_ID",
      "E2E_TARGET_ID",
      "E2E_ITEM_ID",
      "E2E_SCHEMA_VERSION_ID",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const token = await resolveAuthToken(page);
    const { runId, schemaVersionId } = await bootstrapRunContext({ token, request: request });

    const response = await request.post(`${env.apiUrl}/api/v1/consensus-decisions`, {
      headers: authHeaders(token, createTraceId("e2e-unified-manual-invalid")),
      data: {
        project_id: env.projectId,
        run_id: runId,
        target_id: env.targetId,
        item_id: env.itemId,
        schema_version_id: schemaVersionId,
        mode: "manual_override",
        override_value: { value: "override" },
      },
    });

    expect(response.status()).toBe(422);
  });

  test("returns 422 for invalid evidence mime and oversized file", async ({ request, page }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys([
      "E2E_PROJECT_ID",
      "E2E_TARGET_ID",
      "E2E_ITEM_ID",
      "E2E_SCHEMA_VERSION_ID",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const token = await resolveAuthToken(page);
    const { runId, schemaVersionId } = await bootstrapRunContext({ token, request: request });

    const invalidMime = await request.post(`${env.apiUrl}/api/v1/evidence-attachments/presign`, {
      headers: authHeaders(token, createTraceId("e2e-unified-evidence-mime")),
      data: {
        project_id: env.projectId,
        entity_type: "published_state",
        entity_id: env.itemId,
        filename: "invalid.bin",
        mime_type: "application/octet-stream",
        size_bytes: 128,
      },
    });
    expect(invalidMime.status()).toBe(422);

    const oversized = await request.post(`${env.apiUrl}/api/v1/evidence-attachments/presign`, {
      headers: authHeaders(token, createTraceId("e2e-unified-evidence-size")),
      data: {
        project_id: env.projectId,
        entity_type: "published_state",
        entity_id: env.itemId,
        filename: "big.pdf",
        mime_type: "application/pdf",
        size_bytes: 26 * 1024 * 1024,
      },
    });
    expect(oversized.status()).toBe(422);

    expect(runId).toBeTruthy();
    expect(schemaVersionId).toBeTruthy();
  });
});
