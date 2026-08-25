/**
 * AI proposal pipeline E2E.
 *
 * No HTTP route writes proposals: the `/proposals` endpoint was removed once
 * every source it accepted turned out to be forbidden (ADR-0019). `ai` and
 * `system` rows are written in-process; `human` values go to /decisions. This
 * test exercises the AI path end-to-end without calling the LLM:
 *   1. Create a Run for an article+template, advance to PROPOSAL.
 *   2. Assert the route is gone, then seed the row the way
 *      SectionExtractionService writes it, with `confidence_score` +
 *      `rationale`.
 *   3. Advance to REVIEW; record a `decision='accept_proposal'` keyed
 *      to the proposal_record_id.
 *   4. Advance through CONSENSUS → FINALIZED via manual_override
 *      (single reviewer, no divergence).
 *   5. Verify the published value matches what AI proposed.
 *
 * This is the missing piece that was previously only tested via the
 * `section_extraction_service` unit tests; it ensures a stored
 * `source='ai'` proposal + its `confidence_score` round-trip through the
 * read API and the decision/consensus chain.
 */

import { expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { resolveAuthToken, loginViaUi } from "../_fixtures/auth";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";
import { fillRequiredFieldsAndFinalize } from "../_fixtures/hitl-finalize";
import {
  adminDelete,
  adminSelect,
  resolveActiveExtractionTemplateId,
  seedProposals,
} from "../_fixtures/supabase-admin";

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
  test("source='ai' proposal flows extract → consensus → published", async ({
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
    const traceId = createTraceId("e2e-hitl-ai-proposal");
    const templateId = await resolveActiveExtractionTemplateId(env.projectId!);

    // Seed instances via a HITL session (idempotent), then clear the runs it
    // leaves behind. Under the one-live-run invariant (migration 0045) the
    // session's live run would make the fresh `POST /runs` below collide with
    // `uq_one_live_extraction_run_per_coord` (409). Deleting extraction_runs
    // leaves the seeded extraction_instances intact. Mirrors
    // extraction-reopen.ui.e2e.ts; the leading delete also clears any run a
    // sibling test left on this shared coordinate.
    await adminDelete(
      "extraction_runs",
      `project_id=eq.${env.projectId}&article_id=eq.${env.articleId}&kind=eq.extraction`,
    );
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
    await adminDelete(
      "extraction_runs",
      `project_id=eq.${env.projectId}&article_id=eq.${env.articleId}&kind=eq.extraction`,
    );

    // Resolve a (instance, field) coordinate within the template — iterate
    // until we find an entity_type that actually has fields, since the
    // shared template may also host transient entity_types from other tests.
    const instances = await adminSelect<{
      id: string;
      entity_type_id: string;
    }>(
      "extraction_instances",
      `select=id,entity_type_id&template_id=eq.${templateId}&article_id=eq.${env.articleId}&limit=50`,
    );
    test.skip(instances.length === 0, "No extraction_instances seeded for this template+article");

    let instance: { id: string; entity_type_id: string } | null = null;
    let field: { id: string; name: string } | null = null;
    for (const inst of instances) {
      const fs = await adminSelect<{ id: string; name: string }>(
        "extraction_fields",
        `select=id,name&entity_type_id=eq.${inst.entity_type_id}&limit=1`,
      );
      if (fs.length > 0) {
        instance = inst;
        field = fs[0];
        break;
      }
    }
    test.skip(!instance || !field, "No (instance, field) coordinate available");
    if (!instance || !field) throw new Error("No (instance, field) coordinate — test.skip should have exited");

    // 1. Create a fresh run.
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
    const runBody = (await parseEnvelope<RunSummaryResponse>(createRes)).data;

    // 2. Advance to extract.
    const advRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${runBody.id}/advance`,
      {
        headers: authHeaders(token, traceId),
        data: { target_stage: "extract" },
        timeout: 15000,
      },
    );
    expect(advRes.ok()).toBeTruthy();

    // 3a. There is no HTTP route to author a proposal at all (ADR-0019).
    // Blind peers read AI rows unattributed, so a caller-authored one would be
    // a forged model suggestion — confidence and rationale included.
    const forged = await request.post(
      `${env.apiUrl}/api/v1/runs/${runBody.id}/proposals`,
      {
        headers: authHeaders(token, traceId),
        data: {
          instance_id: instance.id,
          field_id: field.id,
          source: "ai",
          proposed_value: { value: "forged-ai-suggestion" },
          confidence_score: 0.99,
          rationale: "looks authoritative",
        },
        timeout: 15000,
      },
    );
    expect(forged.status()).toBe(404);

    // 3b. Seed it the way the pipeline does.
    const [proposalId] = await seedProposals([
      {
        runId: runBody.id,
        instanceId: instance.id,
        fieldId: field.id,
        source: "ai",
        value: "ai-proposed",
        confidenceScore: 0.87,
        rationale: "E2E AI proposal",
      },
    ]);

    // 4. Accept the AI proposal (recorded as a decision in extract).
    const decisionRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${runBody.id}/decisions`,
      {
        headers: authHeaders(token, traceId),
        data: {
          instance_id: instance.id,
          field_id: field.id,
          decision: "accept_proposal",
          proposal_record_id: proposalId,
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
    // Completeness gate (ADR-0009): the AI-proposed coord above is published;
    // fill the remaining required fields, then finalize.
    await fillRequiredFieldsAndFinalize(request, {
      apiUrl: env.apiUrl,
      token,
      traceId,
      runId: runBody.id,
      templateId,
      articleId: env.articleId!,
    });

    // 6. The published value matches the AI proposal.
    const detailRes = await request.get(
      `${env.apiUrl}/api/v1/runs/${runBody.id}`,
      { headers: authHeaders(token, traceId), timeout: 15000 },
    );
    const detail = (await parseEnvelope<RunDetailResponse>(detailRes)).data;
    expect(detail.run.stage).toBe("finalized");
    const ai = detail.proposals.find((p) => p.id === proposalId);
    expect(ai?.source).toBe("ai");
    expect(ai?.confidence_score).toBeCloseTo(0.87, 2);
    const accept = detail.decisions.find((d) => d.decision === "accept_proposal");
    expect(accept?.proposal_record_id).toBe(proposalId);
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
