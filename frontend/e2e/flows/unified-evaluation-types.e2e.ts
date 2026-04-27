import { APIRequestContext, expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { resolveAuthToken } from "../_fixtures/auth";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";
import { recordResource } from "../_fixtures/registry";
import { createEvaluationRun } from "../_fixtures/seed";
import { adminInsert, adminSelect } from "../_fixtures/supabase-admin";

type ItemTypeSpec = {
  itemType: "text" | "number" | "boolean" | "date" | "choice_single" | "choice_multi";
  itemKey: string;
  label: string;
  options?: { values: Array<{ value: string; label: string }> };
  proposalValue: Record<string, unknown>;
  reviewerEdit: Record<string, unknown>;
};

const ITEM_TYPE_SPECS: ItemTypeSpec[] = [
  {
    itemType: "text",
    itemKey: "field_text",
    label: "Free-text observation",
    proposalValue: { value: "baseline-text" },
    reviewerEdit: { value: "edited-text-by-reviewer" },
  },
  {
    itemType: "number",
    itemKey: "field_number",
    label: "Numeric observation",
    proposalValue: { value: 42, unit: "ms" },
    reviewerEdit: { value: 99, unit: "ms" },
  },
  {
    itemType: "boolean",
    itemKey: "field_boolean",
    label: "Boolean observation",
    proposalValue: { value: true },
    reviewerEdit: { value: false },
  },
  {
    itemType: "date",
    itemKey: "field_date",
    label: "Date observation",
    proposalValue: { value: "2026-04-26" },
    reviewerEdit: { value: "2026-05-01" },
  },
  {
    itemType: "choice_single",
    itemKey: "field_choice_single",
    label: "Single-choice observation",
    options: {
      values: [
        { value: "alpha", label: "Alpha" },
        { value: "beta", label: "Beta" },
        { value: "gamma", label: "Gamma" },
      ],
    },
    proposalValue: { value: "alpha" },
    reviewerEdit: { value: "gamma" },
  },
  {
    itemType: "choice_multi",
    itemKey: "field_choice_multi",
    label: "Multi-choice observation",
    options: {
      values: [
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
      ],
    },
    proposalValue: { value: ["red", "green"] },
    reviewerEdit: { value: ["blue"] },
  },
];

type CreateSchemaVersionResponse = {
  id: string;
  schema_id: string;
  status: string;
};

async function createSchemaWithAllItemTypes(
  request: APIRequestContext,
  token: string,
  projectId: string
): Promise<{ schemaId: string; schemaVersionId: string; itemIds: Record<string, string> }> {
  const env = loadE2EEnv();
  const traceId = createTraceId("e2e-types-schema");

  // 1. Create the parent schema (not exposed via API; insert via service role).
  const [schemaRow] = await adminInsert<{ id: string }>("evaluation_schemas", [
    {
      project_id: projectId,
      name: `E2E All Item Types ${Date.now()}`,
      description: "Schema covering every supported evaluation_item_type.",
      created_by: process.env.E2E_USER_ID ?? null,
    },
  ]);
  if (!schemaRow?.id) {
    throw new Error("Failed to seed evaluation_schemas row.");
  }
  recordResource({ kind: "evaluation_schema", id: schemaRow.id });

  // 2. Create a version via the API (so the run-target plumbing matches prod).
  const versionRes = await request.post(`${env.apiUrl}/api/v1/evaluation-schema-versions`, {
    headers: authHeaders(token, traceId),
    data: { schema_id: schemaRow.id },
  });
  expect(versionRes.ok()).toBeTruthy();
  const versionBody = await parseEnvelope<CreateSchemaVersionResponse>(versionRes);
  expect(versionBody.ok).toBeTruthy();
  const schemaVersionId = versionBody.data.id;
  recordResource({ kind: "evaluation_schema_version", id: schemaVersionId });

  // 3. Insert one evaluation_item per type.
  const itemRows = await adminInsert<{ id: string; item_key: string }>("evaluation_items", [
    ...ITEM_TYPE_SPECS.map((spec, idx) => ({
      schema_version_id: schemaVersionId,
      item_key: spec.itemKey,
      label: spec.label,
      item_type: spec.itemType,
      options_json: spec.options ?? null,
      required: false,
      sort_order: idx + 1,
    })),
  ]);
  const itemIds: Record<string, string> = {};
  for (const row of itemRows) {
    itemIds[row.item_key] = row.id;
    recordResource({ kind: "evaluation_item", id: row.id });
  }

  // 4. Publish the version.
  const publishRes = await request.post(
    `${env.apiUrl}/api/v1/evaluation-schema-versions/${schemaVersionId}/publish`,
    { headers: authHeaders(token, traceId) }
  );
  expect(publishRes.ok()).toBeTruthy();

  return { schemaId: schemaRow.id, schemaVersionId, itemIds };
}

test.describe("Unified evaluation across all item types", () => {
  test("propagates value_json round-trip for text/number/boolean/date/choice_single/choice_multi", async ({
    request,
    page,
  }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys([
      "E2E_PROJECT_ID",
      "E2E_TARGET_ID",
      "E2E_SUPABASE_URL",
      "E2E_SUPABASE_SERVICE_ROLE_KEY",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const token = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-types-flow");

    // Bootstrap a fresh schema covering every item type.
    const { schemaVersionId, itemIds } = await createSchemaWithAllItemTypes(
      request,
      token,
      env.projectId!
    );

    // Verify each item persisted with the correct item_type and options_json.
    const persistedItems = await adminSelect<{
      id: string;
      item_type: string;
      options_json: { values: Array<{ value: string }> } | null;
    }>("evaluation_items", `schema_version_id=eq.${schemaVersionId}&select=id,item_type,options_json,item_key`);
    expect(persistedItems.length).toBe(ITEM_TYPE_SPECS.length);
    for (const spec of ITEM_TYPE_SPECS) {
      const row = persistedItems.find((entry) => (entry as unknown as { item_key: string }).item_key === spec.itemKey);
      expect(row, `item ${spec.itemKey} (${spec.itemType}) should exist`).toBeDefined();
      expect(row!.item_type).toBe(spec.itemType);
      if (spec.options) {
        expect(row!.options_json).not.toBeNull();
        const persistedValues = row!.options_json!.values.map((v) => v.value);
        const expectedValues = spec.options.values.map((v) => v.value);
        expect(persistedValues).toEqual(expectedValues);
      }
    }

    // Create a run and seed a typed proposal for each item.
    const runId = await createEvaluationRun(request, token, {
      projectId: env.projectId!,
      schemaVersionId,
      targetId: env.targetId!,
      name: "E2E all-types run",
    });

    const proposals = await adminInsert<{ id: string; item_id: string }>(
      "proposal_records",
      ITEM_TYPE_SPECS.map((spec) => ({
        project_id: env.projectId,
        run_id: runId,
        target_id: env.targetId,
        item_id: itemIds[spec.itemKey],
        schema_version_id: schemaVersionId,
        source_type: "system",
        value_json: spec.proposalValue,
        confidence: 1,
      }))
    );
    expect(proposals.length).toBe(ITEM_TYPE_SPECS.length);

    // Submit a reviewer "edit" decision per item carrying a typed value.
    for (const spec of ITEM_TYPE_SPECS) {
      const itemId = itemIds[spec.itemKey];
      const proposalId = proposals.find((p) => p.item_id === itemId)?.id;
      const editRes = await request.post(`${env.apiUrl}/api/v1/reviewer-decisions`, {
        headers: authHeaders(token, `${traceId}-${spec.itemKey}`),
        data: {
          project_id: env.projectId,
          run_id: runId,
          target_id: env.targetId,
          item_id: itemId,
          schema_version_id: schemaVersionId,
          proposal_id: proposalId,
          decision: "edit",
          edited_value: spec.reviewerEdit,
          rationale: `Reviewer edit for ${spec.itemType}`,
        },
      });
      expect(
        editRes.status(),
        `reviewer edit for ${spec.itemType} should be 201`
      ).toBe(201);
    }

    // Read back from the DB and assert each edited_value_json matches.
    const reviewerRows = await adminSelect<{
      item_id: string;
      decision: string;
      edited_value_json: Record<string, unknown> | null;
    }>(
      "reviewer_decision_records",
      `run_id=eq.${runId}&select=item_id,decision,edited_value_json`
    );
    expect(reviewerRows.length).toBe(ITEM_TYPE_SPECS.length);
    for (const spec of ITEM_TYPE_SPECS) {
      const itemId = itemIds[spec.itemKey];
      const row = reviewerRows.find((r) => r.item_id === itemId);
      expect(row, `reviewer row for ${spec.itemType}`).toBeDefined();
      expect(row!.decision).toBe("edit");
      expect(row!.edited_value_json).toEqual(spec.reviewerEdit);
    }

    // Verify the queue now lists every item with reviewer_state=edit.
    const queueRes = await request.get(`${env.apiUrl}/api/v1/review-queue?runId=${runId}`, {
      headers: authHeaders(token, traceId),
    });
    expect(queueRes.ok()).toBeTruthy();
    const queueBody = await parseEnvelope<{
      items: Array<{ item_id: string; reviewer_state: string }>;
    }>(queueRes);
    expect(queueBody.ok).toBeTruthy();
    for (const spec of ITEM_TYPE_SPECS) {
      const itemId = itemIds[spec.itemKey];
      const queueRow = queueBody.data.items.find((it) => it.item_id === itemId);
      expect(queueRow, `queue row for ${spec.itemType}`).toBeDefined();
      expect(queueRow!.reviewer_state).toBe("edit");
    }
  });
});
