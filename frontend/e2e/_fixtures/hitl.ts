/**
 * HITL test helpers shared by consensus / reopen / multi-reviewer flows.
 *
 * The QA + Extraction stack treats `(project_id, article_id, kind, template_id)`
 * as the active-session key — `/api/v1/hitl/sessions` is idempotent on it.
 * That makes E2E tests that run against a shared seed flake easily: a previous
 * test can leave the active run at `consensus` or `finalized`, and the next
 * test then can't advance it back to `review` to record fresh decisions.
 *
 * `prepareCleanQaRun` solves that by hard-resetting the run row via the
 * service-role admin client before opening the session, so each test starts
 * from a deterministic `review`-stage run.
 */

import type { APIRequestContext, APIResponse } from "@playwright/test";

import { authHeaders, parseEnvelope } from "./api";
import { adminDelete, adminSelect } from "./supabase-admin";

interface OpenSessionResponse {
  run_id: string;
  kind: "extraction" | "quality_assessment";
  project_template_id: string;
  instances_by_entity_type: Record<string, string>;
}

export interface QaRunFixture {
  runId: string;
  projectTemplateId: string;
  /** entity_type_id → instance_id from the freshly opened session. */
  instancesByEntityType: Record<string, string>;
  /** First (entity_type_id, instance_id) tuple, for tests that only need one. */
  firstEntityTypeId: string;
  firstInstanceId: string;
  /** First field (id, name) under `firstEntityTypeId`. */
  firstField: { id: string; name: string };
}

interface PrepareOptions {
  request: APIRequestContext;
  apiUrl: string;
  token: string;
  projectId: string;
  articleId: string;
  qaTemplateId: string;
  traceId: string;
  /**
   * Stage to leave the run in after preparation. Defaults to `review` because
   * that's where reviewer decisions are accepted.
   */
  targetStage?: "proposal" | "review";
}

async function expectOk(res: APIResponse, label: string): Promise<void> {
  if (!res.ok()) {
    const body = await res.text().catch(() => "<unreadable>");
    throw new Error(`${label} failed: ${res.status()} ${body}`);
  }
}

/**
 * Drops any existing `extraction_runs` rows for the (project, article,
 * quality_assessment) triple. The FK chain on `proposal_records`,
 * `extraction_reviewer_decisions`, `extraction_consensus_decisions`,
 * `extraction_published_states` is `ON DELETE CASCADE`, so a single delete
 * here is enough to wipe the whole HITL state for the triple.
 */
export async function resetQaRuns(
  projectId: string,
  articleId: string,
): Promise<void> {
  await adminDelete(
    "extraction_runs",
    `project_id=eq.${projectId}&article_id=eq.${articleId}&kind=eq.quality_assessment`,
  );
}

/**
 * Resets, opens a fresh QA session, advances to `review`, and resolves a
 * concrete (instance, field) coordinate. Returns the IDs callers need to
 * record decisions / consensus picks.
 */
export async function prepareCleanQaRun(
  opts: PrepareOptions,
): Promise<QaRunFixture> {
  const targetStage = opts.targetStage ?? "review";

  await resetQaRuns(opts.projectId, opts.articleId);

  const sessionRes = await opts.request.post(
    `${opts.apiUrl}/api/v1/hitl/sessions`,
    {
      headers: authHeaders(opts.token, opts.traceId),
      data: {
        kind: "quality_assessment",
        project_id: opts.projectId,
        article_id: opts.articleId,
        global_template_id: opts.qaTemplateId,
      },
      timeout: 30000,
    },
  );
  await expectOk(sessionRes, "POST /api/v1/hitl/sessions");
  const session = (await parseEnvelope<OpenSessionResponse>(sessionRes)).data;

  const entries = Object.entries(session.instances_by_entity_type);
  if (entries.length === 0) {
    throw new Error("QA session returned no instances_by_entity_type");
  }
  const [firstEntityTypeId, firstInstanceId] = entries[0];

  const fields = await adminSelect<{ id: string; name: string }>(
    "extraction_fields",
    `select=id,name&entity_type_id=eq.${firstEntityTypeId}&limit=1`,
  );
  if (fields.length === 0) {
    throw new Error(
      `QA template entity_type ${firstEntityTypeId} has no extraction_fields rows`,
    );
  }

  if (targetStage === "review") {
    const advanceRes = await opts.request.post(
      `${opts.apiUrl}/api/v1/runs/${session.run_id}/advance`,
      {
        headers: authHeaders(opts.token, opts.traceId),
        data: { target_stage: "review" },
        timeout: 15000,
      },
    );
    await expectOk(advanceRes, "advance proposal → review");
  }

  return {
    runId: session.run_id,
    projectTemplateId: session.project_template_id,
    instancesByEntityType: session.instances_by_entity_type,
    firstEntityTypeId,
    firstInstanceId,
    firstField: fields[0],
  };
}
