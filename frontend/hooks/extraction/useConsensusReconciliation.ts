/**
 * Derives all consensus-page computed values from run state.
 *
 * Extracted from ExtractionFullScreen to keep that component under the
 * file-size gate. Contains:
 *   - fieldLabelByCoord map (instance × field → "Section · Field")
 *   - requiredCoords array (all required template coord keys)
 *   - expectedReviewerCount (max of actual participants vs role-based count)
 *   - finalizeWarning (shouldWarn + pre-built confirm message)
 */

import type { RunDetailResponse } from '@/hooks/runs/types';
import type { ReviewerSummary } from '@/hooks/runs/useReviewerSummary';
import type { ExtractionEntityTypeWithFields } from '@/types/extraction';
import type { ExtractionInstance } from '@/types/extraction';
import { classifyReconciliation } from '@/lib/runs/reconciliation';
import { countExpectedReviewers } from '@/lib/runs/reviewerExpectation';
import { computeFinalizeWarning } from '@/lib/runs/finalizeWarning';
import { useProjectMembers } from '@/hooks/hitl/useProjectMembers';
import { t } from '@/lib/copy';

export interface ConsensusReconciliation {
  fieldLabelByCoord: Record<string, string>;
  requiredCoords: string[];
  expectedReviewerCount: number;
  finalizeWarning: { shouldWarn: boolean; confirmMessage: string };
}

export function useConsensusReconciliation(params: {
  runDetail: RunDetailResponse | null | undefined;
  reviewerSummary: ReviewerSummary;
  instances: ExtractionInstance[];
  entityTypes: ExtractionEntityTypeWithFields[];
  projectId: string | undefined;
}): ConsensusReconciliation {
  const { runDetail, reviewerSummary, instances, entityTypes, projectId } = params;

  // {instance::field} → "Section · Field" label map for the ConsensusPanel.
  const fieldLabelByCoord: Record<string, string> = {};
  const requiredCoords: string[] = [];
  for (const inst of instances) {
    const et = entityTypes.find((e) => e.id === inst.entity_type_id);
    const sectionLabel = et?.label ?? et?.name ?? 'Section';
    for (const f of et?.fields ?? []) {
      const key = `${inst.id}::${f.id}`;
      fieldLabelByCoord[key] = `${sectionLabel} · ${f.label}`;
      if (f.is_required) requiredCoords.push(key);
    }
  }

  // Role-derived expected reviewer count.
  const members = useProjectMembers(projectId ?? '');
  const expectedReviewerCount = Math.max(
    reviewerSummary.reviewers.length,
    countExpectedReviewers(members.data ?? []),
  );

  // Classify reconciliation buckets for the soft-warn (singleFiller count).
  const reconciliation = classifyReconciliation({
    divergentCoords: reviewerSummary.divergentCoords,
    decisionCountByCoord: new Map(
      [...reviewerSummary.decisionsByCoord].map(([k, v]) => [k, v.length]),
    ),
    participantCount: reviewerSummary.reviewers.length,
    requiredCoords,
    publishedCoords: new Set(
      (runDetail?.published_states ?? []).map((p) => `${p.instance_id}::${p.field_id}`),
    ),
  });

  // Build the finalize-warning confirm message (pre-built so handleApproveFinalize
  // only needs one line: if (finalizeWarning.shouldWarn && !window.confirm(...)) return;).
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
    fieldLabelByCoord,
    requiredCoords,
    expectedReviewerCount,
    finalizeWarning: { shouldWarn: warning.shouldWarn, confirmMessage },
  };
}
