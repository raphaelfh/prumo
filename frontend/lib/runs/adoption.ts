/**
 * Honest AI-adoption attribution for the consensus surfaces (spec 2026-07-09).
 *
 * The one rule this module exists to enforce: cross-mark EXISTENCE rides only
 * on the append-only link `decision.proposal_record_id === version.id`. Value
 * equality can never MINT a mark (a "no information" marker byte-matches every
 * no-info AI version; short scalars collide by chance; accept_proposal carries
 * value=null). Value equality is quarantined to refining the WORDING of an
 * already-linked row. Sibling to `aiLink.ts` (same never-fabricate discipline).
 */

import type {ReviewerDecisionResponse} from '@/hooks/runs/types';
import {decisionMatchesVersion} from '@/lib/runs/valueEquality';

/**
 * One reviewer's honest link to an AI proposal version, carrying just enough
 * to refine the Adopted-vs-Edited wording against the lazily-loaded version
 * value inside the popover (version values load on popover open, not at
 * table-render time). Never carries a value-coincidence mark.
 */
export interface PeerAdoptionMark {
  reviewerLabel: string;
  decisionValue: unknown;
  decisionKind: string;
}

/**
 * Refine the wording of an ALREADY-LINKED adoption — never mints existence.
 * Fails closed to 'adopted':
 *   · accept_proposal carries value=null by contract → Adopted;
 *   · a version outside the loaded history window (`undefined`) reads as a
 *     plain link ("Adopted by", no edit claim) — never a fabricated "Edited by"
 *     from comparing against an absent value (spec D5, reopened runs #514).
 */
export function adoptionWording(
  decisionKind: string,
  decisionValue: unknown,
  version: {value: unknown} | undefined,
): 'adopted' | 'edited' {
  if (decisionKind === 'accept_proposal') return 'adopted';
  if (!version) return 'adopted';
  return decisionMatchesVersion(decisionValue, version.value) ? 'adopted' : 'edited';
}

/**
 * proposal id → the reviewers whose CURRENT decision links to that proposal
 * (non-reject). `peers` must already be the latest-per-distinct-reviewer set
 * (`useReviewerSummary.decisionsByCoord`) so superseded rows can't resurrect
 * marks.
 *
 * `opts.excludeReviewerId` — drop this reviewer (per-cell trace: their mark is
 *   the popover's pinned-row chip, so it must not also cross-mark).
 * `opts.onlyReviewerId` — when provided (key present), keep ONLY rows whose
 *   `reviewer_id` equals it; `null` keeps nobody. Fail-closed second layer for
 *   blind review: when peer identity is hidden, field-level marks collapse to
 *   the caller's own (server already strips peer rows, so this is defense in
 *   depth). Omit for the full, identity-revealed set.
 */
export function buildPeerAdoptionMap(
  peers: readonly ReviewerDecisionResponse[],
  labelById: Record<string, string>,
  opts?: {excludeReviewerId?: string; onlyReviewerId?: string | null},
): Record<string, PeerAdoptionMark[]> {
  const map: Record<string, PeerAdoptionMark[]> = {};
  for (const d of peers) {
    if (!d.proposal_record_id || d.decision === 'reject') continue;
    if (opts?.excludeReviewerId && d.reviewer_id === opts.excludeReviewerId) continue;
    if (opts && 'onlyReviewerId' in opts && d.reviewer_id !== opts.onlyReviewerId) continue;
    const mark: PeerAdoptionMark = {
      reviewerLabel: labelById[d.reviewer_id] ?? d.reviewer_id,
      decisionValue: d.value,
      decisionKind: d.decision,
    };
    (map[d.proposal_record_id] ??= []).push(mark);
  }
  return map;
}
