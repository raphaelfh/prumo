import { APIRequestContext, expect } from "@playwright/test";

import { authHeaders, parseEnvelope } from "./api";
import { createTraceId, loadE2EEnv } from "./env";

type CreateSchemaVersionResponse = {
  id: string;
  schema_id: string;
  status: string;
};

type CreateRunResponse = {
  id: string;
  status: string;
  current_stage: string;
};

export async function createAndPublishSchemaVersion(
  request: APIRequestContext,
  token: string,
  schemaId: string
): Promise<string> {
  const env = loadE2EEnv();
  const traceId = createTraceId("e2e-schema-version");
  const createResponse = await request.post(`${env.apiUrl}/api/v1/evaluation-schema-versions`, {
    headers: authHeaders(token, traceId),
    data: { schema_id: schemaId },
  });
  expect(createResponse.ok()).toBeTruthy();
  const createBody = await parseEnvelope<CreateSchemaVersionResponse>(createResponse);
  expect(createBody.ok).toBeTruthy();

  const versionId = createBody.data.id;
  const publishResponse = await request.post(
    `${env.apiUrl}/api/v1/evaluation-schema-versions/${versionId}/publish`,
    {
      headers: authHeaders(token, traceId),
    }
  );
  expect(publishResponse.ok()).toBeTruthy();
  const publishBody = await parseEnvelope<CreateSchemaVersionResponse>(publishResponse);
  expect(publishBody.ok).toBeTruthy();
  return versionId;
}

export async function createEvaluationRun(
  request: APIRequestContext,
  token: string,
  input: {
    projectId: string;
    schemaVersionId: string;
    targetId: string;
    name?: string;
  }
): Promise<string> {
  const env = loadE2EEnv();
  const traceId = createTraceId("e2e-run");
  const createRunResponse = await request.post(`${env.apiUrl}/api/v1/evaluation-runs`, {
    headers: authHeaders(token, traceId),
    data: {
      project_id: input.projectId,
      schema_version_id: input.schemaVersionId,
      target_ids: [input.targetId],
      name: input.name || "E2E evaluation run",
    },
  });
  expect(createRunResponse.ok()).toBeTruthy();
  const createRunBody = await parseEnvelope<CreateRunResponse>(createRunResponse);
  expect(createRunBody.ok).toBeTruthy();
  return createRunBody.data.id;
}

export async function kickoffProposalGeneration(
  request: APIRequestContext,
  token: string,
  runId: string
): Promise<void> {
  const env = loadE2EEnv();
  const traceId = createTraceId("e2e-kickoff");
  const kickoffResponse = await request.post(
    `${env.apiUrl}/api/v1/evaluation-runs/${runId}/proposal-generation`,
    {
      headers: authHeaders(token, traceId),
    }
  );
  expect(kickoffResponse.ok()).toBeTruthy();
}

export async function seedProposalRecordViaServiceRole(input: {
  projectId: string;
  runId: string;
  targetId: string;
  itemId: string;
  schemaVersionId: string;
  value: Record<string, unknown>;
}): Promise<void> {
  const env = loadE2EEnv();
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error("E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY are required to seed proposals.");
  }

  const response = await fetch(`${env.supabaseUrl}/rest/v1/proposal_records`, {
    method: "POST",
    headers: {
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify([
      {
        project_id: input.projectId,
        run_id: input.runId,
        target_id: input.targetId,
        item_id: input.itemId,
        schema_version_id: input.schemaVersionId,
        source_type: "system",
        value_json: input.value,
        confidence: 1,
      },
    ]),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to seed proposal_records: ${response.status} ${body}`);
  }
}
