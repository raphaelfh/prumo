/**
 * Classify each (instance, field) coord of a consensus run into one of four
 * reconciliation buckets, in strict precedence order so a coord lands in
 * exactly one: conflict > required-gap > single-filler > agreement.
 * Pure — no fetching. Inputs derive from useReviewerSummary + the run's
 * template (required coords) + published_states.
 */
export interface ClassifyParams {
  /** coordKeys with >=2 materially different reviewer values. */
  divergentCoords: ReadonlySet<string>;
  /** coordKey -> number of distinct reviewer decisions on that coord. */
  decisionCountByCoord: ReadonlyMap<string, number>;
  /** Distinct reviewers who submitted any decision on the run. */
  participantCount: number;
  /** Every required template coordKey (instance x field where is_required). */
  requiredCoords: readonly string[];
  /** coordKeys already carrying a published state. */
  publishedCoords: ReadonlySet<string>;
}

export interface ReconciliationBuckets {
  conflicts: string[];
  requiredGaps: string[];
  singleFiller: string[];
  agreements: string[];
}

export function classifyReconciliation(p: ClassifyParams): ReconciliationBuckets {
  const conflicts: string[] = [];
  const requiredGaps: string[] = [];
  const singleFiller: string[] = [];
  const agreements: string[] = [];

  // 1. Conflicts take precedence (resolved or not — the panel renders resolved
  //    ones with the resolved-state UI).
  for (const coord of p.divergentCoords) conflicts.push(coord);

  // 2. Required gap: a required coord with no reviewer decision and no published
  //    value. A required coord that IS touched falls through to step 3/4.
  for (const coord of p.requiredCoords) {
    if (p.divergentCoords.has(coord)) continue;
    if (!p.decisionCountByCoord.has(coord) && !p.publishedCoords.has(coord)) {
      requiredGaps.push(coord);
    }
  }

  // 3 + 4. Touched, non-conflict coords: single-filler vs agreement.
  for (const [coord, count] of p.decisionCountByCoord) {
    if (p.divergentCoords.has(coord)) continue;
    if (p.participantCount >= 2 && count < p.participantCount) {
      singleFiller.push(coord);
    } else {
      agreements.push(coord);
    }
  }

  return { conflicts, requiredGaps, singleFiller, agreements };
}
