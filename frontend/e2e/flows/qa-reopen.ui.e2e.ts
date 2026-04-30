/**
 * Reopen-finalized-run E2E flow (HITL Option C).
 *
 * Drives the API surface that backs the "Reopen for revision" button:
 *   1. Open a QA session and publish (manual_override → finalize).
 *   2. Hit `POST /api/v1/runs/{id}/reopen` and verify the response is a
 *      fresh run with `stage=review`, `parameters.parent_run_id` ref,
 *      and seeded `source=system` proposals derived from the finalized
 *      run's PublishedState rows.
 *   3. Verify the old (parent) run survived untouched — its stage stays
 *      `finalized` and its PublishedStates are still readable.
 *
 * UI assertion is intentionally light: we visit the page and expect the
 * `qa-revision-badge` to render once the reopen call has been issued.
 *
 * Skips when env credentials/IDs are missing — same fixture set as
 * `qa-flow.ui.e2e.ts`.
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

interface ProposalRecord {
  id: string;
  run_id: string;
  instance_id: string;
  field_id: string;
  source: string;
  source_user_id: string | null;
}

interface RunDetailResponse {
  run: {
    id: string;
    stage: string;
    status: string;
    parameters: Record<string, unknown> | null;
  };
  proposals: ProposalRecord[];
  published_states: Array<{
    instance_id: string;
    field_id: string;
    value: unknown;
    version: number;
  }>;
}

test.describe("HITL reopen flow (Option C)", () => {
  test("reopen creates a derived run with seeded proposals", async ({
    page,
    request,
  }) => {
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
    const token = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-qa-reopen");

    // 1. Open / resume the QA session.
    const sessionRes = await request.post(`${env.apiUrl}/api/v1/hitl/sessions`, {
      headers: authHeaders(token, traceId),
      data: {
        kind: "quality_assessment",
        project_id: env.projectId,
        article_id: env.articleId,
        global_template_id: qaTemplateId,
      },
      timeout: 30000,
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = (await parseEnvelope<OpenSessionResponse>(sessionRes)).data;

    // 2. Get a runnable (instance, field) coordinate and publish a value.
    const detailRes = await request.get(
      `${env.apiUrl}/api/v1/runs/${session.run_id}`,
      { headers: authHeaders(token, traceId), timeout: 15000 },
    );
    expect(detailRes.ok()).toBeTruthy();
    const detail = (await parseEnvelope<RunDetailResponse>(detailRes)).data;
    const stage = detail.run.stage;

    // The session opens into PROPOSAL by design; advance it to REVIEW
    // → CONSENSUS so manual_override is accepted.
    if (stage === "proposal") {
      await request.post(
        `${env.apiUrl}/api/v1/runs/${session.run_id}/advance`,
        {
          headers: authHeaders(token, traceId),
          data: { target_stage: "review" },
          timeout: 15000,
        },
      );
    }
    await request.post(
      `${env.apiUrl}/api/v1/runs/${session.run_id}/advance`,
      {
        headers: authHeaders(token, traceId),
        data: { target_stage: "consensus" },
        timeout: 15000,
      },
    );

    const [firstEntityTypeId, firstInstanceId] = Object.entries(
      session.instances_by_entity_type,
    )[0];
    expect(firstEntityTypeId).toBeTruthy();
    expect(firstInstanceId).toBeTruthy();

    // Find a field for that entity_type via Supabase REST. The
    // /api/v1/runs/{id} detail doesn't include the template tree, so we
    // use the admin client (already used by other fixtures) to read a
    // single field for the entity_type.
    const fields = await adminSelect<{ id: string; name: string }>(
      "extraction_fields",
      `select=id,name&entity_type_id=eq.${firstEntityTypeId}&limit=1`,
    );
    test.skip(
      fields.length === 0,
      "QA template has no fields for the first entity_type",
    );
    const firstField = fields[0];

    // Publish a value via manual_override.
    const consensusRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${session.run_id}/consensus`,
      {
        headers: authHeaders(token, traceId),
        data: {
          instance_id: firstInstanceId,
          field_id: firstField.id,
          mode: "manual_override",
          value: { value: "Y" },
          rationale: "Reopen E2E seed",
        },
        timeout: 15000,
      },
    );
    expect(consensusRes.ok()).toBeTruthy();

    await request.post(
      `${env.apiUrl}/api/v1/runs/${session.run_id}/advance`,
      {
        headers: authHeaders(token, traceId),
        data: { target_stage: "finalized" },
        timeout: 15000,
      },
    );

    // Verify finalized.
    const finalizedRes = await request.get(
      `${env.apiUrl}/api/v1/runs/${session.run_id}`,
      { headers: authHeaders(token, traceId), timeout: 15000 },
    );
    const finalizedBody = (await parseEnvelope<RunDetailResponse>(finalizedRes)).data;
    expect(finalizedBody.run.stage).toBe("finalized");
    expect(finalizedBody.published_states.length).toBeGreaterThan(0);

    // 3. Reopen.
    const reopenRes = await request.post(
      `${env.apiUrl}/api/v1/runs/${session.run_id}/reopen`,
      { headers: authHeaders(token, traceId), timeout: 15000 },
    );
    expect(reopenRes.ok()).toBeTruthy();
    const reopenBody = (await parseEnvelope<{
      id: string;
      stage: string;
      parameters: Record<string, unknown> | null;
    }>(reopenRes)).data;
    expect(reopenBody.id).not.toBe(session.run_id);
    expect(reopenBody.stage).toBe("review");
    expect(reopenBody.parameters).toBeTruthy();
    expect((reopenBody.parameters as Record<string, unknown>).parent_run_id).toBe(
      session.run_id,
    );

    // 4. New run carries seeded proposals from the parent's PublishedState.
    const newDetailRes = await request.get(
      `${env.apiUrl}/api/v1/runs/${reopenBody.id}`,
      { headers: authHeaders(token, traceId), timeout: 15000 },
    );
    const newDetail = (await parseEnvelope<RunDetailResponse>(newDetailRes)).data;
    expect(newDetail.run.stage).toBe("review");
    const systemProposals = newDetail.proposals.filter((p) => p.source === "system");
    expect(systemProposals.length).toBe(finalizedBody.published_states.length);

    // 5. Old run survives untouched.
    const oldDetailRes = await request.get(
      `${env.apiUrl}/api/v1/runs/${session.run_id}`,
      { headers: authHeaders(token, traceId), timeout: 15000 },
    );
    const oldDetail = (await parseEnvelope<RunDetailResponse>(oldDetailRes)).data;
    expect(oldDetail.run.stage).toBe("finalized");
    expect(oldDetail.published_states.length).toBeGreaterThan(0);

    // 6. UI surface — the QA page now shows the "Revision" badge for the
    //    new (latest) run.
    await page.goto(
      `${env.frontendUrl}/projects/${env.projectId}/articles/${env.articleId}/quality-assessment/${qaTemplateId}`,
    );
    await expect(page.getByTestId("qa-revision-badge")).toBeVisible({
      timeout: 20000,
    });
  });
});
