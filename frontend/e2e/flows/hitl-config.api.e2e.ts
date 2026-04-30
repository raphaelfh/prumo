/**
 * HITL configuration CRUD E2E.
 *
 * Pins the contract surface used by Project Settings → Review consensus:
 *   1. GET /projects/{id}/hitl-config returns the system default for a
 *      brand-new project, with `inherited=true`.
 *   2. PUT then GET roundtrip persists `reviewer_count`, `consensus_rule`
 *      and clears `inherited`.
 *   3. PUT with `consensus_rule='arbitrator'` and a non-member
 *      `arbitrator_id` fails 400.
 *   4. Template-scoped GET inherits from the project default until a
 *      template-specific override is PUT, after which it takes priority.
 *   5. DELETE on either scope falls back up the resolution chain.
 *
 * The test cleans up the project-scoped row (and any template override)
 * at the end so re-runs start from a known state.
 */

import { expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { loginViaUi, resolveAuthToken } from "../_fixtures/auth";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

interface HitlConfigRead {
  scope_kind: "project" | "template" | "system_default";
  scope_id: string | null;
  reviewer_count: number;
  consensus_rule: "unanimous" | "majority" | "arbitrator";
  arbitrator_id: string | null;
  inherited: boolean;
}

const NON_MEMBER_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("HITL config CRUD", () => {
  test("project + template scope resolution and validation", async ({
    page,
    request,
  }) => {
    const required = missingEnvKeys([
      "E2E_USER_EMAIL",
      "E2E_USER_PASSWORD",
      "E2E_PROJECT_ID",
      "E2E_TEMPLATE_ID",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    const token = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-hitl-config");

    const projectUrl = `${env.apiUrl}/api/v1/projects/${env.projectId}/hitl-config`;
    const templateUrl = `${env.apiUrl}/api/v1/projects/${env.projectId}/templates/${env.templateId}/hitl-config`;

    // Reset to a known starting state. Both DELETEs are idempotent (the
    // backend returns the resolved fallback even when no row existed).
    await request.delete(templateUrl, { headers: authHeaders(token, traceId) });
    await request.delete(projectUrl, { headers: authHeaders(token, traceId) });

    try {
      // 1. Empty state — system default with inherited=true.
      const emptyRes = await request.get(projectUrl, {
        headers: authHeaders(token, traceId),
      });
      expect(emptyRes.status()).toBe(200);
      const emptyBody = await parseEnvelope<HitlConfigRead>(emptyRes);
      expect(emptyBody.ok).toBe(true);
      expect(emptyBody.data.scope_kind).toBe("system_default");
      expect(emptyBody.data.reviewer_count).toBe(1);
      expect(emptyBody.data.consensus_rule).toBe("unanimous");
      expect(emptyBody.data.inherited).toBe(true);

      // 2. PUT roundtrip at project scope.
      const putRes = await request.put(projectUrl, {
        headers: authHeaders(token, traceId),
        data: {
          reviewer_count: 2,
          consensus_rule: "majority",
          arbitrator_id: null,
        },
      });
      expect(putRes.status()).toBe(200);
      const putBody = await parseEnvelope<HitlConfigRead>(putRes);
      expect(putBody.data.scope_kind).toBe("project");
      expect(putBody.data.reviewer_count).toBe(2);
      expect(putBody.data.consensus_rule).toBe("majority");
      expect(putBody.data.inherited).toBe(false);

      // 3. arbitrator validation: non-member ⇒ 400.
      const badRes = await request.put(projectUrl, {
        headers: authHeaders(token, traceId),
        data: {
          reviewer_count: 2,
          consensus_rule: "arbitrator",
          arbitrator_id: NON_MEMBER_UUID,
        },
      });
      expect(badRes.status()).toBe(400);

      // 4. Template scope — first inherits, then overrides.
      const inheritRes = await request.get(templateUrl, {
        headers: authHeaders(token, traceId),
      });
      expect(inheritRes.status()).toBe(200);
      const inheritBody = await parseEnvelope<HitlConfigRead>(inheritRes);
      expect(inheritBody.data.scope_kind).toBe("project");
      expect(inheritBody.data.reviewer_count).toBe(2);
      expect(inheritBody.data.inherited).toBe(true);

      const overrideRes = await request.put(templateUrl, {
        headers: authHeaders(token, traceId),
        data: {
          reviewer_count: 3,
          consensus_rule: "unanimous",
          arbitrator_id: null,
        },
      });
      expect(overrideRes.status()).toBe(200);
      const overrideBody = await parseEnvelope<HitlConfigRead>(overrideRes);
      expect(overrideBody.data.scope_kind).toBe("template");
      expect(overrideBody.data.reviewer_count).toBe(3);
      expect(overrideBody.data.inherited).toBe(false);

      // 5. DELETE template override falls back to project default.
      const tplDelRes = await request.delete(templateUrl, {
        headers: authHeaders(token, traceId),
      });
      expect(tplDelRes.status()).toBe(200);
      const tplDelBody = await parseEnvelope<HitlConfigRead>(tplDelRes);
      expect(tplDelBody.data.scope_kind).toBe("project");
      expect(tplDelBody.data.inherited).toBe(true);

      // DELETE project default falls back to system default.
      const projDelRes = await request.delete(projectUrl, {
        headers: authHeaders(token, traceId),
      });
      expect(projDelRes.status()).toBe(200);
      const projDelBody = await parseEnvelope<HitlConfigRead>(projDelRes);
      expect(projDelBody.data.scope_kind).toBe("system_default");
      expect(projDelBody.data.inherited).toBe(true);
    } finally {
      await request.delete(templateUrl, { headers: authHeaders(token, traceId) });
      await request.delete(projectUrl, { headers: authHeaders(token, traceId) });
    }
  });
});
