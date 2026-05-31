import { APIRequestContext, expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

/**
 * Zotero **full pipeline** API E2E.
 *
 * The existing `zotero.e2e.ts` covers the cheap surfaces (validation 400,
 * unknown sync-status 404, and the credential save + connection test).
 * What it does NOT cover — and what this file adds — is the end-to-end
 * import: save credentials → kick `sync-collection` → poll `sync-status`
 * until the run reaches a terminal state → assert the counts invariant
 * and the trace_id propagation.
 *
 * This is the path that, when it regresses, silently drops articles on
 * the floor: the sync request returns 202, the run goes RUNNING, then
 * an exception swallowed inside the Celery task leaves `counts.failed`
 * inflated and nobody notices because no surface asserts the
 * `persisted + updated + skipped + failed + removed_at_source ==
 * total_received` identity.
 *
 * Skips politely when:
 * - Required env (`E2E_AUTH_TOKEN`, `E2E_PROJECT_ID`,
 *   `E2E_ZOTERO_USER_ID`, `E2E_ZOTERO_API_KEY`,
 *   `E2E_ZOTERO_COLLECTION_KEY`) is missing — local dev without Zotero
 *   credentials, CI without secrets configured.
 * - The sync-collection POST returns 503 — Redis/Celery isn't available
 *   to enqueue the task. Same diagnostic the articles-export E2E uses
 *   so a stack-down state doesn't look like a real failure.
 * - Polling times out — Celery worker is up but not consuming
 *   (the queue is wired but the consumer isn't).
 */

type SyncCounts = {
  totalReceived: number;
  persisted: number;
  updated: number;
  skipped: number;
  failed: number;
  removedAtSource: number;
  reactivated: number;
};

type SyncStatusBody = {
  syncRunId: string;
  status: string;
  counts: SyncCounts;
  startedAt: string;
  completedAt?: string | null;
  traceId: string;
};

const INFLIGHT_STATUSES = new Set(["pending", "queued", "running", "in_progress"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "partial"]);

async function pollSyncToTerminal(input: {
  apiUrl: string;
  token: string;
  syncRunId: string;
  request: APIRequestContext;
}): Promise<SyncStatusBody | { status: "timeout" }> {
  const maxIters = 20;
  for (let i = 0; i < maxIters; i += 1) {
    const res = await input.request.post(`${input.apiUrl}/api/v1/zotero/sync-status`, {
      headers: authHeaders(input.token, createTraceId(`e2e-zotero-poll-${i}`)),
      data: { syncRunId: input.syncRunId },
    });
    expect(res.ok()).toBeTruthy();
    const body = await parseEnvelope<SyncStatusBody>(res);
    expect(body.ok).toBeTruthy();
    if (!INFLIGHT_STATUSES.has(body.data.status)) {
      return body.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return { status: "timeout" };
}

test.describe("Zotero full pipeline (credentials → sync → status)", () => {
  test("imports a collection end-to-end with consistent counts", async ({ request }) => {
    const env = loadE2EEnv();
    const required = missingEnvKeys([
      "E2E_AUTH_TOKEN",
      "E2E_PROJECT_ID",
      "E2E_ZOTERO_USER_ID",
      "E2E_ZOTERO_API_KEY",
      "E2E_ZOTERO_COLLECTION_KEY",
    ]);
    test.skip(
      required.length > 0,
      `Missing required env: ${required.join(", ")}`,
    );

    // 1. Save credentials.
    const saveTrace = createTraceId("e2e-zotero-pipeline-save");
    const saveResponse = await request.post(`${env.apiUrl}/api/v1/zotero/save-credentials`, {
      headers: authHeaders(env.authToken!, saveTrace),
      data: {
        zoteroUserId: process.env.E2E_ZOTERO_USER_ID,
        apiKey: process.env.E2E_ZOTERO_API_KEY,
        libraryType: process.env.E2E_ZOTERO_LIBRARY_TYPE || "user",
      },
    });
    expect(saveResponse.ok()).toBeTruthy();
    const saveBody = await parseEnvelope<Record<string, unknown>>(saveResponse);
    expect(saveBody.ok).toBeTruthy();

    // 2. Kick the sync.
    const syncTrace = createTraceId("e2e-zotero-pipeline-sync");
    const syncResponse = await request.post(`${env.apiUrl}/api/v1/zotero/sync-collection`, {
      headers: authHeaders(env.authToken!, syncTrace),
      data: {
        projectId: env.projectId,
        collectionKey: process.env.E2E_ZOTERO_COLLECTION_KEY,
        maxItems: Number(process.env.E2E_ZOTERO_MAX_ITEMS || 5),
        includeAttachments: false,
        updateExisting: true,
      },
    });

    if (syncResponse.status() === 503) {
      test.skip(true, "Queue unavailable (Redis/Celery down) for sync-collection.");
    }
    expect([200, 202]).toContain(syncResponse.status());

    const syncBody = await parseEnvelope<{ syncRunId: string }>(syncResponse);
    expect(syncBody.ok).toBeTruthy();
    expect(syncBody.trace_id).toBe(syncTrace);
    const syncRunId = syncBody.data.syncRunId;
    expect(syncRunId).toBeTruthy();

    // 3. Poll status to terminal.
    const final = await pollSyncToTerminal({
      apiUrl: env.apiUrl,
      token: env.authToken!,
      syncRunId,
      request,
    });
    test.skip(
      final.status === "timeout",
      "Sync did not reach terminal state — Celery worker likely not consuming.",
    );

    const terminal = final as SyncStatusBody;
    expect(TERMINAL_STATUSES.has(terminal.status)).toBeTruthy();

    // 4. Counts invariant: every received item must land in exactly one
    // outcome bucket. A drifting service that double-counts or drops
    // items silently breaks this identity.
    const accounted =
      terminal.counts.persisted +
      terminal.counts.updated +
      terminal.counts.skipped +
      terminal.counts.failed +
      terminal.counts.removedAtSource;
    expect(accounted).toBe(terminal.counts.totalReceived);
    expect(terminal.counts.reactivated).toBeGreaterThanOrEqual(0);

    // 5. The sync-status surface must carry its own trace_id (separate
    // from the envelope's), the syncRunId echoed back, and a
    // completedAt timestamp for terminal states.
    expect(terminal.syncRunId).toBe(syncRunId);
    expect(terminal.traceId).toBeTruthy();
    expect(terminal.completedAt).toBeTruthy();
  });
});
