/**
 * The caller's persisted AI links (spec 2026-07-04 D0): per coordinate, the
 * `proposal_record_id` of the caller's OWN newest decision — the link-side
 * autosave baseline, so a hydrated coordinate is never re-written on mount.
 * A newer unlinked decision means the link was dropped; it never resurrects.
 *
 * NEVER derive this from `suggestions[].status`: the server marks any
 * non-reject caller decision 'accepted' (including plain manual edits), so
 * hydrated status would fabricate AI provenance for manually-typed values.
 */

import type {ReviewerDecisionResponse} from '@/hooks/runs/types';
import {coordKey} from '@/lib/runs/coord';

export function deriveAiLinkByKey(p: {
  decisions: readonly ReviewerDecisionResponse[];
  currentUserId: string | null;
}): Record<string, string> {
  const map: Record<string, string> = {};

  if (p.currentUserId) {
    // Newest own decision per coord wins; an unlinked newer decision means
    // the link was dropped — it must not resurrect from an older row.
    const newestByCoord = new Map<string, ReviewerDecisionResponse>();
    for (const d of p.decisions) {
      if (d.reviewer_id !== p.currentUserId) continue;
      const key = coordKey(d.instance_id, d.field_id);
      const prev = newestByCoord.get(key);
      if (!prev || prev.created_at < d.created_at) newestByCoord.set(key, d);
    }
    for (const [key, d] of newestByCoord) {
      if (d.proposal_record_id) map[key] = d.proposal_record_id;
    }
  }

  return map;
}
