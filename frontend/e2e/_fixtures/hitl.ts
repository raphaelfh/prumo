/**
 * HITL test helpers shared by consensus / reopen / multi-reviewer flows.
 *
 * The QA + Extraction stack treats `(project_id, article_id, kind, template_id)`
 * as the active-session key — `/api/v1/hitl/sessions` is idempotent on it.
 * That makes E2E tests that run against a shared seed flake easily: a previous
 * test can leave the active run at `consensus` or `finalized`, and the next
 * test then can't get a fresh `extract`-stage run to record decisions on.
 *
 * `prepareCleanQaRun` solves that by hard-resetting the run row via the
 * service-role admin client before opening the session, so each test starts
 * from a deterministic `extract`-stage run.
 */

import type { APIRequestContext, APIResponse } from "@playwright/test";

import { authHeaders, parseEnvelope } from "./api";
import { adminDelete, adminInsert, adminSelect } from "./supabase-admin";
import type { ReviewKind } from "../../lib/comparison/permissions";

interface OpenSessionResponse {
  run_id: string;
  kind: ReviewKind;
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
   * Stage to leave the run in after preparation. Defaults to `extract` — the
   * single editable stage where reviewer decisions are accepted (session open
   * already parks the run there).
   */
  targetStage?: "extract";
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
async function resetQaRuns(
  projectId: string,
  articleId: string,
): Promise<void> {
  await adminDelete(
    "extraction_runs",
    `project_id=eq.${projectId}&article_id=eq.${articleId}&kind=eq.quality_assessment`,
  );
}

/**
 * Resets, opens a fresh QA session (which parks the run in `extract`), and
 * resolves a concrete (instance, field) coordinate. Returns the IDs callers
 * need to record decisions / consensus picks.
 */
export async function prepareCleanQaRun(
  opts: PrepareOptions,
): Promise<QaRunFixture> {
  const targetStage = opts.targetStage ?? "extract";

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

  // Iterate over entity_types until we find one with extraction_fields. The
  // PROBAST clone can be polluted with transient test-only entity types
  // (extraction-multi-instance test creates them under the same template),
  // and Object.entries() ordering is not stable enough to rely on the first
  // entry being the real PROBAST domain.
  let firstEntityTypeId: string | null = null;
  let firstInstanceId: string | null = null;
  let firstField: { id: string; name: string } | null = null;
  for (const [entityTypeId, instanceId] of entries) {
    const fields = await adminSelect<{ id: string; name: string }>(
      "extraction_fields",
      `select=id,name&entity_type_id=eq.${entityTypeId}&limit=1`,
    );
    if (fields.length > 0) {
      firstEntityTypeId = entityTypeId;
      firstInstanceId = instanceId;
      firstField = fields[0];
      break;
    }
  }
  if (!firstEntityTypeId || !firstInstanceId || !firstField) {
    throw new Error(
      "QA template has no entity_type with at least one extraction_field",
    );
  }

  if (targetStage === "extract") {
    // /hitl/sessions opens the QA run directly in `extract` (session open parks
    // it there). The contract here is only "leave the run at extract", so this
    // is a no-op verification in the common case; the advance below only fires
    // if a sibling suite sharing this (project, article) fixture moved it back
    // to pending, and pending→extract is the one valid forward edge.
    const stageOf = async (): Promise<string> => {
      const detailRes = await opts.request.get(
        `${opts.apiUrl}/api/v1/runs/${session.run_id}`,
        { headers: authHeaders(opts.token, opts.traceId), timeout: 15000 },
      );
      await expectOk(detailRes, "fetch run detail");
      return (await parseEnvelope<{ run: { stage: string } }>(detailRes)).data
        .run.stage;
    };
    if ((await stageOf()) !== "extract") {
      const advanceRes = await opts.request.post(
        `${opts.apiUrl}/api/v1/runs/${session.run_id}/advance`,
        {
          headers: authHeaders(opts.token, opts.traceId),
          data: { target_stage: "extract" },
          timeout: 15000,
        },
      );
      // A concurrent prepare on the shared fixture may have moved the run to
      // extract between our read and this write; that's the desired end state,
      // so only fail if it is genuinely not at extract afterwards.
      if (!advanceRes.ok() && (await stageOf()) !== "extract") {
        await expectOk(advanceRes, "advance pending → extract");
      }
    }
  }

  return {
    runId: session.run_id,
    projectTemplateId: session.project_template_id,
    instancesByEntityType: session.instances_by_entity_type,
    firstEntityTypeId,
    firstInstanceId,
    firstField,
  };
}

export interface ProposalSeed {
  runId: string;
  instanceId: string;
  fieldId: string;
  source: "ai" | "human" | "system";
  /** Inner value; stored wrapped as `{ value }`, matching the write path. */
  value: unknown;
  /** Only human rows carry attribution; ai/system are unattributed. */
  sourceUserId?: string | null;
  confidenceScore?: number;
  rationale?: string;
}

/**
 * Seed proposal rows straight into `extraction_proposal_records`.
 *
 * No HTTP route writes proposals: the `/proposals` endpoint was removed once
 * every source it accepted turned out to be forbidden (ADR-0019). `ai` and
 * `system` rows are written in-process by the pipeline, and bare `human` rows
 * exist only as pre-D8 legacy data. Both are reproduced here the way they
 * really land, with the column list in one place so a schema change is one
 * edit rather than a hunt.
 *
 * Returns the generated ids, in the order the seeds were given.
 */
export async function seedProposals(seeds: ProposalSeed[]): Promise<string[]> {
  const rows = seeds.map((seed) => ({
    id: crypto.randomUUID(),
    run_id: seed.runId,
    instance_id: seed.instanceId,
    field_id: seed.fieldId,
    source: seed.source,
    source_user_id: seed.sourceUserId ?? null,
    proposed_value: { value: seed.value },
    ...(seed.confidenceScore === undefined ? {} : { confidence_score: seed.confidenceScore }),
    ...(seed.rationale === undefined ? {} : { rationale: seed.rationale }),
  }));
  await adminInsert("extraction_proposal_records", rows);
  return rows.map((row) => row.id);
}
