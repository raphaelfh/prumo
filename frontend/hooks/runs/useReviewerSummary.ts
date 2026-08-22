/**
 * Derives multi-reviewer state from a `RunDetailResponse` aggregate.
 *
 * Returns:
 *   - reviewers: distinct reviewer ids that have written at least one
 *     non-superseded decision in this run.
 *   - currentDecisions: latest decision per (reviewer, instance, field)
 *     — mirrors `extraction_reviewer_states` semantics on the client.
 *   - divergentCoords: Set<"instance::field"> where ≥ 2 reviewers gave
 *     materially different values (or one rejected and another edited).
 *
 * The "N of M reviewers" denominator deliberately does NOT live here:
 * `hitl_config_snapshot.reviewer_count` is an inert knob (no UI sets it since
 * #388) — use `useExpectedReviewerCount` for the role-derived count instead.
 *
 * The hook does no fetching — it's a pure transform on the run aggregate
 * the page already loads. This keeps the rendering math reactive to the
 * react-query cache and trivially testable.
 */


import { stableStringify } from "@/lib/runs/valueEquality";

import type { ReviewerDecisionResponse, RunDetailResponse } from "./types";

export interface CurrentDecisionEntry {
  decision: ReviewerDecisionResponse;
  coordKey: string;
}

export interface ReviewerSummary {
  reviewers: string[];
  currentDecisions: Map<string, ReviewerDecisionResponse>;
  /**
   * Latest non-superseded ReviewerDecision per (instance, field), keyed
   * by `${instance}::${field}`. Each entry is the array of one decision
   * per distinct reviewer who touched the coord — exactly the shape the
   * consensus panel renders side-by-side.
   */
  decisionsByCoord: Map<string, ReviewerDecisionResponse[]>;
  divergentCoords: Set<string>;
  /** Coords with at least one non-reject decision — useful for "filled" stats. */
  filledCoords: Set<string>;
  /** All distinct (instance, field) coords any reviewer has touched. */
  touchedCoords: Set<string>;
}

const EMPTY_SUMMARY: ReviewerSummary = {
  reviewers: [],
  currentDecisions: new Map(),
  decisionsByCoord: new Map(),
  divergentCoords: new Set(),
  filledCoords: new Set(),
  touchedCoords: new Set(),
};

function coordKey(instanceId: string, fieldId: string): string {
  return `${instanceId}::${fieldId}`;
}

function reviewerKey(
  reviewerId: string,
  instanceId: string,
  fieldId: string,
): string {
  return `${reviewerId}::${instanceId}::${fieldId}`;
}

/**
 * Agreement check on the FULL value envelope (Phase B, decision G): two
 * reviewers agree only when their whole stored value matches, so `5 mg` vs
 * `5 g` (`{value, unit}` differing on `unit`) is divergence — not the false
 * agreement the old unit-stripped `unwrap` produced. A single-key `{value: X}`
 * still compares equal across reviewers. Rejects compare equal to each other;
 * a reject vs a non-reject never does.
 */
function decisionsAgree(
  a: ReviewerDecisionResponse,
  b: ReviewerDecisionResponse,
): boolean {
  if (a.decision === "reject" && b.decision === "reject") return true;
  if (a.decision === "reject" || b.decision === "reject") return false;

  return stableStringify(a.value) === stableStringify(b.value);
}

export function useReviewerSummary(
  runDetail: RunDetailResponse | null | undefined,
): ReviewerSummary {
  if (!runDetail) return EMPTY_SUMMARY;

    // Latest decision per (reviewer × coord) — `decisions` are append-only
    // so we keep the newest by created_at.
    const latestByReviewerCoord = new Map<string, ReviewerDecisionResponse>();
    for (const d of runDetail.decisions) {
      const k = reviewerKey(d.reviewer_id, d.instance_id, d.field_id);
      const existing = latestByReviewerCoord.get(k);
      if (!existing || existing.created_at < d.created_at) {
        latestByReviewerCoord.set(k, d);
      }
    }

    const reviewers = new Set<string>();
    const touchedCoords = new Set<string>();
    const filledCoords = new Set<string>();
    const decisionsByCoord = new Map<string, ReviewerDecisionResponse[]>();
    const currentDecisions = new Map<string, ReviewerDecisionResponse>();

    for (const d of latestByReviewerCoord.values()) {
      reviewers.add(d.reviewer_id);
      const ck = coordKey(d.instance_id, d.field_id);
      touchedCoords.add(ck);
      if (d.decision !== "reject") filledCoords.add(ck);

      // Last write per (instance, field) wins for the "what's the current
      // pointer" view a single-reviewer page shows. For multi-reviewer
      // mode this is mostly used by the form when there's only one
      // reviewer; the panel uses decisionsByCoord directly.
      const prev = currentDecisions.get(ck);
      if (!prev || prev.created_at < d.created_at) {
        currentDecisions.set(ck, d);
      }

      const list = decisionsByCoord.get(ck);
      if (list) list.push(d);
      else decisionsByCoord.set(ck, [d]);
    }

    const divergentCoords = new Set<string>();
    for (const [ck, list] of decisionsByCoord) {
      if (list.length < 2) continue;
      const first = list[0];
      const allAgree = list.every((d) => decisionsAgree(first, d));
      if (!allAgree) divergentCoords.add(ck);
    }

  return {
    reviewers: [...reviewers],
    currentDecisions,
    decisionsByCoord,
    divergentCoords,
    filledCoords,
    touchedCoords,
  };
}
