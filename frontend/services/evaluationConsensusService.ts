import {
  createConsensusDecision,
  createEvidenceUploadUrl,
  type CreateConsensusDecisionRequest,
  type CreateEvidenceUploadRequest,
  type EvidenceUploadResponse,
  type PublishedStateResponse,
} from "@/integrations/api";

export async function publishConsensus(
  payload: CreateConsensusDecisionRequest
): Promise<PublishedStateResponse> {
  return createConsensusDecision(payload);
}

export async function requestEvidenceUpload(
  payload: CreateEvidenceUploadRequest
): Promise<EvidenceUploadResponse> {
  return createEvidenceUploadUrl(payload);
}

export const evaluationConsensusService = {
  publishConsensus,
  requestEvidenceUpload,
};
