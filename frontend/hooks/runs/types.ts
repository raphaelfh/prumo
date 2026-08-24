/**
 * Shared types for /api/v1/runs hooks (extraction-centric HITL flow).
 *
 * These mirror the FastAPI schemas in backend/app/schemas/extraction_run.py.
 */

export interface CreateDecisionRequest {
  instance_id: string;
  field_id: string;
  decision: "accept_proposal" | "reject" | "edit";
  proposal_record_id?: string | null;
  value?: Record<string, unknown> | null;
  rationale?: string | null;
}

export interface CreateConsensusRequest {
  instance_id: string;
  field_id: string;
  mode: "select_existing" | "manual_override";
  selected_decision_id?: string | null;
  value?: Record<string, unknown> | null;
  rationale?: string | null;
}

export interface AdvanceStageRequest {
  target_stage:
    | "pending"
    | "extract"
    | "consensus"
    | "finalized"
    | "cancelled";
}

export interface MarkReadyRequest {
  ready: boolean;
}

export interface RunReadyStateResponse {
  ready_count: number;
  reviewer_count: number;
  /** Blind-gated (ADR-0012): only the caller's own entry unless unblinded —
   * enough for the self-check; the counts stay aggregate. */
  reviewers_ready: string[];
}

interface ProposalRecordResponse {
  id: string;
  run_id: string;
  instance_id: string;
  field_id: string;
  source: string;
  source_user_id: string | null;
  proposed_value: Record<string, unknown>;
  confidence_score: number | null;
  rationale: string | null;
  created_at: string;
}

export interface ReviewerDecisionResponse {
  id: string;
  run_id: string;
  instance_id: string;
  field_id: string;
  reviewer_id: string;
  decision: string;
  proposal_record_id: string | null;
  value: Record<string, unknown> | null;
  rationale: string | null;
  created_at: string;
}

interface ConsensusDecisionResponse {
  id: string;
  run_id: string;
  instance_id: string;
  field_id: string;
  consensus_user_id: string;
  mode: string;
  selected_decision_id: string | null;
  value: Record<string, unknown> | null;
  rationale: string | null;
  created_at: string;
}

export interface PublishedStateResponse {
  id: string;
  run_id: string;
  instance_id: string;
  field_id: string;
  value: Record<string, unknown>;
  published_at: string;
  published_by: string;
  version: number;
}

export interface ConsensusResultResponse {
  consensus: ConsensusDecisionResponse;
  published: PublishedStateResponse;
}

export interface RunSummaryResponse {
  id: string;
  project_id: string;
  article_id: string;
  template_id: string;
  kind: string;
  version_id: string;
  stage: string;
  status: string;
  hitl_config_snapshot: Record<string, unknown>;
  parameters: Record<string, unknown>;
  results: Record<string, unknown>;
  created_at: string;
  created_by: string;
}

export interface ApproveFinalizeResponse {
  run: RunSummaryResponse;
  published_count: number;
}

export interface RunDetailResponse {
  run: RunSummaryResponse;
  proposals: ProposalRecordResponse[];
  decisions: ReviewerDecisionResponse[];
  consensus_decisions: ConsensusDecisionResponse[];
  published_states: PublishedStateResponse[];
  /** Effective unblind for this caller on this run (consensus auto-reveal for
   * arbitrators / finalized / can_see_peers). Drives the compare surface.
   * Optional in the type only so test fixtures need not construct it — the
   * backend always sends it; consumers default with `?? false` / `|| ...`. */
  peers_revealed?: boolean;
}

export interface RunViewFieldResponse {
  id: string;
  name: string;
  label: string;
  description: string | null;
  field_type: string;
  is_required: boolean;
  validation_schema: unknown | null;
  allowed_values: unknown | null;
  unit: string | null;
  allowed_units: unknown | null;
  sort_order: number;
  llm_description: string | null;
  allow_other: boolean;
  other_label: string | null;
  other_placeholder: string | null;
  /** ADR-0016 opt-in disposition flags — gate the "Not applicable" /
   * "Not evaluated" markers in FieldInput. */
  allows_not_applicable: boolean;
  allows_not_evaluated: boolean;
}

interface RunViewEntityType {
  id: string;
  name: string;
  label: string;
  description: string | null;
  parent_entity_type_id: string | null;
  cardinality: string;
  role: string;
  sort_order: number;
  is_required: boolean;
  /** Repeating-group entry noun (B-8) — null on non-containers and on
   * pre-B-8 snapshots; the backend serializes the key unconditionally. */
  entry_label: string | null;
  fields: RunViewFieldResponse[];
}

export interface RunViewCurrentValue {
  instance_id: string;
  field_id: string;
  value: Record<string, unknown> | null;
  decision: string;
}

interface RunViewInstanceResponse {
  id: string;
  entity_type_id: string;
  parent_instance_id: string | null;
  label: string;
  sort_order: number;
  metadata: Record<string, unknown>;
  project_id: string;
  article_id: string | null;
  template_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface RunViewResponse extends RunDetailResponse {
  entity_types: RunViewEntityType[];
  current_values: RunViewCurrentValue[];
  instances: RunViewInstanceResponse[];
  /** "N/M reviewers ready" hint (advisory; readiness gates nothing). Optional in
   * the type only so fixtures need not construct it; backend always sends it.
   * reviewers_ready is blind-gated (ADR-0012): a blind caller gets only their
   * own entry, never peer ids. */
  ready_count?: number;
  reviewer_count?: number;
  reviewers_ready?: string[];
  /** Computed judgments from the template's derivation spec. Entries with a
   * `target_field_id` are RECOMMENDATIONS (the derived default for that
   * assessor-owned stored field, paired with `rationale_field_id`); entries
   * without one are computed OVERALLS (paired Step-4 narrative via
   * `summary_field_id`). Empty for templates with no spec. `value` is null
   * when the inputs are incomplete; `inputs` is the per-input breakdown —
   * `value` is the display (raw answer for signaling rows), `contribution`
   * the Low/High/Unclear the rule consumed (highlight/color by it only). */
  derived_judgments?: {
    id: string;
    label: string;
    value: string | null;
    inputs?: { label: string; value: string | null; contribution?: string | null }[];
    target_entity_type_id?: string | null;
    target_field_id?: string | null;
    rationale_field_id?: string | null;
    summary_field_id?: string | null;
  }[];
}

export interface ArticleRunRef {
  article_id: string;
  run_id: string | null;
}

/**
 * TanStack Query key factory for run-scoped data.
 */
export const runsKeys = {
  all: ["runs"] as const,
  detail: (runId: string) => ["runs", runId] as const,
  reviewers: (runId: string) => ["runs", runId, "reviewers"] as const,
  disabled: ["runs", "disabled"] as const,
  noRunReviewers: ["runs", "no-run", "reviewers"] as const,
};
