/**
 * Extraction's finalize term: run-level required-field completeness (the hard
 * gate the backend mirrors, ADR-0009) and the soft-warn confirm shown before
 * Approve & finalize (missing reviewers, single-filler coords). QA has neither
 * — its signaling questions are optional.
 */

import type { RunDetailResponse } from '@/hooks/runs/types';
import type { ReviewerSummary } from '@/hooks/runs/useReviewerSummary';
import { t } from '@/lib/copy';
import { computeFinalizeWarning } from '@/lib/runs/finalizeWarning';
import { classifyReconciliation } from '@/lib/runs/reconciliation';
import { coordKey } from '@/lib/runs/coord';

/** `coordKey`s of every required field on the materialised form. */
export function requiredCoordKeys(
  instances: ReadonlyArray<{ id: string; entity_type_id: string }>,
  entityTypes: ReadonlyArray<{ id: string; fields: ReadonlyArray<{ id: string; is_required: boolean }> }>,
): string[] {
  const keys: string[] = [];
  for (const inst of instances) {
    const et = entityTypes.find((e) => e.id === inst.entity_type_id);
    for (const f of et?.fields ?? []) {
      if (f.is_required) keys.push(coordKey(inst.id, f.id));
    }
  }
  return keys;
}

export interface ExtractionFinalizeGate {
  /**
   * Every required coord has a reviewer decision or a published value. The
   * header finalize gate reads this — NOT the caller-scoped form completeness,
   * which strands an arbitrator who resolved required fields by adopting peers.
   */
  requiredFieldsResolved: boolean;
  /** Soft-warn: confirm before finalizing; never blocks. */
  warning: { shouldWarn: boolean; confirmMessage: string };
}

export function assessExtractionFinalize(p: {
  runDetail: RunDetailResponse | null | undefined;
  reviewerSummary: ReviewerSummary;
  requiredCoords: string[];
  expectedReviewerCount: number;
}): ExtractionFinalizeGate {
  const { runDetail, reviewerSummary, requiredCoords, expectedReviewerCount } = p;
  const reconciliation = classifyReconciliation({
    divergentCoords: reviewerSummary.divergentCoords,
    decisionCountByCoord: new Map(
      [...reviewerSummary.decisionsByCoord].map(([k, v]) => [k, v.length]),
    ),
    participantCount: reviewerSummary.reviewers.length,
    requiredCoords,
    publishedCoords: new Set(
      (runDetail?.published_states ?? []).map((s) => coordKey(s.instance_id, s.field_id)),
    ),
  });

  const warning = computeFinalizeWarning({
    participantCount: reviewerSummary.reviewers.length,
    expectedReviewerCount,
    singleFillerCount: reconciliation.singleFiller.length,
  });
  let confirmMessage = '';
  if (warning.shouldWarn) {
    const lines = warning.reasons.map((r) =>
      r === 'missing_reviewers'
        ? t('consensus', 'finalizeWarnMissingReviewers')
            .replace('{{count}}', String(reviewerSummary.reviewers.length))
            .replace('{{required}}', String(expectedReviewerCount))
        : t('consensus', 'finalizeWarnSingleFiller')
            .replace('{{count}}', String(reconciliation.singleFiller.length)),
    );
    confirmMessage = `${t('consensus', 'finalizeWarnTitle')}\n\n${lines.join('\n')}`;
  }

  return {
    requiredFieldsResolved: reconciliation.requiredGaps.length === 0,
    warning: { shouldWarn: warning.shouldWarn, confirmMessage },
  };
}
