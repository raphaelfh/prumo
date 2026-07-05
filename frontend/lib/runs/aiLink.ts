/**
 * Derives the coord → AI-proposal link map autosave stamps onto edit
 * decisions (spec 2026-07-04 D0).
 *
 * Layer 1 — persisted truth: the caller's OWN newest decision per coord
 * contributes its `proposal_record_id` (written by a previous D0 autosave),
 * so the link survives reloads without inventing anything.
 * Layer 2 — session events: accept/select set the chosen id, reject
 * tombstones with `null`. Session events override layer 1.
 *
 * NEVER derive this from `suggestions[].status`: the server marks any
 * non-reject caller decision 'accepted' (including plain manual edits), so
 * hydrated status would fabricate AI provenance for manually-typed values.
 */

import type {ReviewerDecisionResponse} from '@/hooks/runs/types';

export function deriveAiLinkByKey(p: {
  decisions: readonly ReviewerDecisionResponse[];
  currentUserId: string | null;
  sessionAdoption: Record<string, string | null>;
}): Record<string, string> {
  const map: Record<string, string> = {};

  if (p.currentUserId) {
    // Newest own decision per coord wins; an unlinked newer decision means
    // the link was dropped — it must not resurrect from an older row.
    const newestByCoord = new Map<string, ReviewerDecisionResponse>();
    for (const d of p.decisions) {
      if (d.reviewer_id !== p.currentUserId) continue;
      const key = `${d.instance_id}_${d.field_id}`;
      const prev = newestByCoord.get(key);
      if (!prev || prev.created_at < d.created_at) newestByCoord.set(key, d);
    }
    for (const [key, d] of newestByCoord) {
      if (d.proposal_record_id) map[key] = d.proposal_record_id;
    }
  }

  for (const [key, proposalId] of Object.entries(p.sessionAdoption)) {
    if (proposalId === null) delete map[key];
    else map[key] = proposalId;
  }

  return map;
}
