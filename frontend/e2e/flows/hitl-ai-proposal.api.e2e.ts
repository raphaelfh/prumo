/**
 * AI proposal pipeline E2E.
 *
 * The HITL stack accepts proposals from three sources: `ai`, `human`,
 * and `system`. This test exercises the AI path end-to-end without
 * calling the LLM:
 *   1. Create a Run for an article+template, advance to PROPOSAL.
 *   2. POST /v1/runs/{id}/proposals with `source='ai'` +
 *      `confidence_score` + `rationale`.
 *   3. Advance to REVIEW; record a `decision='accept_proposal'` keyed
 *      to the proposal_record_id.
 *   4. Advance through CONSENSUS → FINALIZED via manual_override
 *      (single reviewer, no divergence).
 *   5. Verify the published value matches what AI proposed.
 *
 * This is the missing piece that was previously only tested via the
 * `section_extraction_service` unit tests; it ensures the wire format
 * of `source='ai'` proposals + their `confidence_score` round-trip
 * through the API.
 */

import { expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { resolveAuthToken, loginViaUi } from "../_fixtures/auth";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";
import { adminSelect } from "../_fixtures/supabase-admin";

interface RunSummaryResponse {
  id: string;
  stage: string;
  status: string;
  article_id: string;
  template_id: string;
}

interface ProposalRecordResponse {
  id: string;
  source: string;
  proposed_value: { value: unknown } | unknown;
  confidence_score: number | null;
}

interface RunDetailResponse {
  run: RunSummaryResponse;
  proposals: ProposalRecordResponse[];
  decisions: Array<{
    id: string;
    decision: string;
    proposal_record_id: string | null;
  }>;
  published_states: Array<{
    instance_id: string;
    field_id: string;
    value: { value: unknown } | unknown;
  }>;
}

test.describe("HITL AI proposal pipeline", () => {
  test("source='ai' proposal flows proposal → review → consensus → published", async ({
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
    const traceId = createTraceId("e2e-hitl-ai-proposal");

    // Resolve a (instance, field) coordinate within the template.
    const instances = await adminSelect<{
      id: string;
      entity_type_id: string;
    }>(
      "extraction_instances",
      `select=id,entity_type_id&template_id=eq.${env.templateId}&article_id=eq.${env.articleId}&limit=1`,
    );
    test.skip(instances.length === 0, "No extraction_instances seeded for this template+article");
    const instance = instances[0];

    const fields = await adminSelect<{ id: string; name: string }>(
      "extraction_fields",
      `select=id,name&entity_type_id=eq.${instance.entity_type_id}&limit=1`,
    );
    test.skip(fields.length === 0, "No fields under the resolved entity_type");
    const field = fields[0];

    // 1. Create a fresh run.
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
    const runBody = (await parseEnvelope<RunSummaryResponse>(createRes)).data;

    // 2. Advance to proposal.
    const advRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${runBody.id}/advance`,
      {
        headers: authHeaders(token, traceId),
        data: { target_stage: "proposal" },
        timeout: 15000,
      },
    );
    expect(advRes.ok()).toBeTruthy();

    // 3. Record an AI proposal.
    const proposalRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${runBody.id}/proposals`,
      {
        headers: authHeaders(token, traceId),
        data: {
          instance_id: instance.id,
          field_id: field.id,
          source: "ai",
          proposed_value: { value: "ai-proposed" },
          confidence_score: 0.87,
          rationale: "E2E AI proposal",
        },
        timeout: 15000,
      },
    );
    expect(proposalRes.ok()).toBeTruthy();
    const proposal = (await parseEnvelope<ProposalRecordResponse>(proposalRes)).data;
    expect(proposal.source).toBe("ai");
    expect(proposal.confidence_score).toBeCloseTo(0.87, 2);

    // 4. Advance to review and accept the AI proposal.
    await request.post(`${env.apiUrl}/api/v1/runs/${runBody.id}/advance`, {
      headers: authHeaders(token, traceId),
      data: { target_stage: "review" },
      timeout: 15000,
    });
    const decisionRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${runBody.id}/decisions`,
      {
        headers: authHeaders(token, traceId),
        data: {
          instance_id: instance.id,
          field_id: field.id,
          decision: "accept_proposal",
          proposal_record_id: proposal.id,
        },
        timeout: 15000,
      },
    );
    expect(decisionRes.ok()).toBeTruthy();

    // 5. Advance to consensus, manual_override, finalize.
    await request.post(`${env.apiUrl}/api/v1/runs/${runBody.id}/advance`, {
      headers: authHeaders(token, traceId),
      data: { target_stage: "consensus" },
      timeout: 15000,
    });
    const consensusRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${runBody.id}/consensus`,
      {
        headers: authHeaders(token, traceId),
        data: {
          instance_id: instance.id,
          field_id: field.id,
          mode: "manual_override",
          value: { value: "ai-proposed" },
          rationale: "Accept AI proposal as-is",
        },
        timeout: 15000,
      },
    );
    expect(consensusRes.ok()).toBeTruthy();
    await request.post(`${env.apiUrl}/api/v1/runs/${runBody.id}/advance`, {
      headers: authHeaders(token, traceId),
      data: { target_stage: "finalized" },
      timeout: 15000,
    });

    // 6. The published value matches the AI proposal.
    const detailRes = await request.get(
      `${env.apiUrl}/api/v1/runs/${runBody.id}`,
      { headers: authHeaders(token, traceId), timeout: 15000 },
    );
    const detail = (await parseEnvelope<RunDetailResponse>(detailRes)).data;
    expect(detail.run.stage).toBe("finalized");
    const ai = detail.proposals.find((p) => p.source === "ai");
    expect(ai).toBeTruthy();
    const accept = detail.decisions.find((d) => d.decision === "accept_proposal");
    expect(accept?.proposal_record_id).toBe(proposal.id);
    const published = detail.published_states.find(
      (p) => p.instance_id === instance.id && p.field_id === field.id,
    );
    expect(published).toBeTruthy();
    const publishedValue =
      typeof published!.value === "object" &&
      published!.value !== null &&
      "value" in (published!.value as Record<string, unknown>)
        ? (published!.value as { value: unknown }).value
        : published!.value;
    expect(publishedValue).toBe("ai-proposed");
  });
});
