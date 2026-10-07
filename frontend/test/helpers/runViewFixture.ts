/**
 * The one RunView fixture for both run screens (extraction and quality
 * assessment) and the lifecycle they share: `GET /api/v1/runs/{id}/view` as
 * the backend serializes it, with every array empty unless a suite names it.
 *
 * Deliberately imports NO component, and `vitest` only for the permission
 * stubs' `refresh` spy: suites pull it in from inside `vi.mock` factories via
 * `await import`, the one form that is safe against hoisting.
 */
import { vi } from "vitest";

import type { RunSummaryResponse, RunViewResponse } from "@/hooks/runs/types";
import type { ComparisonPermissions } from "@/hooks/shared/useComparisonPermissions";

const CREATED_AT = "2026-08-01T12:00:00Z";

export function makeRunSummary(overrides: Partial<RunSummaryResponse> = {}): RunSummaryResponse {
  return {
    id: "run-1",
    project_id: "p1",
    article_id: "a1",
    template_id: "tpl-1",
    kind: "extraction",
    version_id: "v-1",
    stage: "extract",
    status: "running",
    hitl_config_snapshot: {},
    parameters: {},
    results: {},
    created_at: CREATED_AT,
    created_by: "u-1",
    ...overrides,
  };
}

export type RunViewOverrides = Partial<Omit<RunViewResponse, "run">> & {
  run?: Partial<RunSummaryResponse>;
};

export function makeRunView({ run, ...overrides }: RunViewOverrides = {}): RunViewResponse {
  return {
    run: makeRunSummary(run),
    proposals: [],
    decisions: [],
    consensus_decisions: [],
    published_states: [],
    entity_types: [],
    instances: [],
    current_values: [],
    ...overrides,
  };
}

/** One reviewer decision on a coord, the shape the run view carries. */
export function makeDecision(
  overrides: Partial<RunViewResponse["decisions"][number]> & {
    id: string;
    reviewer_id: string;
  },
): RunViewResponse["decisions"][number] {
  return {
    run_id: "run-1",
    instance_id: "i1",
    field_id: "f1",
    decision: "edit",
    proposal_record_id: null,
    value: { value: "Yes" },
    rationale: null,
    created_at: CREATED_AT,
    ...overrides,
  };
}

/** One consensus decision resolving a coord. */
export function makeConsensusDecision(
  overrides: Partial<RunViewResponse["consensus_decisions"][number]> = {},
): RunViewResponse["consensus_decisions"][number] {
  return {
    id: "cons-1",
    run_id: "run-1",
    instance_id: "i1",
    field_id: "f1",
    consensus_user_id: "reviewer-1",
    mode: "select_existing",
    selected_decision_id: null,
    value: { value: "Yes" },
    rationale: null,
    created_at: CREATED_AT,
    ...overrides,
  };
}

/** A blind reviewer — the default caller of both screens. */
export const BLIND_REVIEWER: ComparisonPermissions = {
  userRole: "reviewer",
  isBlindMode: true,
  canSeeOthers: false,
  canResolveConflicts: false,
  canManageBlindMode: false,
  canExport: false,
  canEditTemplate: false,
  loading: false,
  error: null,
  refresh: vi.fn(async () => undefined),
};

/** An unblinded manager who arbitrates consensus. */
export const ARBITRATOR: ComparisonPermissions = {
  ...BLIND_REVIEWER,
  userRole: "manager",
  isBlindMode: false,
  canSeeOthers: true,
  canResolveConflicts: true,
};
