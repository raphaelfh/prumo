import type { ReviewerDecisionResponse } from '@/hooks/runs/types';
import { coordKey, parseCoordKey } from '@/lib/runs/coord';
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
    const {instanceId, fieldId} = parseCoordKey(key);
    const accepted = isAccepted({instanceId, fieldId, id: suggestion.id, value: suggestion.value});
    return [key, {...suggestion, status: accepted ? 'accepted' : 'pending'}];
  }));
}

const byAuditOrder = (a: ReviewerDecisionResponse, b: ReviewerDecisionResponse) =>
  a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/** Ascending audit order, scoped to the authenticated reviewer and coordinate. */
export function reviewerCoordinateHistory(
  decisions: readonly ReviewerDecisionResponse[], reviewerId: string | null,
  runId: string, instanceId: string, fieldId: string,
): ReviewerDecisionResponse[] {
  if (!reviewerId) return [];
  return decisions.filter(d => d.reviewer_id === reviewerId && d.run_id === runId &&
    d.instance_id === instanceId && d.field_id === fieldId)
    .sort(byAuditOrder);
}

/**
 * Every coordinate's `reviewerCoordinateHistory` in one pass, keyed by
 * `coordKey` — for a caller that looks up many coordinates per render.
 */
export function reviewerHistoriesByCoord(
  decisions: readonly ReviewerDecisionResponse[], reviewerId: string | null, runId: string,
): Map<string, ReviewerDecisionResponse[]> {
  const histories = new Map<string, ReviewerDecisionResponse[]>();
  if (!reviewerId) return histories;
  for (const d of decisions) {
    if (d.reviewer_id !== reviewerId || d.run_id !== runId) continue;
    const key = coordKey(d.instance_id, d.field_id);
    const history = histories.get(key);
    if (history) history.push(d);
    else histories.set(key, [d]);
  }
  for (const history of histories.values()) history.sort(byAuditOrder);
  return histories;
}

/** Server rows with the session's confirmed rows over them: a confirmed row replaces its id. */
export function mergeConfirmedRows(
  server: readonly ReviewerDecisionResponse[], confirmed: readonly ReviewerDecisionResponse[],
): ReviewerDecisionResponse[] {
  const confirmedIds = new Set(confirmed.map(d => d.id));
  return [...server.filter(d => !confirmedIds.has(d.id)), ...confirmed];
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
