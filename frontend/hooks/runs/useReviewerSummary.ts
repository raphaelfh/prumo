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
 *   - requiredReviewerCount: from `run.hitl_config_snapshot.reviewer_count`,
 *     defaulting to 1 if absent.
 *   - completionRatio: reviewers.length / requiredReviewerCount, clamped
 *     to [0, 1] for use in progress bars.
 *
 * The hook does no fetching — it's a pure transform on the run aggregate
 * the page already loads. This keeps the rendering math reactive to the
 * react-query cache and trivially testable.
 */


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
  requiredReviewerCount: number;
  completionRatio: number;
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
  requiredReviewerCount: 1,
  completionRatio: 0,
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
 * Canonical JSON with object keys sorted recursively — matches the backend's
 * `json.dumps(value, sort_keys=True)` so the two agreement checks stay in lock
 * step (Phase B finding F1). Key order never affects equality; a differing
 * sibling key (e.g. `unit`) does.
 *
 * Caveat: JS has no int/float distinction, so `5` and `5.0` both stringify to
 * `"5"` here while the backend keeps `5` vs `5.0`. Harmless in practice — form
 * values are stored as strings (`"5"`), never bare JSON numbers — so a numeric
 * mismatch would only arise from a non-form writer, which is out of scope.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
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

/**
 * Peel one `{value: X}` envelope for DISPLAY. Exported so RunReviewerComparison
 * renders values the same way this summary aggregates them. Agreement is no
 * longer decided by peeling — `decisionsAgree` compares the full envelope
 * (Phase B, decision G).
 */
export function unwrap(raw: unknown): unknown {
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    "value" in (raw as Record<string, unknown>)
  ) {
    return (raw as { value: unknown }).value;
  }
  return raw;
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

    const required = Math.max(
      1,
      Number(
        (runDetail.run.hitl_config_snapshot as { reviewer_count?: unknown })
          ?.reviewer_count ?? 1,
      ),
    );
    const ratio = Math.min(1, reviewers.size / required);

  return {
    reviewers: [...reviewers],
    currentDecisions,
    decisionsByCoord,
    divergentCoords,
    requiredReviewerCount: required,
    completionRatio: ratio,
    filledCoords,
    touchedCoords,
  };
}
