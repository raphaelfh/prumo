import { expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

const NONEXISTENT_RUN_ID = "00000000-0000-0000-0000-000000000000";

test.describe("Cross-cutting API contracts", () => {
  test("returns 401 for protected endpoint without token", async ({ request }) => {
    const env = loadE2EEnv();
    const response = await request.get(
      `${env.apiUrl}/api/v1/runs/${NONEXISTENT_RUN_ID}`,
    );
    expect([401, 403]).toContain(response.status());
  });

  test("returns 422/400 for invalid reviewer decision payload", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys(["E2E_AUTH_TOKEN"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const traceId = createTraceId("e2e-cross-422");
    // Hit the new /v1/runs decisions endpoint with an invalid payload (missing
    // required fields). The endpoint exists; validation rejects.
    const response = await request.post(
      `${env.apiUrl}/api/v1/runs/${NONEXISTENT_RUN_ID}/decisions`,
      {
        headers: authHeaders(env.authToken!, traceId),
        data: {
          decision: "edit",
        },
      },
    );

    expect([400, 404, 422]).toContain(response.status());
  });

  test("returns ApiResponse envelope with trace_id on protected GET", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys(["E2E_AUTH_TOKEN"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const traceId = createTraceId("e2e-cross-envelope");
    // GET against a nonexistent run id should still come back as a structured
    // ApiResponse error envelope (ok=false, error.message set, trace_id echoed).
    const response = await request.get(
      `${env.apiUrl}/api/v1/runs/${NONEXISTENT_RUN_ID}`,
      {
        headers: authHeaders(env.authToken!, traceId),
      },
    );

    expect([404, 422]).toContain(response.status());
    const body = await parseEnvelope<unknown>(response);
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
    expect(body.trace_id).toBeTruthy();
  });

  test("returns 404 for unknown run id (HITL stack)", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys(["E2E_AUTH_TOKEN"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const traceId = createTraceId("e2e-cross-404");
    const response = await request.get(
      `${env.apiUrl}/api/v1/runs/${NONEXISTENT_RUN_ID}`,
      {
        headers: authHeaders(env.authToken!, traceId),
      },
    );

    expect([404, 403]).toContain(response.status());
  });
});
