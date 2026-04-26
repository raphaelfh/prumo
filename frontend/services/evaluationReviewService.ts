import {
  createReviewerDecision,
  listReviewQueue,
  type CreateReviewerDecisionRequest,
  type EvaluationReviewQueueResponse,
  type ReviewerDecisionResponse,
} from "@/integrations/api";

export async function fetchReviewQueue(params: {
  runId?: string;
  status?: "pending" | "decided";
}): Promise<EvaluationReviewQueueResponse> {
  return listReviewQueue(params);
}

export async function submitReviewerDecision(
  payload: CreateReviewerDecisionRequest
): Promise<ReviewerDecisionResponse> {
  return createReviewerDecision(payload);
}

export const evaluationReviewService = {
  fetchReviewQueue,
  submitReviewerDecision,
};
