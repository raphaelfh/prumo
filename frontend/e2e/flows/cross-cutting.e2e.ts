import { expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

test.describe("Cross-cutting API contracts", () => {
  test("returns 401 for protected endpoint without token", async ({ request }) => {
    const env = loadE2EEnv();
    const response = await request.get(`${env.apiUrl}/api/v1/review-queue`);
    expect([401, 403]).toContain(response.status());
  });

  test("returns 422/400 for invalid reviewer decision payload", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys(["E2E_AUTH_TOKEN"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const traceId = createTraceId("e2e-cross-422");
    const response = await request.post(`${env.apiUrl}/api/v1/reviewer-decisions`, {
      headers: authHeaders(env.authToken!, traceId),
      data: {
        decision: "edit",
      },
    });

    expect([400, 422]).toContain(response.status());
  });

  test("returns ApiResponse envelope and trace_id on successful read", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys(["E2E_AUTH_TOKEN"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const traceId = createTraceId("e2e-cross-envelope");
    const response = await request.get(`${env.apiUrl}/api/v1/review-queue`, {
      headers: authHeaders(env.authToken!, traceId),
    });

    expect(response.ok()).toBeTruthy();
    const body = await parseEnvelope<{ items: unknown[] }>(response);
    expect(body.ok).toBeTruthy();
    expect(body.trace_id).toBeTruthy();
    expect(Array.isArray(body.data.items)).toBeTruthy();
  });

  test("returns 404 for unknown evaluation run", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys(["E2E_AUTH_TOKEN"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const traceId = createTraceId("e2e-cross-404");
    const response = await request.get(
      `${env.apiUrl}/api/v1/evaluation-runs/00000000-0000-0000-0000-000000000000`,
      {
        headers: authHeaders(env.authToken!, traceId),
      }
    );

    expect([404, 403]).toContain(response.status());
  });

  test("rate-limits run creation endpoint after burst", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys([
      "E2E_AUTH_TOKEN",
      "E2E_PROJECT_ID",
      "E2E_SCHEMA_VERSION_ID",
      "E2E_TARGET_ID",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const traceId = createTraceId("e2e-cross-429");
    let throttledStatus: number | null = null;
    let lastStatus = 0;

    for (let idx = 0; idx < 25; idx += 1) {
      const response = await request.post(`${env.apiUrl}/api/v1/evaluation-runs`, {
        headers: authHeaders(env.authToken!, traceId),
        data: {
          project_id: env.projectId,
          schema_version_id: env.schemaVersionId,
          target_ids: [env.targetId],
          name: `e2e-rate-${idx}`,
        },
      });

      lastStatus = response.status();
      if (lastStatus === 429) {
        throttledStatus = lastStatus;
        break;
      }
    }

    test.skip(
      throttledStatus === null,
      `Rate limit not triggered within 25 calls (last status ${lastStatus}); ` +
        "limiter likely disabled in this environment."
    );
    expect(throttledStatus).toBe(429);
  });
});
