/**
 * QA template clone idempotency E2E.
 *
 * `POST /api/v1/projects/{id}/qa-templates` should be idempotent on the
 * `(project_id, global_template_id)` pair: the second call returns the
 * same `project_template_id` and `version_id`, with `created=false`.
 * `POST /api/v1/qa-assessments` then layers a Run + per-domain
 * instances on top — the second call there should reuse the same Run.
 *
 * This covers a contract that's load-bearing for the QA flow: if it
 * regresses, every reload of the QA page would fork a new run and the
 * UX collapses.
 */

import { expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { loginViaUi, resolveAuthToken } from "../_fixtures/auth";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

interface CloneResponse {
  project_template_id: string;
  version_id: string;
  entity_type_count: number;
  field_count: number;
  created: boolean;
}

interface OpenSessionResponse {
  run_id: string;
  project_template_id: string;
  instances_by_entity_type: Record<string, string>;
}

test.describe("QA template clone + session idempotency", () => {
  test("clone is idempotent and qa-assessments reuses the run", async ({
    request,
    page,
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
    const traceId = createTraceId("e2e-qa-clone");

    // 1. First clone — created=true (or false if a previous run already
    //    cloned for this project).
    const first = await request.post(
      `${env.apiUrl}/api/v1/projects/${env.projectId}/qa-templates`,
      {
        headers: authHeaders(token, traceId),
        data: { global_template_id: qaTemplateId },
        timeout: 15000,
      },
    );
    expect(first.ok()).toBeTruthy();
    const firstBody = (await parseEnvelope<CloneResponse>(first)).data;
    expect(firstBody.project_template_id).toBeTruthy();
    expect(firstBody.version_id).toBeTruthy();
    expect(firstBody.entity_type_count).toBeGreaterThan(0);
    expect(firstBody.field_count).toBeGreaterThan(0);

    // 2. Second clone — must return the same IDs and created=false.
    const second = await request.post(
      `${env.apiUrl}/api/v1/projects/${env.projectId}/qa-templates`,
      {
        headers: authHeaders(token, traceId),
        data: { global_template_id: qaTemplateId },
        timeout: 15000,
      },
    );
    expect(second.ok()).toBeTruthy();
    const secondBody = (await parseEnvelope<CloneResponse>(second)).data;
    expect(secondBody.project_template_id).toBe(firstBody.project_template_id);
    expect(secondBody.version_id).toBe(firstBody.version_id);
    expect(secondBody.created).toBe(false);

    // 3. Open the session — first call may create the Run, second call
    //    must reuse it (idempotent on project + article + global template).
    const sessionPayload = {
      project_id: env.projectId,
      article_id: env.articleId,
      global_template_id: qaTemplateId,
    };
    const sessA = await request.post(`${env.apiUrl}/api/v1/qa-assessments`, {
      headers: authHeaders(token, traceId),
      data: sessionPayload,
      timeout: 30000,
    });
    expect(sessA.ok()).toBeTruthy();
    const sessionA = (await parseEnvelope<OpenSessionResponse>(sessA)).data;
    expect(sessionA.run_id).toBeTruthy();
    expect(sessionA.project_template_id).toBe(firstBody.project_template_id);
    const instanceIds = Object.values(sessionA.instances_by_entity_type);
    expect(instanceIds.length).toBeGreaterThan(0);

    const sessB = await request.post(`${env.apiUrl}/api/v1/qa-assessments`, {
      headers: authHeaders(token, traceId),
      data: sessionPayload,
      timeout: 30000,
    });
    expect(sessB.ok()).toBeTruthy();
    const sessionB = (await parseEnvelope<OpenSessionResponse>(sessB)).data;
    expect(sessionB.run_id).toBe(sessionA.run_id);
    expect(sessionB.project_template_id).toBe(sessionA.project_template_id);

    // 4. The instance map must be stable across calls (same UUIDs per
    //    entity_type) — drift here would indicate accidental re-creation.
    for (const [entityTypeId, instanceId] of Object.entries(
      sessionA.instances_by_entity_type,
    )) {
      expect(sessionB.instances_by_entity_type[entityTypeId]).toBe(instanceId);
    }
  });
});
