import type { ProposalRecordResponse } from '@/hooks/runs/types';

export interface PickLatestProposalOptions {
  /**
   * Current reviewer id. A `human` proposal authored by anyone else is
   * hidden to preserve the blind-review contract. Pass `null` when signed
   * out — then every human proposal is hidden (fail closed).
   */
  currentUserId: string | null;
}

function coordKey(
  p: Pick<ProposalRecordResponse, 'instance_id' | 'field_id'>,
): string {
  return `${p.instance_id}_${p.field_id}`;
}

/** True when `a` is the more recent proposal than `b`. */
function isMoreRecent(
  a: ProposalRecordResponse,
  b: ProposalRecordResponse,
): boolean {
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) {
    return ta > tb;
  }
  // Tie or unparsable timestamps: fall back to a deterministic id
  // comparison so selection never depends on the input array order.
  return a.id > b.id;
}

/**
 * Resolve the value-bearing proposal for each `(instance, field)`
 * coordinate from a run's proposal list.
 *
 * Selection is the **newest proposal per coord by `created_at`** — never
 * the first or last array element. Proposals are append-only, so editing a
 * field appends a newer row while the old one remains; selecting by array
 * position is fragile and was the root cause of the "edited value reverts
 * to the old value after refresh" bug (the API returns proposals
 * oldest-first and the form's first-hit-wins loop therefore surfaced the
 * stale original). Comparing `created_at` here makes the result
 * independent of input order, so it is correct whether the caller receives
 * oldest-first (extraction API) or newest-first data.
 *
 * Blind-review: a `human` proposal authored by another user is skipped, so
 * a reviewer sees only their own in-flight human edits plus all AI/system
 * proposals (which are not reviewer-attributable opinions).
 */
export function pickLatestProposalPerCoord(
  proposals: readonly ProposalRecordResponse[] | undefined,
  { currentUserId }: PickLatestProposalOptions,
): Map<string, ProposalRecordResponse> {
  const latest = new Map<string, ProposalRecordResponse>();
  for (const p of proposals ?? []) {
    if (p.source === 'human' && p.source_user_id !== currentUserId) {
      continue;
    }
    const key = coordKey(p);
    const existing = latest.get(key);
    if (existing && !isMoreRecent(p, existing)) {
      continue;
    }
    latest.set(key, p);
  }
  return latest;
}
