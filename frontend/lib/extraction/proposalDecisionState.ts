import type { ReviewerDecisionResponse } from '@/hooks/runs/types';
import { decisionMatchesVersion } from '@/lib/runs/valueEquality';
import type { AISuggestion } from '@/types/ai-extraction';

interface DecidedProposal { instanceId: string; fieldId: string; id: string; value: unknown }

/**
 * The review table's accept, reversal and undo append decisions but write no
 * suggestion status, and the server's caller-scoped status cannot express a
 * reversal. Its confirmed decisions therefore own which suggestion is pending;
 * an explicit rejection stays resolved.
 */
export function withReviewDecisionStatus(
  suggestions: Record<string, AISuggestion>, isAccepted: (proposal: DecidedProposal) => boolean,
): Record<string, AISuggestion> {
  return Object.fromEntries(Object.entries(suggestions).map(([key, suggestion]) => {
    if (suggestion.status === 'rejected') return [key, suggestion];
    const [instanceId, fieldId] = key.split('_');
    const accepted = isAccepted({instanceId, fieldId, id: suggestion.id, value: suggestion.value});
    return [key, {...suggestion, status: accepted ? 'accepted' : 'pending'}];
  }));
}

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
