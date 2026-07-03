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

/**
 * Per-coord consensus status, resolution wins over any bucket.
 */
export type CoordStatus =
  | 'conflict'
  | 'required_gap'
  | 'single_filler'
  | 'agreed'
  | 'resolved';

/**
 * Structural shape of a consensus decision — satisfied by
 * `ConsensusDecisionResponse` without importing hook types into lib/
 * (keeps the layering one-way: lib never depends on hooks/components).
 */
export interface ResolvedConsensusLike {
  instance_id: string;
  field_id: string;
  created_at: string;
  mode: string;
  selected_decision_id?: string | null;
  value: unknown;
  rationale?: string | null;
}

export interface ConsensusResolutionView<C extends ResolvedConsensusLike> {
  /** Newest consensus decision per coord (append-only aggregate ⇒ max created_at). */
  resolvedByCoord: Map<string, C>;
  buckets: ReconciliationBuckets;
  statusByCoord: Map<string, CoordStatus>;
  needsAttentionCount: number;
  resolvedCount: number;
  canFinalize: boolean;
}

/**
 * Pure derivation of consensus resolution state from the run aggregate: the
 * newest decision per coord, the reconciliation buckets, a per-coord status
 * (resolution wins), the needs-attention/resolved counts, and the finalize
 * gate. Extracted from the former ConsensusPanel so both the extraction and QA
 * screens compute it identically. No fetching.
 */
export function deriveConsensusResolution<C extends ResolvedConsensusLike>(p: {
  consensusDecisions: readonly C[];
  publishedCoords: ReadonlySet<string>;
  divergentCoords: ReadonlySet<string>;
  decisionCountByCoord: ReadonlyMap<string, number>;
  participantCount: number;
  requiredCoords: readonly string[];
  isComplete: boolean;
}): ConsensusResolutionView<C> {
  // Newest consensus decision wins per coord (the aggregate can carry more than
  // one if an arbitrator re-resolved a field).
  const resolvedByCoord = new Map<string, C>();
  for (const c of p.consensusDecisions) {
    const key = `${c.instance_id}::${c.field_id}`;
    const prev = resolvedByCoord.get(key);
    if (!prev || prev.created_at < c.created_at) resolvedByCoord.set(key, c);
  }

  const buckets = classifyReconciliation({
    divergentCoords: p.divergentCoords,
    decisionCountByCoord: p.decisionCountByCoord,
    participantCount: p.participantCount,
    requiredCoords: p.requiredCoords,
    publishedCoords: p.publishedCoords,
  });

  // Status precedence mirrors the bucket precedence, with resolved on top:
  // agreed < single_filler < required_gap < conflict < resolved.
  const statusByCoord = new Map<string, CoordStatus>();
  for (const c of buckets.agreements) statusByCoord.set(c, 'agreed');
  for (const c of buckets.singleFiller) statusByCoord.set(c, 'single_filler');
  for (const c of buckets.requiredGaps) statusByCoord.set(c, 'required_gap');
  for (const c of buckets.conflicts) statusByCoord.set(c, 'conflict');
  for (const c of resolvedByCoord.keys()) statusByCoord.set(c, 'resolved');

  let needsAttentionCount = 0;
  for (const s of statusByCoord.values()) {
    if (s === 'conflict' || s === 'required_gap' || s === 'single_filler') {
      needsAttentionCount += 1;
    }
  }

  const conflictsResolved = buckets.conflicts.every((c) => resolvedByCoord.has(c));
  const canFinalize =
    conflictsResolved &&
    buckets.requiredGaps.length === 0 &&
    p.isComplete &&
    p.consensusDecisions.length > 0;

  return {
    resolvedByCoord,
    buckets,
    statusByCoord,
    needsAttentionCount,
    resolvedCount: resolvedByCoord.size,
    canFinalize,
  };
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
