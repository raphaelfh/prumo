import {
  createEvaluationRun,
  getEvaluationRun,
  triggerProposalGeneration,
  type CreateEvaluationRunRequest,
  type EvaluationRunResponse,
} from "@/integrations/api";

export async function createRun(request: CreateEvaluationRunRequest): Promise<EvaluationRunResponse> {
  return createEvaluationRun(request);
}

export async function fetchRun(runId: string): Promise<EvaluationRunResponse> {
  return getEvaluationRun(runId);
}

export async function startProposalGeneration(runId: string): Promise<void> {
  await triggerProposalGeneration(runId);
}

export const evaluationService = {
  createRun,
  fetchRun,
  startProposalGeneration,
};
