import type { ReviewerDecisionResponse } from '@/hooks/runs/types';
import { decisionMatchesVersion } from '@/lib/runs/valueEquality';

/** Ascending audit order, scoped to the authenticated reviewer and coordinate. */
export function reviewerCoordinateHistory(
  decisions: readonly ReviewerDecisionResponse[], reviewerId: string | null,
  runId: string, instanceId: string, fieldId: string,
): ReviewerDecisionResponse[] {
  if (!reviewerId) return [];
  return decisions.filter(d => d.reviewer_id === reviewerId && d.run_id === runId &&
    d.instance_id === instanceId && d.field_id === fieldId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

export function reversalPayload(history: readonly ReviewerDecisionResponse[]): Record<string, unknown> {
  return history.at(-2)?.value ?? {value: null};
}

/** The link is necessary; equality alone never manufactures an acceptance. */
export function acceptedProposal(history: readonly ReviewerDecisionResponse[], draftValue: unknown): string | null {
  const latest = history.at(-1);
  return latest?.proposal_record_id && decisionMatchesVersion(latest.value, draftValue)
    ? latest.proposal_record_id : null;
}
