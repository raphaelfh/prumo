/**
 * Shared types for /api/v1/runs hooks (extraction-centric HITL flow).
 *
 * These mirror the FastAPI schemas in backend/app/schemas/extraction_run.py.
 */

export interface CreateRunRequest {
  project_id: string;
  article_id: string;
  project_template_id: string;
  parameters?: Record<string, unknown> | null;
}

export interface CreateProposalRequest {
  instance_id: string;
  field_id: string;
  source: "ai" | "human" | "system";
  proposed_value: Record<string, unknown>;
  source_user_id?: string | null;
  confidence_score?: number | null;
  rationale?: string | null;
}

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
    | "proposal"
    | "review"
    | "consensus"
    | "finalized"
    | "cancelled";
}

export interface ProposalRecordResponse {
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

export interface ConsensusDecisionResponse {
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

export interface RunDetailResponse {
  run: RunSummaryResponse;
  proposals: ProposalRecordResponse[];
  decisions: ReviewerDecisionResponse[];
  consensus_decisions: ConsensusDecisionResponse[];
  published_states: PublishedStateResponse[];
}

/**
 * TanStack Query key factory for run-scoped data.
 */
export const runsKeys = {
  all: ["runs"] as const,
  detail: (runId: string) => ["runs", runId] as const,
};
